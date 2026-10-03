// Encore as an MCP server, so an agent people already use (Claude, ChatGPT, an IDE agent) can plan a
// reminiscence session with Qloo's taste graph. Stateless Streamable HTTP: JSON-RPC in, JSON out.

import { AVOID_PRESETS } from '../shared/presets'
import type { Seed, Session, TasteRequest } from '../shared/types'
import { curate } from './curate'
import { planSession, TYPE, type SlotDef } from './engine'
import type { LlmEnv } from './llm'
import type { Qloo } from './qloo'
import { templatePrompts } from './templates'

const PROTOCOL = '2025-06-18'

const TOOLS = [
  {
    name: 'plan_reminiscence_session',
    title: 'Plan a reminiscence session',
    description:
      'Plan a 20-minute reminiscence session for one person living with dementia: a song they love, a film, a star, a TV show, a hometown landmark and a closing song from the years they were about 10 to 30, found through Qloo’s taste graph and reviewed for safety. Returns each moment with conversation prompts.',
    inputSchema: {
      type: 'object',
      required: ['birth_year'],
      properties: {
        birth_year: { type: 'integer', minimum: 1915, maximum: 1975 },
        hometown: { type: 'string', description: 'Where they grew up, e.g. "Memphis"' },
        heritage: { type: 'string', description: 'Country of family roots if not the U.S., e.g. "Mexico"' },
        language: { type: 'string', description: 'Home language for the prompts, e.g. "Spanish"' },
        favorites: { type: 'array', items: { type: 'string' }, description: 'Singers, films, TV shows or stars they love' },
        avoid: { type: 'array', items: { type: 'string', enum: Object.keys(AVOID_PRESETS) } },
        notes: { type: 'string', description: 'Helpful facts without names, e.g. "sang in the church choir"' },
      },
    },
  },
  {
    name: 'find_youth_favorites',
    title: 'Find favourites from their youth',
    description:
      'List music, films, TV shows or stars from the years someone was about 10 to 30 that people with their tastes love, from Qloo’s taste graph, each with the favourite it connects to.',
    inputSchema: {
      type: 'object',
      required: ['birth_year', 'kind'],
      properties: {
        birth_year: { type: 'integer', minimum: 1915, maximum: 1975 },
        kind: { type: 'string', enum: ['music', 'film', 'tv', 'star'] },
        favorites: { type: 'array', items: { type: 'string' } },
        heritage: { type: 'string' },
      },
    },
  },
]

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any }

async function resolveFavorites(q: Qloo, names: unknown): Promise<Seed[]> {
  const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string').slice(0, 6) : []
  const found = await Promise.all(
    list.map(async (name) => {
      const hits = await q.search(name.slice(0, 80), [TYPE.music, TYPE.film, TYPE.tv, TYPE.star], 1).catch(() => [])
      const e = hits[0]
      return e ? { id: e.entity_id, name: e.name, type: e.type ?? e.subtype ?? '' } : undefined
    }),
  )
  return found.filter((x): x is Seed => !!x)
}

function taste(args: any, favorites: Seed[]): TasteRequest {
  const year = Number(args.birth_year)
  if (!Number.isInteger(year) || year < 1915 || year > 1975) throw new Error('birth_year must be between 1915 and 1975')
  const avoid: string[] = Array.isArray(args.avoid) ? args.avoid : ['war']
  return {
    birthYear: year,
    hometown: typeof args.hometown === 'string' ? args.hometown.slice(0, 80) : undefined,
    heritage: typeof args.heritage === 'string' && args.heritage ? [args.heritage.slice(0, 40)] : [],
    language: typeof args.language === 'string' ? args.language.slice(0, 40) : undefined,
    notes: typeof args.notes === 'string' ? args.notes.slice(0, 500) : undefined,
    favorites,
    avoidTags: avoid.flatMap((k) => AVOID_PRESETS[k]?.tags ?? []),
  }
}

function asText(s: Session): string {
  const lines = [`Session for the years ${s.window[0]}–${s.window[1]}${s.opening ? `\nBegin: ${s.opening}` : ''}`]
  s.slots.forEach((slot, i) => {
    const it = slot.item
    lines.push(
      `\n${i + 1}. ${slot.title} (${slot.minutes} min): ${it.name}${it.when ? ` (${it.when})` : ''}${it.feature ? `, ${it.feature}` : ''}`,
      it.why ? `   Why: ${it.why}` : '',
      ...(it.promptsNative?.length ? it.promptsNative : it.prompts).map((p) => `   - ${p}`),
      it.sensory ? `   Senses: ${it.sensory}` : '',
      it.link ? `   Link: ${it.link}` : '',
    )
  })
  if (s.closing) lines.push(`\nEnd: ${s.closing}`)
  return lines.filter(Boolean).join('\n')
}

async function callTool(name: string, args: any, q: Qloo, env: LlmEnv, mayCurate: () => Promise<boolean>) {
  if (name === 'plan_reminiscence_session') {
    const t = taste(args, await resolveFavorites(q, args.favorites))
    let { session } = await planSession(q, t)
    for (const slot of session.slots)
      for (const it of [slot.item, ...slot.alternates]) Object.assign(it, templatePrompts(it, t))
    if (session.slots.length && (await mayCurate())) session = (await curate(env, session, t).catch(() => ({ session }))).session
    const compact = { ...session, trace: undefined, slots: session.slots.map((s) => ({ ...s, alternates: s.alternates.map((a) => a.name) })) }
    return { content: [{ type: 'text', text: asText(session) }], structuredContent: compact }
  }
  if (name === 'find_youth_favorites') {
    const t = taste(args, await resolveFavorites(q, args.favorites))
    const domain = (['music', 'film', 'tv', 'star'].includes(args.kind) ? args.kind : 'music') as SlotDef['domain']
    const { session } = await planSession(q, t, undefined, { slots: [{ key: 'pick', title: 'Picks', minutes: 0, domain }], anchor: false })
    const items = session.slots.flatMap((s) => [s.item, ...s.alternates])
    const rows = items.map((it) => ({
      name: it.name,
      when: it.when,
      known_for: it.feature,
      because: it.because.map((b) => b.name),
      qloo_affinity: it.affinity,
      link: it.link,
    }))
    const text = rows.map((r) => `- ${r.name}${r.when ? ` (${r.when})` : ''}${r.because.length ? `, because they love ${r.because.join(', ')}` : ''}`).join('\n')
    return { content: [{ type: 'text', text: text || 'Nothing found for those years.' }], structuredContent: { items: rows } }
  }
  throw new Error(`Unknown tool: ${name}`)
}

export async function handleMcp(request: Request, q: Qloo, env: LlmEnv, mayCurate: () => Promise<boolean>): Promise<Response> {
  if (request.method !== 'POST') return new Response('Encore MCP endpoint: POST JSON-RPC here.', { status: 405, headers: { Allow: 'POST' } })
  let payload: Rpc | Rpc[]
  try {
    payload = (await request.json()) as Rpc | Rpc[]
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }
  const messages = Array.isArray(payload) ? payload : [payload]
  const replies = []
  for (const m of messages) {
    if (m.id === undefined || m.id === null) continue // notifications get no reply
    try {
      let result: unknown
      switch (m.method) {
        case 'initialize':
          result = {
            protocolVersion: m.params?.protocolVersion ?? PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'encore', title: 'Encore', version: '1.0.0' },
            instructions: 'Plan reminiscence sessions for people living with dementia from Qloo’s taste graph. Never send names.',
          }
          break
        case 'ping':
          result = {}
          break
        case 'tools/list':
          result = { tools: TOOLS }
          break
        case 'tools/call':
          try {
            result = await callTool(m.params?.name, m.params?.arguments ?? {}, q, env, mayCurate)
          } catch (e) {
            result = { content: [{ type: 'text', text: (e as Error).message }], isError: true }
          }
          break
        default:
          replies.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } })
          continue
      }
      replies.push({ jsonrpc: '2.0', id: m.id, result })
    } catch (e) {
      replies.push({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: (e as Error).message } })
    }
  }
  if (!replies.length) return new Response(null, { status: 202 })
  return Response.json(Array.isArray(payload) ? replies : replies[0])
}
