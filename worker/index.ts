import { WorkerEntrypoint } from 'cloudflare:workers'
import type { Domain, Item, Session, Slot, TasteRequest, TraceStep } from '../shared/types'
import { adjust } from './agent'
import { curate } from './curate'
import { assemble, buildCtx, mergePools, planSession, pool, record, TYPE, type PoolKind, type PoolRunner } from './engine'
import { ground, groundDomain, research, type GroundRunner, type Grounded } from './scout'
import { planGroup, whoFor } from './group'
import { filmPairs, musicPairs } from './interview'
import { llmConnected, structured, type Ask, type StructuredRequest } from './llm'
import { handleMcp } from './mcp'
import { Qloo, QlooError, quota, type QlooProxyLike } from './qloo'
import { templatePrompts } from './templates'

export interface Env {
  QLOO_API_KEY: string
  LLM_RELAY_URL?: string
  LLM_RELAY_KEY?: string
  LLM_LIMIT?: RateLimit
  API_LIMIT?: RateLimit
  QLOO_PROXY?: QlooProxyLike
  PLANNER?: PlannerLike
  ASSETS: Fetcher
}

/** Qloo calls made (and answered from cache) in another invocation, for the session's stats. */
interface Counted {
  calls: number
  cached: number
}

interface PlannerLike {
  pool(kind: PoolKind, req: TasteRequest, window: [number, number], onStep: (step: TraceStep) => void): Promise<{ items: Item[] } & Counted>
  ground(domain: Domain, wanted: { name: string; year?: number }[], req: TasteRequest, window: [number, number], poolNames: string[]): Promise<Grounded & Counted>
  ask(opts: StructuredRequest): Promise<{ data: unknown; cached: boolean }>
}

const SEARCH_TYPES = [TYPE.music, TYPE.film, TYPE.tv, TYPE.star]

/** Fetches and trims one Qloo answer in its own invocation (reached only through the QLOO_PROXY binding). */
export class QlooProxy extends WorkerEntrypoint<Env> {
  async fetchTrimmed(method: 'GET' | 'POST', path: string, payload: unknown) {
    return new Qloo(this.env.QLOO_API_KEY).fetchTrimmed(method, path, payload)
  }
}

const qloo = (env: Env) => new Qloo(env.QLOO_API_KEY, env.QLOO_PROXY)

/** Builds one pool, or checks one domain's research, in its own invocation: each has its own 10 ms CPU budget,
 *  and the request that streams the session only puts the results together. */
export class Planner extends WorkerEntrypoint<Env> {
  async pool(kind: PoolKind, req: TasteRequest, window: [number, number], onStep: (step: TraceStep) => void) {
    const sent: Promise<unknown>[] = []
    const q = qloo(this.env)
    const ctx = buildCtx(q, req, (step) => void sent.push(Promise.resolve(onStep(step)).catch(() => undefined)), window)
    const items = await pool(kind, ctx)
    await Promise.all(sent)
    return { items, calls: q.calls, cached: q.cached }
  }

  async ground(domain: Domain, wanted: { name: string; year?: number }[], req: TasteRequest, window: [number, number], poolNames: string[]) {
    const q = qloo(this.env)
    const out = await groundDomain(buildCtx(q, req, undefined, window), domain, wanted, poolNames)
    return { ...out, calls: q.calls, cached: q.cached }
  }

  /** One model call: reading and caching its answer here keeps that work off the request that streams. */
  async ask(opts: StructuredRequest) {
    return structured<unknown>(this.env, opts)
  }
}

/** Pools built by the Planner when the binding is there (on Cloudflare and in local dev), else right here. */
function poolRunner(env: Env): PoolRunner | undefined {
  const planner = env.PLANNER
  if (!planner) return undefined
  return async (kind, ctx) => {
    const out = await planner.pool(kind, ctx.req, ctx.window, (step) => record(ctx, step))
    ctx.q.calls += out.calls
    ctx.q.cached += out.cached
    return out.items
  }
}

function asker(env: Env): Ask | undefined {
  const planner = env.PLANNER
  if (!planner) return undefined
  return async <T,>(opts: StructuredRequest) => (await planner.ask(opts)) as { data: T; cached: boolean }
}

function groundRunner(env: Env, ctx: { q: Qloo; req: TasteRequest; window: [number, number] }): GroundRunner | undefined {
  const planner = env.PLANNER
  if (!planner) return undefined
  return async (domain, wanted, names) => {
    const out = await planner.ground(domain, wanted, ctx.req, ctx.window, names)
    ctx.q.calls += out.calls
    ctx.q.cached += out.cached
    return out
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

class BadRequest extends Error {}

async function body<T>(req: Request): Promise<T> {
  const text = await req.text()
  if (text.length > 64_000) throw new BadRequest('Request too large')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new BadRequest('Expected JSON')
  }
}

function validTaste(r: TasteRequest): TasteRequest {
  const year = Number(r?.birthYear)
  if (!Number.isInteger(year) || year < 1900 || year > 2010) throw new BadRequest('birthYear must be between 1900 and 2010')
  const ids = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x.length < 120).slice(0, 40) : [])
  const seeds = (xs: unknown) =>
    (Array.isArray(xs) ? xs : [])
      .filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string')
      .slice(0, 20)
      .map((s: any) => ({ id: s.id, name: String(s.name).slice(0, 120), type: String(s.type ?? ''), weight: Number(s.weight) || undefined }))
  const text = (x: unknown, n: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : undefined)
  return {
    birthYear: year,
    hometown: text(r.hometown, 80),
    heritage: ids(r.heritage).slice(0, 3),
    favorites: seeds(r.favorites),
    liked: seeds(r.liked),
    avoidTags: ids(r.avoidTags),
    avoidEntities: ids(r.avoidEntities),
    used: ids(r.used),
    language: text(r.language, 40),
    notes: text(r.notes, 600),
    interestTags: ids(r.interestTags).slice(0, 8),
  }
}

function withTemplates(session: Session, taste: TasteRequest): Session {
  for (const slot of session.slots) {
    for (const it of [slot.item, ...slot.alternates]) {
      const tp = templatePrompts(it, taste)
      it.prompts = tp.prompts
      it.sensory = tp.sensory
    }
  }
  return session
}

/** Can this visitor use the model right now? The relay caps the plan too. */
async function mayUseModel(env: Env, request: Request): Promise<boolean> {
  if (!llmConnected(env)) return false
  if (!env.LLM_LIMIT) return true
  const ip = request.headers.get('cf-connecting-ip') ?? 'local'
  const { success } = await env.LLM_LIMIT.limit({ key: ip })
  return success
}

type Event =
  | { type: 'step'; step: TraceStep }
  | { type: 'plan'; session: Session }
  | { type: 'curated'; session: Session }
  | { type: 'moment'; slot: Slot }
  | { type: 'note'; message: string }
  | { type: 'done'; stats: Record<string, unknown> }
  | { type: 'error'; message: string }

/** Plans a session, sending each step as it happens: Qloo calls, the plan, then the curated version. */
async function runSession(env: Env, request: Request, taste: TasteRequest, send: (e: Event) => void, members?: TasteRequest[]) {
  const q = qloo(env)
  const t = Date.now()
  const onStep = (step: TraceStep) => send({ type: 'step', step })
  const run = poolRunner(env)
  const ask = asker(env)
  const group = members && members.length > 1 ? await planGroup(q, members, onStep, run) : undefined
  // The model's research runs alongside Qloo's own queries; it needs the model, so it is skipped when the model
  // is unavailable.
  const useModel = await mayUseModel(env, request)
  const researchCtx = buildCtx(q, taste, onStep)
  const ideas = !group && useModel ? research(env, researchCtx, ask).catch((e) => (console.error('research failed', e), undefined)) : Promise.resolve(undefined)
  const single = group ? undefined : await planSession(q, taste, onStep, { run })
  let session = group ? group.session : single!.session
  if (group) taste = group.combined
  send({ type: 'plan', session: withTemplates(session, taste) })
  if (single) {
    // Checked against Qloo only now, so these lookups never hold up the plan's own queries.
    const suggested = await ideas
    const extra = suggested
      ? await ground(researchCtx, suggested, single.pools, groundRunner(env, researchCtx)).catch((e) => (console.error('grounding failed', e), {}))
      : {}
    if (Object.keys(extra).length) {
      const pools = mergePools(single.pools, extra)
      const slots = assemble(single.ctx, pools, single.defs, single.anchor)
      session = withTemplates({ ...session, slots, trace: [...session.trace, ...researchCtx.trace] }, taste)
    }
  }
  let curated = false
  let cached = false
  if (session.slots.length && useModel) {
    try {
      send({ type: 'step', step: { tool: 'curator', detail: 'The curator is checking each pick for safety, era and culture' } })
      const tc = Date.now()
      const out = await curate(env, session, taste, members, (slot) => send({ type: 'moment', slot }), ask)
      if (group) out.session.servedBy = Object.fromEntries(out.session.slots.map((s) => [s.key, whoFor(s.item, group.owners)]))
      cached = out.cached
      curated = true
      const detail =
        out.reviewed === session.slots.length
          ? `Reviewed all ${out.reviewed} moments side by side and wrote the prompts`
          : `Reviewed ${out.reviewed} of ${session.slots.length} moments; the rest keep standard prompts`
      out.session.trace = [...session.trace, { tool: 'curator', detail, ms: Date.now() - tc }]
      send({ type: 'curated', session: out.session })
    } catch (e) {
      console.error('curate failed', (e as Error).message)
      send({ type: 'note', message: 'The writing assistant is unavailable right now, so these are standard prompts.' })
    }
  } else if (session.slots.length) {
    send({ type: 'note', message: 'Standard prompts for now: the writing assistant is busy.' })
  }
  send({ type: 'done', stats: { qlooCalls: q.calls, qlooCached: q.cached, curated, curatorCached: cached, ms: Date.now() - t } })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/mcp') {
      if (env.API_LIMIT) {
        const { success } = await env.API_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })
        if (!success) return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests' } }, 429)
      }
      return handleMcp(request, qloo(env), env, () => mayUseModel(env, request), poolRunner(env), asker(env))
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, qloo: quota, model: llmConnected(env) })
      }
      if (env.API_LIMIT) {
        const { success } = await env.API_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })
        if (!success) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429)
      }
      if (url.pathname === '/api/search' && request.method === 'POST') {
        const { q: text, types } = await body<{ q: string; types?: string[] }>(request)
        if (!text || typeof text !== 'string' || text.length > 100) throw new BadRequest('q is required')
        const wanted = Array.isArray(types) && types.length ? types.filter((t) => SEARCH_TYPES.includes(t)) : SEARCH_TYPES
        const found = await qloo(env).search(text, wanted, 8)
        return json({
          results: found.map((e) => ({
            id: e.entity_id,
            name: e.name,
            type: e.type ?? e.subtype,
            year: Number(String(e.properties?.release_year ?? e.properties?.start_year ?? e.properties?.date_of_birth ?? '').slice(0, 4)) || undefined,
            image: e.properties?.image?.url,
            popularity: e.popularity,
          })),
        })
      }
      if (url.pathname === '/api/interview' && request.method === 'POST') {
        const { birthYear, heritage, round, seeds } = await body<{ birthYear: number; heritage?: string[]; round?: string; seeds?: string[] }>(request)
        const year = Number(birthYear)
        if (!Number.isInteger(year) || year < 1900 || year > 2010) throw new BadRequest('birthYear must be between 1900 and 2010')
        const strings = (xs: unknown, n: number) => (Array.isArray(xs) ? xs.filter((h) => typeof h === 'string').map((h) => h.slice(0, 60)).slice(0, n) : [])
        const q = qloo(env)
        const pairs = round === 'film' ? await filmPairs(q, year, strings(heritage, 2), strings(seeds, 6)) : await musicPairs(q, year, strings(heritage, 2))
        return json({ pairs })
      }
      if (url.pathname === '/api/adjust' && request.method === 'POST') {
        const b = await body<{ taste: TasteRequest; request: string; moments?: string[] }>(request)
        const taste = validTaste(b.taste)
        const ask = typeof b.request === 'string' ? b.request.trim().slice(0, 400) : ''
        if (!ask) throw new BadRequest('Say what to change')
        if (!(await mayUseModel(env, request))) return json({ error: 'The assistant is busy. Try again in a minute.' }, 429)
        const moments = Array.isArray(b.moments) ? b.moments.filter((m) => typeof m === 'string').map((m) => m.slice(0, 100)).slice(0, 8) : []
        return json(await adjust(env, qloo(env), taste, ask, { moments }))
      }
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const raw = await body<TasteRequest & { members?: TasteRequest[] }>(request)
        const members = Array.isArray(raw.members) ? raw.members.slice(0, 8).map(validTaste) : undefined
        if (members && members.length < 2) throw new BadRequest('A group needs at least two people')
        const taste = members ? members[0] : validTaste(raw)
        if (url.searchParams.get('stream') === '1') {
          const { readable, writable } = new TransformStream()
          const writer = writable.getWriter()
          const enc = new TextEncoder()
          const send = (e: Event) => void writer.write(enc.encode(JSON.stringify(e) + '\n')).catch(() => undefined)
          ctx.waitUntil(
            runSession(env, request, taste, send, members)
              .catch((e) => send({ type: 'error', message: e instanceof QlooError ? 'Qloo request failed' : 'Something went wrong' }))
              .finally(() => writer.close().catch(() => undefined)),
          )
          return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
        }
        let last: Session | undefined
        let stats: Record<string, unknown> = {}
        const notes: string[] = []
        await runSession(
          env,
          request,
          taste,
          (e) => {
            if (e.type === 'plan' || e.type === 'curated') last = e.session
            if (e.type === 'done') stats = e.stats
            if (e.type === 'note') notes.push(e.message)
          },
          members,
        )
        return json({ session: last, stats, notes })
      }
      return json({ error: 'Not found' }, 404)
    } catch (e) {
      if (e instanceof BadRequest) return json({ error: e.message }, 400)
      if (e instanceof QlooError) return json({ error: 'Qloo request failed', status: e.status }, 502)
      console.error(e)
      return json({ error: 'Something went wrong' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
