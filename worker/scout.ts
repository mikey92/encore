// Research, then verification. Qloo's taste graph is thin for some countries' older TV and stars, while a
// language model knows them. So the model suggests what people of this background loved, and Qloo decides:
// every suggestion must resolve to a Qloo entity, sit in the person's youth, and is scored against their
// favourites with Qloo's affinity and explainability. Anything Qloo can't ground is dropped.

import type { Domain, Item } from '../shared/types'
import { activeDuring, toItem, TYPE, type Ctx, type Pools } from './engine'
import { structured, type LlmEnv } from './llm'
import type { QlooEntity } from './qloo'

const item = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: ['name', ...Object.keys(extra)],
  properties: { name: { type: 'string' }, ...extra },
})

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['music', 'film', 'tv', 'star', 'place'],
  properties: {
    music: { type: 'array', items: item() },
    film: { type: 'array', items: item({ year: { type: 'integer' } }) },
    tv: { type: 'array', items: item({ year: { type: 'integer' } }) },
    star: { type: 'array', items: item() },
    place: { type: 'array', items: item() },
  },
}

const INSTRUCTIONS = `You help plan a reminiscence session for one person living with dementia. List what people of their background most loved when they were about 10 to 30 years old (the years are given): singers or groups, films, TV shows, stars (actors, singers, comedians, sports heroes) and landmarks of their hometown that existed then. Favour the culture they grew up in. Leave out anything about war, violence or tragedy, and anything they asked to avoid. Up to four of each, real and widely known, with exact titles and release years. Write every name in Latin letters as English-language databases such as IMDb list it: a film's English title if it has one, otherwise its original title transliterated. List fewer rather than guess.`

export interface Suggestions {
  music: { name: string }[]
  film: { name: string; year: number }[]
  tv: { name: string; year: number }[]
  star: { name: string }[]
  place: { name: string }[]
}

function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/^(the|a|an|la|el|le|il|los|las|die|der|das) /, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sameName(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  // "Desmond Dekker & The Aces" is Desmond Dekker; a hotel on "Beale Street" is not Beale Street.
  return Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x))
}

/** A place must be in their hometown: "National Stadium" in Kingston, Jamaica is not the one in Kuala Lumpur.
 *  With a country given, the address must name it (Greek addresses say "Athina", not "Athens"). */
function inRegion(e: QlooEntity, region?: string): boolean {
  if (!region) return true
  const address = norm(String(e.properties?.address ?? ''))
  const parts = region.split(',').map(norm).filter(Boolean)
  return !!address && address.includes(parts[parts.length - 1])
}

function year(v: unknown): number | undefined {
  const n = Number(String(v ?? '').slice(0, 4))
  return Number.isFinite(n) && n > 1800 ? n : undefined
}

/** Step one: the model's suggestions for this person (no Qloo calls, so it can run alongside the plan). */
export async function research(env: LlmEnv, ctx: Ctx): Promise<Suggestions> {
  const req = ctx.req
  const t = Date.now()
  const { data } = await structured<Suggestions>(env, {
    name: 'research',
    instructions: INSTRUCTIONS,
    input: JSON.stringify({
      born: req.birthYear,
      youth_years: ctx.window,
      hometown: req.hometown ?? null,
      heritage: req.heritage ?? [],
      home_language: req.language ?? null,
      favourites: [...(req.favorites ?? []), ...(req.liked ?? [])].map((f) => f.name),
      notes: req.notes ?? null,
    }),
    schema: SCHEMA,
  })
  const asked = Object.values(data).reduce((n, xs) => n + xs.length, 0)
  ctx.trace.push({ tool: 'research', detail: `The research assistant suggested ${asked} titles from their background`, count: asked, ms: Date.now() - t })
  ctx.onStep?.(ctx.trace[ctx.trace.length - 1])
  return data
}

/** Step two: Qloo decides. A suggestion already among Qloo's own picks is not looked up again; the two agreeing
 *  is a reason to offer it early. The rest must resolve to a Qloo entity from the person's youth. Items come
 *  back in the model's order. */
export async function ground(ctx: Ctx, data: Suggestions, pools?: Partial<Pools>): Promise<Partial<Record<Domain, Item[]>>> {
  const req = ctx.req
  const [a, b] = ctx.window
  const t = Date.now()
  const asked = Object.values(data).reduce((n, xs) => n + Math.min(4, xs.length), 0)
  let agreed = 0
  let missing = 0
  let outside = 0
  let unscored = 0
  const out: Partial<Record<Domain, Item[]>> = {}
  const domains: Domain[] = ['music', 'film', 'tv', 'star', 'place']
  await Promise.all(
    domains.map(async (d) => {
      const wanted = (data[d] ?? []).slice(0, 4)
      const own = wanted.map((w) => pools?.[d]?.find((it) => sameName(it.name, w.name)))
      // 1. Does Qloo know it?
      const found = await Promise.all(
        wanted.map(async (w, i) => {
          if (own[i]) return undefined
          const query = d === 'place' && ctx.region ? `${w.name} ${ctx.region}` : w.name
          const hits = await ctx.q.search(query.slice(0, 90), [TYPE[d]], 4).catch(() => [] as QlooEntity[])
          const wantYear = 'year' in w ? (w as { year: number }).year : undefined
          return hits.find(
            (h) =>
              sameName(h.name, w.name) &&
              (d !== 'place' || inRegion(h, ctx.region)) &&
              (!wantYear || !year(h.properties?.release_year) || Math.abs(year(h.properties?.release_year)! - wantYear) <= 2),
          )
        }),
      )
      const hits = new Map(found.filter((e): e is QlooEntity => !!e).map((e) => [e.entity_id, e]))
      const ids = [...hits.keys()]
      // 2. Score it against their favourites, and get the full entity. Qloo has no taste data yet for some
      //    entities it knows (many older stars from outside the U.S.); those stay, unscored, as search found them.
      const scored = ids.length
        ? await ctx.q
            .insights({ 'filter.type': TYPE[d], 'filter.results.entities': ids, 'feature.explainability': ctx.signals.length ? true : undefined }, ctx.signals)
            .catch(() => [] as QlooEntity[])
        : []
      const got = new Set(scored.map((e) => e.entity_id))
      const rest = ids.filter((id) => !got.has(id)).map((id) => hits.get(id)!)
      // 3. Is it from their youth?
      const fits = new Map(
        [...scored, ...rest]
          .filter((e) => {
            const p = e.properties ?? {}
            if (d === 'film' || d === 'tv') {
              const y = year(p.release_year)
              return !y || (y >= a - 3 && y <= b)
            }
            if (d === 'music') return activeDuring(e, ctx.window) || !p.start_year
            if (d === 'star') {
              const born = year(p.date_of_birth)
              return !born || (born >= req.birthYear - 35 && born <= req.birthYear + 10)
            }
            return true
          })
          .map((e) => [e.entity_id, e]),
      )
      outside += ids.length - fits.size
      const items: Item[] = []
      wanted.forEach((_, i) => {
        if (own[i]) {
          agreed++
          items.push(own[i]!)
          return
        }
        const e = found[i] && fits.get(found[i]!.entity_id)
        if (!found[i]) missing++
        else if (e) {
          if (!got.has(e.entity_id)) unscored++
          items.push({ ...toItem(d, e, ctx), source: 'research' as const })
        }
      })
      out[d] = items.filter((it, i) => items.findIndex((x) => x.id === it.id) === i)
    }),
  )
  const added = Object.values(out).reduce((n, xs) => n + (xs?.filter((it) => it.source === 'research').length ?? 0), 0)
  const parts = [
    `${added} added${unscored ? ` (${unscored} without Qloo taste data yet)` : ''}`,
    agreed ? `${agreed} already among Qloo’s picks` : '',
    missing ? `${missing} not in Qloo` : '',
    outside ? `${outside} outside their years` : '',
  ].filter(Boolean)
  ctx.trace.push({
    tool: 'qloo.verify',
    detail: `Qloo checked ${asked} suggestions: ${parts.join(', ')}`,
    count: added + agreed,
    ms: Date.now() - t,
  })
  ctx.onStep?.(ctx.trace[ctx.trace.length - 1])
  return out
}
