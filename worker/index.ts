import { WorkerEntrypoint } from 'cloudflare:workers'
import type { Domain, Item, Session, Slot, TasteRequest, TraceStep } from '../shared/types'
import { adjust } from './agent'
import { curate } from './curate'
import { assemble, buildCtx, mergePools, planSession, pool, record, TYPE, type PoolKind, type PoolRunner, type Pools, type SlotDef } from './engine'
import { ground, groundDomain, research, type GroundRunner, type Grounded, type Suggestions } from './scout'
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

/** On the free plan an invocation may use 10 ms of CPU, and much of that goes on waking up: each answer or event it
 *  has to handle costs about a quarter of a millisecond. So a session is spread over several invocations, each
 *  handling only a few of them. Pools and grounded items come back as JSON text, which is cheaper to read than the
 *  same objects sent over RPC, and a pool's Qloo steps come back with it rather than one message each. */
interface PlannerLike {
  pool(kind: PoolKind, req: TasteRequest, window: [number, number]): Promise<{ pool: string } & Counted>
  ground(domain: Domain, wanted: { name: string; year?: number }[], req: TasteRequest, window: [number, number], poolNames: string[]): Promise<{ grounded: string } & Counted>
  ask(opts: StructuredRequest): Promise<{ data: unknown; cached: boolean }>
  session(taste: TasteRequest, members: TasteRequest[] | undefined, useModel: boolean, out: WritableStream): Promise<void>
  finish(planned: string, out: WritableStream): Promise<void>
}

const SEARCH_TYPES = [TYPE.music, TYPE.film, TYPE.tv, TYPE.star]

/** Fetches and trims one Qloo answer in its own invocation (reached only through the QLOO_PROXY binding). */
export class QlooProxy extends WorkerEntrypoint<Env> {
  async fetchTrimmed(method: 'GET' | 'POST', path: string, payload: unknown) {
    return new Qloo(this.env.QLOO_API_KEY).fetchTrimmed(method, path, payload)
  }
}

const qloo = (env: Env) => new Qloo(env.QLOO_API_KEY, env.QLOO_PROXY)

/** Writes events to a stream as lines of JSON. */
function lineWriter(out: WritableStream) {
  const writer = out.getWriter()
  const enc = new TextEncoder()
  let last: Promise<unknown> = Promise.resolve()
  return {
    send: (e: Event) => {
      last = writer.write(enc.encode(JSON.stringify(e) + '\n')).catch(() => undefined)
    },
    /** Lets another invocation write next, once everything sent so far is written. */
    release: async () => {
      await last
      writer.releaseLock()
    },
    close: async () => {
      await last
      await writer.close().catch(() => undefined)
    },
  }
}

const failure = (e: unknown): Event => ({ type: 'error', message: e instanceof QlooError ? 'Qloo request failed' : 'Something went wrong' })

/** Builds one pool, checks one domain's research or makes one model call, each in its own invocation, and runs a
 *  streamed session in two halves (see PlannerLike). */
export class Planner extends WorkerEntrypoint<Env> {
  async pool(kind: PoolKind, req: TasteRequest, window: [number, number]) {
    const q = qloo(this.env)
    const ctx = buildCtx(q, req, undefined, window)
    const items = await pool(kind, ctx)
    return { pool: JSON.stringify({ items, steps: ctx.trace }), calls: q.calls, cached: q.cached }
  }

  async ground(domain: Domain, wanted: { name: string; year?: number }[], req: TasteRequest, window: [number, number], poolNames: string[]) {
    const q = qloo(this.env)
    const out = await groundDomain(buildCtx(q, req, undefined, window), domain, wanted, poolNames)
    return { grounded: JSON.stringify(out), calls: q.calls, cached: q.cached }
  }

  /** One model call: reading and caching its answer here keeps that work off the session's own invocations. */
  async ask(opts: StructuredRequest) {
    return structured<unknown>(this.env, opts)
  }

  /** The first half of a streamed session: Qloo's plan, with the model's research alongside. */
  async session(taste: TasteRequest, members: TasteRequest[] | undefined, useModel: boolean, out: WritableStream) {
    const lines = lineWriter(out)
    let planned: Planned
    try {
      planned = await planHalf(this.env, taste, members, useModel, lines.send)
    } catch (e) {
      console.error('planning failed', (e as Error).message)
      lines.send(failure(e))
      return lines.close()
    }
    await lines.release()
    try {
      await this.env.PLANNER!.finish(JSON.stringify(planned), out)
    } catch (e) {
      // finish() reports its own failures; this one never started.
      console.error('finishing failed', (e as Error).message)
      const again = lineWriter(out)
      again.send(failure(e))
      await again.close()
    }
  }

  /** The second half: research checked against Qloo, then the curator. */
  async finish(planned: string, out: WritableStream) {
    const lines = lineWriter(out)
    try {
      await finishHalf(this.env, JSON.parse(planned) as Planned, lines.send)
    } catch (e) {
      console.error('finishing failed', (e as Error).message)
      lines.send(failure(e))
    }
    await lines.close()
  }
}

/** Pools built by the Planner when the binding is there (on Cloudflare and in local dev), else right here. */
function poolRunner(env: Env): PoolRunner | undefined {
  const planner = env.PLANNER
  if (!planner) return undefined
  return async (kind, ctx) => {
    const out = await planner.pool(kind, ctx.req, ctx.window)
    ctx.q.calls += out.calls
    ctx.q.cached += out.cached
    const { items, steps } = JSON.parse(out.pool) as { items: Item[]; steps: TraceStep[] }
    for (const step of steps) record(ctx, step)
    return items
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
    return JSON.parse(out.grounded) as Grounded
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

/** What the second half of a session needs from the first. */
interface Planned {
  taste: TasteRequest
  members?: TasteRequest[]
  useModel: boolean
  started: number
  calls: number
  cached: number
  session: Session
  /** One person: Qloo's pools and the model's research, to be checked against Qloo and folded in. */
  single?: { pools: Pools; defs: SlotDef[]; anchor?: Item; window: [number, number]; suggested?: Suggestions; trace: TraceStep[] }
  /** A group: which people each favourite belongs to. */
  owners?: [string, number[]][]
}

/** Qloo's plan, sent as soon as it is ready; the model's research runs alongside Qloo's own queries. */
async function planHalf(env: Env, taste: TasteRequest, members: TasteRequest[] | undefined, useModel: boolean, send: (e: Event) => void): Promise<Planned> {
  const q = qloo(env)
  const started = Date.now()
  const onStep = (step: TraceStep) => send({ type: 'step', step })
  const run = poolRunner(env)
  const group = members && members.length > 1 ? await planGroup(q, members, onStep, run) : undefined
  const researchCtx = buildCtx(q, taste, onStep)
  // Research needs the model, so it is skipped when the model is unavailable.
  const ideas = !group && useModel ? research(env, researchCtx, asker(env)).catch((e) => (console.error('research failed', e), undefined)) : Promise.resolve(undefined)
  const single = group ? undefined : await planSession(q, taste, onStep, { run })
  const session = group ? group.session : single!.session
  if (group) taste = group.combined
  send({ type: 'plan', session: withTemplates(session, taste) })
  const suggested = await ideas
  return {
    taste,
    members,
    useModel,
    started,
    calls: q.calls,
    cached: q.cached,
    session,
    single: single && { pools: single.pools, defs: single.defs, anchor: single.anchor, window: single.ctx.window, suggested, trace: researchCtx.trace },
    owners: group && [...group.owners],
  }
}

/** Research checked against Qloo and folded into the plan, then the curator's review, moment by moment. */
async function finishHalf(env: Env, p: Planned, send: (e: Event) => void) {
  const q = qloo(env)
  q.calls = p.calls
  q.cached = p.cached
  const onStep = (step: TraceStep) => send({ type: 'step', step })
  const { taste, members } = p
  let session = p.session
  const s = p.single
  if (s?.suggested) {
    // Checked against Qloo only now, so these lookups never hold up the plan's own queries.
    const researchCtx = buildCtx(q, taste, onStep, s.window)
    researchCtx.trace = [...s.trace]
    const extra = await ground(researchCtx, s.suggested, s.pools, groundRunner(env, researchCtx)).catch((e) => (console.error('grounding failed', e), {}))
    if (Object.keys(extra).length) {
      const slots = assemble(researchCtx, mergePools(s.pools, extra), s.defs, s.anchor)
      session = withTemplates({ ...session, slots, trace: [...session.trace, ...researchCtx.trace] }, taste)
    }
  }
  let curated = false
  let cached = false
  if (session.slots.length && p.useModel) {
    try {
      send({ type: 'step', step: { tool: 'curator', detail: 'The curator is checking each pick for safety, era and culture' } })
      const tc = Date.now()
      const out = await curate(env, session, taste, members, (slot) => send({ type: 'moment', slot }), asker(env))
      if (p.owners) {
        const owners = new Map(p.owners)
        out.session.servedBy = Object.fromEntries(out.session.slots.map((x) => [x.key, whoFor(x.item, owners)]))
      }
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
      // The plan as it stands after research, with standard prompts.
      send({ type: 'plan', session })
      send({ type: 'note', message: 'The writing assistant is unavailable right now, so these are standard prompts.' })
    }
  } else if (session.slots.length) {
    send({ type: 'note', message: 'Standard prompts for now: the writing assistant is busy.' })
  }
  send({ type: 'done', stats: { qlooCalls: q.calls, qlooCached: q.cached, curated, curatorCached: cached, ms: Date.now() - p.started } })
}

/** Plans a session in this invocation, sending each step as it happens: Qloo calls, the plan, then the curated
 *  version. Used without the Planner binding, and for the plain JSON answer. */
async function runSession(env: Env, useModel: boolean, taste: TasteRequest, send: (e: Event) => void, members?: TasteRequest[]) {
  await finishHalf(env, await planHalf(env, taste, members, useModel, send), send)
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
      if (url.pathname === '/api/prefetch' && request.method === 'POST') {
        // The model's research takes longer than Qloo's plan, so it starts when the person's page opens; by the time
        // a session is asked for, its answer is usually waiting in the cache.
        const taste = validTaste(await body<TasteRequest>(request))
        if (await mayUseModel(env, request)) ctx.waitUntil(research(env, buildCtx(qloo(env), taste), asker(env)).catch(() => undefined))
        return json({ ok: true }, 202)
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
        const useModel = await mayUseModel(env, request)
        if (url.searchParams.get('stream') === '1') {
          const headers = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' }
          if (env.PLANNER) {
            // The Planner plans the session and writes it straight into this stream; this request only passes it on.
            const { readable, writable } = new IdentityTransformStream()
            ctx.waitUntil(env.PLANNER.session(taste, members, useModel, writable).catch((e) => console.error('session failed', (e as Error).message)))
            return new Response(readable, { headers })
          }
          const { readable, writable } = new TransformStream()
          const writer = writable.getWriter()
          const enc = new TextEncoder()
          const send = (e: Event) => void writer.write(enc.encode(JSON.stringify(e) + '\n')).catch(() => undefined)
          ctx.waitUntil(
            runSession(env, useModel, taste, send, members)
              .catch((e) => send(failure(e)))
              .finally(() => writer.close().catch(() => undefined)),
          )
          return new Response(readable, { headers })
        }
        let last: Session | undefined
        let stats: Record<string, unknown> = {}
        const notes: string[] = []
        await runSession(
          env,
          useModel,
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
