// The taste engine: turns a person's era, place and favourites into a reminiscence session.
// Every item comes from Qloo; nothing here is invented.

import { LANDMARK_TAGS, MUSIC_PROBES } from '../shared/presets'
import type { Because, Domain, Item, Session, Slot, TasteRequest, TraceStep } from '../shared/types'
import type { Params, Qloo, QlooEntity, WeightedSignal } from './qloo'

export const TYPE: Record<Domain, string> = {
  music: 'urn:entity:artist',
  film: 'urn:entity:movie',
  tv: 'urn:entity:tv_show',
  star: 'urn:entity:person',
  place: 'urn:entity:place',
}

export function currentYear(): number {
  return new Date().getUTCFullYear()
}

/** The reminiscence bump: people recall the years from about age 10 to 30 most vividly. */
export function bumpWindow(birthYear: number): [number, number] {
  return [birthYear + 10, Math.min(birthYear + 30, currentYear())]
}

export function ageBracket(birthYear: number): string {
  const age = currentYear() - birthYear
  if (age >= 55) return '55_and_older'
  if (age >= 45) return '45_to_54'
  if (age >= 35) return '35_to_44'
  if (age >= 30) return '30_to_34'
  if (age >= 25) return '25_to_29'
  return '24_and_younger'
}

/** A city Qloo can resolve, so "people from there" can steer taste. */
const HERITAGE_CITY: Record<string, string> = {
  mexico: 'Mexico City', philippines: 'Manila', 'south korea': 'Seoul', korea: 'Seoul', japan: 'Tokyo', china: 'Beijing',
  vietnam: 'Ho Chi Minh City', india: 'Mumbai', italy: 'Rome', ireland: 'Dublin', poland: 'Warsaw', 'puerto rico': 'San Juan',
  cuba: 'Havana', 'dominican republic': 'Santo Domingo', germany: 'Berlin', greece: 'Athens', portugal: 'Lisbon',
  brazil: 'Rio de Janeiro', jamaica: 'Kingston', haiti: 'Port-au-Prince', 'el salvador': 'San Salvador',
  guatemala: 'Guatemala City', colombia: 'Bogotá', 'united kingdom': 'London', england: 'London', canada: 'Toronto',
  france: 'Paris', spain: 'Madrid', russia: 'Moscow', ukraine: 'Kyiv', iran: 'Tehran', lebanon: 'Beirut', egypt: 'Cairo',
  nigeria: 'Lagos', taiwan: 'Taipei', 'hong kong': 'Hong Kong',
}

export function heritageCity(country?: string): string | undefined {
  const c = country?.trim()
  if (!c) return undefined
  const city = HERITAGE_CITY[c.toLowerCase()]
  // Name the country too: to Qloo a bare "Kingston" is Kingston, Ontario.
  return city && city.toLowerCase() !== c.toLowerCase() ? `${city}, ${c}` : (city ?? c)
}

/** Films or TV from home. Qloo's taste signals know little about some countries' older titles, so when the
 *  personal query finds few, ask again for that country's best-known titles of those years. */
async function fromHome(ctx: Ctx, params: Params, countries: string[], what: string): Promise<QlooEntity[]> {
  if (!countries.length) return []
  const filter = { 'filter.release_country': countries, 'operator.filter.release_country': 'union' }
  const [a, b] = ctx.window
  const mine = await step(ctx, 'qloo.insights', `${what} made in ${countries.join(', ')} between ${a} and ${b}`, () =>
    ctx.q.insights({ ...params, ...filter }, ctx.signals),
  )
  if (mine.length >= 4 || !ctx.signals.length) return mine
  const plain: Params = { ...params, ...filter, 'feature.explainability': undefined, 'signal.demographics.age': undefined }
  const known = await step(ctx, 'qloo.insights', `Best-known ${what.toLowerCase()} from ${countries.join(', ')} in those years`, () =>
    ctx.q.insights(plain),
  )
  const seen = new Set(mine.map((e) => e.entity_id))
  return [...mine, ...known.filter((e) => !seen.has(e.entity_id))]
}

function abroad(req: TasteRequest): string[] {
  return (req.heritage ?? []).filter((c) => c && !/^(united states|usa|us|america)$/i.test(c.trim()))
}

/** Qloo reads a bare "Kingston" as Kingston, Ontario and "Athens" as Athens, Georgia. When their hometown is
 *  the main city of the country their family comes from, name the country too. */
function placeName(req: TasteRequest): string | undefined {
  const town = req.hometown?.trim()
  if (!town || town.includes(',')) return town || undefined
  const country = abroad(req).find((c) => HERITAGE_CITY[c.trim().toLowerCase()]?.toLowerCase() === town.toLowerCase())
  return country ? heritageCity(country) : town
}

/** Merge "from home" and general lists: one from home first, then interleave, without repeats. */
function mergeHome(home: Item[], general: Item[]): Item[] {
  const out: Item[] = []
  const seen = new Set<string>()
  const order = home.length ? [home[0], general[0], general[1], ...home.slice(1), ...general.slice(2)] : general
  for (const it of order) {
    if (!it) continue
    const k = it.name.toLowerCase()
    if (seen.has(it.id) || seen.has(k)) continue
    seen.add(it.id)
    seen.add(k)
    out.push(it)
  }
  return out
}

export interface Ctx {
  q: Qloo
  req: TasteRequest
  window: [number, number]
  trace: TraceStep[]
  names: Map<string, string>
  signals: WeightedSignal[]
  common: Params
  region?: string
  onStep?: (step: TraceStep) => void
}

export function buildCtx(q: Qloo, req: TasteRequest, onStep?: (step: TraceStep) => void, window?: [number, number]): Ctx {
  const names = new Map<string, string>()
  const signals: WeightedSignal[] = []
  for (const s of req.favorites ?? []) {
    if (names.has(s.id)) continue
    names.set(s.id, s.name)
    signals.push({ id: s.id, weight: s.weight ?? 10 })
  }
  for (const s of req.liked ?? []) {
    if (names.has(s.id)) continue
    names.set(s.id, s.name)
    signals.push({ id: s.id, weight: s.weight ?? 14 })
  }
  const exclude = [...(req.avoidEntities ?? []), ...(req.favorites ?? []).map((f) => f.id)].slice(0, 40)
  const common: Params = {
    // Age is only a fallback: with real favourites it drags results toward what today's older Qloo users
    // like (for a Mexican grandmother, Buñuel art films instead of Pedro Infante comedies).
    'signal.demographics.age': signals.length ? undefined : ageBracket(req.birthYear),
    'filter.exclude.tags': req.avoidTags?.length ? req.avoidTags : undefined,
    'filter.exclude.entities': exclude.length ? exclude : undefined,
    'signal.interests.tags': req.interestTags?.length ? req.interestTags : undefined,
    'feature.explainability': signals.length ? true : undefined,
  }
  return {
    q,
    req,
    window: window ?? bumpWindow(req.birthYear),
    trace: [],
    names,
    signals: signals.slice(0, 25),
    common,
    region: placeName(req),
    onStep,
  }
}

function record(ctx: Ctx, s: TraceStep) {
  ctx.trace.push(s)
  ctx.onStep?.(s)
}

async function step(ctx: Ctx, tool: string, detail: string, run: () => Promise<QlooEntity[]>): Promise<QlooEntity[]> {
  const t = Date.now()
  try {
    const out = await run()
    record(ctx, { tool, detail, count: out.length, ms: Date.now() - t })
    return out
  } catch (e) {
    record(ctx, { tool, detail: `${detail} (failed: ${(e as Error).message.slice(0, 160)})`, count: 0, ms: Date.now() - t })
    return []
  }
}

function seedText(ctx: Ctx): string {
  const names = [...ctx.names.values()]
  if (!names.length) return 'people their age'
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

function year(v: unknown): number | undefined {
  const n = Number(String(v ?? '').slice(0, 4))
  return Number.isFinite(n) && n > 1800 ? n : undefined
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v.startsWith('[')) {
    try {
      return JSON.parse(v.replace(/'/g, '"'))
    } catch {
      return []
    }
  }
  return v ? [String(v)] : []
}

function imageOf(p: Record<string, any>): string | undefined {
  const img = p.image?.url ?? p.images?.[0]?.url
  return Array.isArray(img) ? img[0] : img
}

/** Was this artist making records while the person was young? */
export function activeDuring(e: QlooEntity, [a, b]: [number, number]): boolean {
  const p = e.properties ?? {}
  const start = year(p.start_year)
  const end = year(p.end_year)
  if (start) return start <= b - 2 && start >= a - 25 && (!end || end >= a)
  const born = year(p.date_of_birth)
  if (born) return born >= a - 45 && born <= b - 15
  return false
}

function youtube(q: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

export function toItem(domain: Domain, e: QlooEntity, ctx: Ctx): Item {
  const p = e.properties ?? {}
  const because: Because[] = (e.query?.explainability?.['signal.interests.entities'] ?? [])
    .map((x) => ({ id: x.entity_id, name: ctx.names.get(x.entity_id) ?? '', share: Math.round(x.score * 100) / 100 }))
    .filter((b) => b.name)
    .sort((x, y) => y.share - x.share)
    .slice(0, 3)
  const tags = (e.tags ?? [])
    .filter((t) => /genre|theme|style|category:place/.test(t.type))
    .slice(0, 6)
    .map((t) => ({ id: t.id, name: t.name }))
  const description = String(p.short_description ?? p.description ?? '').slice(0, 280)
  const base = {
    domain,
    id: e.entity_id,
    name: e.name,
    type: e.type ?? TYPE[domain],
    image: imageOf(p),
    description,
    affinity: e.query?.affinity,
    popularity: e.popularity,
    because,
    prompts: [] as string[],
    tags,
  }
  switch (domain) {
    case 'music': {
      const song = list(p.notable_songs)[0]
      const start = year(p.start_year)
      const end = year(p.end_year)
      const born = year(p.date_of_birth)
      return {
        ...base,
        feature: song,
        era: start ?? (born ? born + 20 : undefined),
        when: start ? `${start}–${end ?? 'today'}` : undefined,
        link: youtube(`${e.name} ${song ?? ''}`.trim()),
      }
    }
    case 'film': {
      const y = year(p.release_year)
      return { ...base, year: y, era: y, when: y ? String(y) : undefined, link: youtube(`${e.name} ${y ?? ''} trailer`) }
    }
    case 'tv': {
      const y = year(p.release_year)
      const end = year(p.finale_year)
      return {
        ...base,
        year: y,
        era: y,
        when: y ? (end && end !== y ? `${y}–${end}` : String(y)) : undefined,
        link: youtube(`${e.name} ${y ?? ''} opening theme`),
      }
    }
    case 'star': {
      const born = year(p.date_of_birth)
      const work = list(p.notable_work)[0]
      return {
        ...base,
        feature: work,
        era: born,
        when: born ? `born ${born}` : undefined,
        description: description || list(p.short_descriptions).find((s) => /^[\x00-\x7F]*$/.test(s)) || '',
        link: youtube(`${e.name} ${work ?? ''}`.trim()),
      }
    }
    case 'place': {
      const address = String(p.address ?? '')
      return {
        ...base,
        feature: address,
        link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.name} ${address}`)}`,
      }
    }
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** How squarely an item sits in the person's teens and twenties (1 = dead centre). */
export function eraFit(it: Item, birthYear: number): number {
  if (!it.era) return 0.5
  switch (it.domain) {
    case 'film':
    case 'tv':
      return clamp01(1 - Math.abs(it.era - (birthYear + 19)) / 14)
    case 'music':
      // A career peaks a few years after the first record; best when that lands around age 18.
      return clamp01(1 - Math.abs(it.era + 5 - (birthYear + 18)) / 12)
    case 'star':
      // Stars of someone's youth were usually a few years older than them.
      return clamp01(1 - Math.abs(it.era - (birthYear - 7)) / 15)
    default:
      return 0.5
  }
}

const WEIGHTS: Record<Domain, [number, number, number]> = {
  // affinity, popularity (familiar things are easier to recognise), era fit
  music: [0.45, 0.25, 0.3],
  // Qloo popularity is global, so it favours internationally famous titles over a community's own favourites.
  film: [0.6, 0.15, 0.25],
  tv: [0.6, 0.15, 0.25],
  star: [0.45, 0.25, 0.3],
  place: [0.35, 0.65, 0],
}

function score(it: Item, ctx: Ctx): number {
  const aff = it.affinity ?? (it.domain === 'place' ? 0 : 0.6)
  const pop = it.popularity ?? 0.5
  const [wa, wp, we] = WEIGHTS[it.domain]
  let s = it.domain === 'place' && !ctx.signals.length ? pop : wa * aff + wp * pop + we * eraFit(it, ctx.req.birthYear)
  if (ctx.req.used?.includes(it.id)) s -= 0.5
  return s
}

function rank(items: Item[], ctx: Ctx): Item[] {
  const seen = new Set<string>()
  return items
    .map((it) => ({ it, s: score(it, ctx) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it)
    .filter((it) => {
      const k = it.name.toLowerCase()
      if (seen.has(k) || seen.has(it.id)) return false
      seen.add(k)
      seen.add(it.id)
      return true
    })
}

/** Tags to fall back on when we know nothing about someone's music except their age. */
function eraGenres(window: [number, number]): string[] {
  return MUSIC_PROBES.filter((m) => m.from <= window[1] && m.to >= window[0] && !/bolero|ranchera|trot/.test(m.tag)).map((m) => m.tag)
}

async function music(ctx: Ctx): Promise<Item[]> {
  const [a, b] = ctx.window
  const params: Params = { 'filter.type': TYPE.music, take: 50, ...ctx.common }
  const pool: QlooEntity[] = []
  if (ctx.signals.length) {
    pool.push(...(await step(ctx, 'qloo.insights', `Artists that fans of ${seedText(ctx)} love`, () => ctx.q.insights(params, ctx.signals))))
  }
  if (ctx.region) {
    pool.push(
      ...(await step(ctx, 'qloo.insights', `Artists with a following around ${ctx.region}`, () =>
        ctx.q.insights({ ...params, 'signal.location.query': ctx.region }, ctx.signals),
      )),
    )
  }
  const home = heritageCity(abroad(ctx.req)[0])
  if (home) {
    pool.push(
      ...(await step(ctx, 'qloo.insights', `Artists loved by people from ${home}`, () =>
        ctx.q.insights({ ...params, 'signal.location.query': home }, ctx.signals),
      )),
    )
  }
  if (!pool.length) {
    const tags = eraGenres(ctx.window)
    pool.push(
      ...(await step(ctx, 'qloo.insights', `Popular ${a}–${b} styles for people their age`, () =>
        ctx.q.insights({ ...params, 'signal.interests.tags': tags, 'filter.tags': tags, 'operator.filter.tags': 'union' }),
      )),
    )
  }
  const era = pool.filter((e) => activeDuring(e, ctx.window))
  record(ctx, { tool: 'filter.era', detail: `Kept artists who were recording between ${a} and ${b}`, count: era.length })
  return era.map((e) => toItem('music', e, ctx))
}

async function films(ctx: Ctx): Promise<Item[]> {
  const [a, b] = ctx.window
  const params: Params = {
    'filter.type': TYPE.film,
    'filter.release_year.min': a,
    'filter.release_year.max': b,
    take: 20,
    ...ctx.common,
  }
  const heritage = await fromHome(ctx, params, abroad(ctx.req), 'Films')
  const general = await step(ctx, 'qloo.insights', `Films released ${a}–${b} that fit their taste`, () => ctx.q.insights(params, ctx.signals))
  // A film from home comes first when we have one.
  return mergeHome(rank(heritage.map((e) => toItem('film', e, ctx)), ctx), rank(general.map((e) => toItem('film', e, ctx)), ctx))
}

async function shows(ctx: Ctx): Promise<Item[]> {
  const [a, b] = ctx.window
  if (b < 1948) return []
  const params: Params = {
    'filter.type': TYPE.tv,
    'filter.release_year.min': Math.max(a - 5, 1946),
    'filter.release_year.max': b,
    take: 20,
    ...ctx.common,
  }
  const heritage = await fromHome(ctx, params, abroad(ctx.req), 'TV')
  const general = await step(ctx, 'qloo.insights', `TV shows that started ${params['filter.release_year.min']}–${b}`, () =>
    ctx.q.insights(params, ctx.signals),
  )
  return mergeHome(rank(heritage.map((e) => toItem('tv', e, ctx)), ctx), rank(general.map((e) => toItem('tv', e, ctx)), ctx))
}

async function stars(ctx: Ctx): Promise<Item[]> {
  const by = ctx.req.birthYear
  const params: Params = {
    'filter.type': TYPE.star,
    'filter.date_of_birth.min': `${by - 30}-01-01`,
    'filter.date_of_birth.max': `${by + 5}-12-31`,
    take: 40,
    ...ctx.common,
  }
  const out = await step(ctx, 'qloo.insights', `Stars born ${by - 30}–${by + 5} that fans of ${seedText(ctx)} follow`, () =>
    ctx.q.insights(params, ctx.signals),
  )
  const home = heritageCity(abroad(ctx.req)[0])
  const fromHome = home
    ? await step(ctx, 'qloo.insights', `Stars of that generation loved in ${home}`, () =>
        ctx.q.insights({ ...params, 'signal.location.query': home }, ctx.signals),
      )
    : []
  return mergeHome(rank(fromHome.map((e) => toItem('star', e, ctx)), ctx), rank(out.map((e) => toItem('star', e, ctx)), ctx))
}

async function places(ctx: Ctx): Promise<Item[]> {
  if (!ctx.region) return []
  const params: Params = {
    'filter.type': TYPE.place,
    'filter.location.query': ctx.region,
    'filter.tags': LANDMARK_TAGS,
    'operator.filter.tags': 'union',
    'signal.demographics.age': ctx.common['signal.demographics.age'],
    'filter.exclude.tags': ctx.common['filter.exclude.tags'],
    'feature.explainability': ctx.common['feature.explainability'],
    take: 12,
  }
  const out = await step(ctx, 'qloo.insights', `Landmarks in ${ctx.region} that fans of ${seedText(ctx)} would know`, () =>
    ctx.q.insights(params, ctx.signals),
  )
  return out.map((e) => toItem('place', e, ctx))
}

/** The person's own favourite artist, with one of their best-known songs: the safest opener. */
async function anchor(ctx: Ctx): Promise<Item | undefined> {
  const fav = (ctx.req.favorites ?? []).find((s) => s.type === TYPE.music)
  if (!fav) return undefined
  const found = await step(ctx, 'qloo.insights', `Look up ${fav.name}'s best-known songs`, () =>
    ctx.q.insights({ 'filter.type': TYPE.music, 'filter.results.entities': fav.id }),
  )
  const e = found[0]
  if (!e) return undefined
  const it = toItem('music', e, ctx)
  it.because = [{ id: fav.id, name: fav.name, share: 1 }]
  return it
}

export interface SlotDef {
  key: string
  title: string
  minutes: number
  domain: Domain
}

const SLOTS: SlotDef[] = [
  { key: 'opener', title: 'A song they love', minutes: 3, domain: 'music' },
  { key: 'film', title: 'At the movies', minutes: 5, domain: 'film' },
  { key: 'star', title: 'A star of their day', minutes: 3, domain: 'star' },
  { key: 'tv', title: 'TV night', minutes: 4, domain: 'tv' },
  { key: 'place', title: 'Back home', minutes: 4, domain: 'place' },
  { key: 'closer', title: 'One more song', minutes: 3, domain: 'music' },
]

export interface PlanOptions {
  slots?: SlotDef[]
  window?: [number, number]
  /** Open with the person's own favourite song (single sessions) */
  anchor?: boolean
}

export type Pools = Record<Domain, Item[]>

/** Research items join each pool alternately with Qloo's own, so both reach the curator. */
export function mergePools(pools: Pools, extra: Partial<Record<Domain, Item[]>>): Pools {
  const out = { ...pools }
  for (const d of Object.keys(extra) as Domain[]) {
    const more = extra[d] ?? []
    if (!more.length) continue
    const merged: Item[] = []
    const seen = new Set<string>()
    for (let i = 0; i < Math.max(pools[d].length, more.length); i++) {
      for (const it of [pools[d][i], more[i]]) {
        if (!it || seen.has(it.id) || seen.has(it.name.toLowerCase())) continue
        seen.add(it.id)
        seen.add(it.name.toLowerCase())
        merged.push(it)
      }
    }
    out[d] = merged
  }
  return out
}

export async function planSession(
  q: Qloo,
  req: TasteRequest,
  onStep?: (step: TraceStep) => void,
  opts: PlanOptions = {},
): Promise<{ session: Session; ctx: Ctx; pools: Pools; anchor?: Item; defs: SlotDef[] }> {
  const ctx = buildCtx(q, req, onStep, opts.window)
  const defs = opts.slots ?? SLOTS
  const wants = (d: Domain) => defs.some((s) => s.domain === d)
  const none = async () => [] as Item[]
  const [mus, fil, tv, sta, pla, anc] = await Promise.all([
    wants('music') ? music(ctx) : none(),
    wants('film') ? films(ctx) : none(),
    wants('tv') ? shows(ctx) : none(),
    wants('star') ? stars(ctx) : none(),
    wants('place') ? places(ctx) : none(),
    opts.anchor === false ? Promise.resolve(undefined) : anchor(ctx),
  ])
  const pools: Pools = {
    music: rank(mus, ctx),
    film: fil, // already ordered, film from home first
    tv,
    star: sta, // already ordered, a star from home first
    place: rank(pla, ctx),
  }
  const slots = assemble(ctx, pools, defs, anc)
  record(ctx, { tool: 'plan', detail: `Built ${slots.length} moments for the ${ctx.window[0]}–${ctx.window[1]} years` })
  return { session: { window: ctx.window, slots, trace: ctx.trace, narration: 'template' }, ctx, pools, anchor: anc, defs }
}

/** Fill each moment from its pool: no repeats, no favourites twice, the person's own favourite song first. */
export function assemble(ctx: Ctx, pools: Pools, defs: SlotDef[], anc?: Item): Slot[] {
  const req = ctx.req
  const taken = new Set<string>()
  const key = (it: Item) => it.name.toLowerCase()
  // "The Clancy Brothers and Tommy Makem" is the same act as "The Clancy Brothers".
  const core = (name: string) => name.toLowerCase().replace(/^the /, '').replace(/[^a-z0-9 ]/g, '')
  const takenCores: string[] = (req.favorites ?? []).map((f) => core(f.name))
  const fresh = (it: Item) => {
    const c = core(it.name)
    return !taken.has(key(it)) && !taken.has(it.id) && !takenCores.some((t) => t.length >= 6 && (c.includes(t) || t.includes(c)))
  }
  const slots: Slot[] = []
  const rests: Item[][] = []
  for (const s of defs) {
    let candidates = pools[s.domain].filter(fresh)
    if (s.key === 'opener' && anc && !taken.has(key(anc))) candidates = [anc, ...candidates.filter((c) => c.id !== anc.id)]
    if (!candidates.length) continue
    const [item, ...rest] = candidates
    taken.add(key(item))
    taken.add(item.id)
    takenCores.push(core(item.name))
    slots.push({ key: s.key, title: s.title, minutes: s.minutes, item, alternates: [] })
    rests.push(rest)
  }
  // Alternates are dealt out in turns and each goes to one moment only, so moments that share a pool (the
  // opening and closing songs) get different candidates of similar strength, and the curator, which sees each
  // moment on its own, cannot pick the same one twice.
  for (let round = 0; round < 5; round++) {
    slots.forEach((slot, i) => {
      while (rests[i].length) {
        const it = rests[i].shift()!
        if (!fresh(it)) continue
        slot.alternates.push(it)
        taken.add(key(it))
        taken.add(it.id)
        break
      }
    })
  }
  return slots
}
