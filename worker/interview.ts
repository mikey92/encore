// This-or-that: when family can't name a favourite, show two era-right choices at a time and let the
// person point. Music comes first; the artists they choose then steer which films are offered, so the
// second round is asked through the taste graph rather than from a fixed list.

import { AVOID_PRESETS, FILM_PROBES, MUSIC_PROBES } from '../shared/presets'
import type { Item } from '../shared/types'
import { activeDuring, bumpWindow, eraFit, heritageCity, TYPE } from './engine'
import type { Qloo, QlooEntity } from './qloo'

export interface Card {
  id: string
  name: string
  type: string
  label: string
  when?: string
  image?: string
}

const LATIN = /mexico|cuba|puerto rico|dominican|colombia|guatemala|el salvador|spain|argentina|peru|venezuela|chile|honduras|nicaragua|ecuador/i
const KOREA = /korea/i
const HOME_STYLES = /bolero|ranchera|trot/
/** Nothing dark in a game meant to be light. */
const GENTLE = [
  ...AVOID_PRESETS.war.tags,
  ...AVOID_PRESETS.horror.tags,
  ...AVOID_PRESETS.violence.tags,
  'urn:tag:genre:media:crime',
  'urn:tag:genre:media:thriller',
]

function image(e: QlooEntity): string | undefined {
  const img = e.properties?.image?.url
  return Array.isArray(img) ? img[0] : img
}

function year(v: unknown): number | undefined {
  const n = Number(String(v ?? '').slice(0, 4))
  return Number.isFinite(n) && n > 1800 ? n : undefined
}

function card(e: QlooEntity, label: string, type: string): Card {
  const p = e.properties ?? {}
  const when = type === TYPE.film ? String(p.release_year ?? '').slice(0, 4) : p.start_year ? `${p.start_year}–${p.end_year ?? 'today'}` : undefined
  return { id: e.entity_id, name: e.name, type, label, when: when || undefined, image: image(e) }
}

function pair(cards: (Card | undefined)[], seen: Set<string>): [Card, Card][] {
  const ok: Card[] = []
  for (const c of cards) {
    if (!c || seen.has(c.id) || seen.has(c.name.toLowerCase())) continue
    seen.add(c.id)
    seen.add(c.name.toLowerCase())
    ok.push(c)
  }
  const out: [Card, Card][] = []
  for (let i = 0; i + 1 < ok.length; i += 2) out.push([ok[i], ok[i + 1]])
  return out
}

/** Round one: music styles of their youth, styles from home first. */
export async function musicPairs(q: Qloo, birthYear: number, heritage: string[] = []): Promise<[Card, Card][]> {
  // Round to five years so neighbours share Qloo's cached answers.
  const by = Math.round(birthYear / 5) * 5
  const window = bumpWindow(by)
  const [a, b] = window
  const home = heritage.find((h) => !/^(united states|usa|us|america)$/i.test(h))
  const city = heritageCity(home)
  const styles = MUSIC_PROBES.filter((m) => m.from <= b && m.to >= a)
    .filter((m) => {
      if (/bolero|ranchera/.test(m.tag)) return !!home && LATIN.test(home)
      if (/trot/.test(m.tag)) return !!home && KOREA.test(home)
      return true
    })
    .sort((x, y) => Number(HOME_STYLES.test(y.tag)) - Number(HOME_STYLES.test(x.tag)))
    .slice(0, 6)
  const cards = await Promise.all(
    styles.map(async (m) => {
      const params: Record<string, string | number> = { 'filter.type': TYPE.music, 'filter.tags': m.tag, take: 30 }
      if (city && HOME_STYLES.test(m.tag)) params['signal.location.query'] = city
      else params['signal.demographics.age'] = '55_and_older'
      const found = await q.insights(params).catch(() => [] as QlooEntity[])
      const fit = (e: QlooEntity) =>
        0.5 * (e.popularity ?? 0) + 0.5 * eraFit({ domain: 'music', era: year(e.properties?.start_year) } as Item, by)
      const pick = found.filter((e) => activeDuring(e, window)).sort((x, y) => fit(y) - fit(x))[0]
      return pick ? card(pick, m.label, TYPE.music) : undefined
    }),
  )
  return pair(cards, new Set()).slice(0, 3)
}

/** Round two: films of their youth, steered by the artists they just picked. */
export async function filmPairs(q: Qloo, birthYear: number, heritage: string[], seeds: string[]): Promise<[Card, Card][]> {
  const window = bumpWindow(birthYear)
  const home = heritage.find((h) => !/^(united states|usa|us|america)$/i.test(h))
  const cards = await Promise.all(
    FILM_PROBES.slice(0, 4).map(async (f) => {
      const params: Record<string, string | number | boolean | string[]> = {
        'filter.type': TYPE.film,
        'filter.tags': f.tag,
        'filter.release_year.min': window[0],
        'filter.release_year.max': window[1],
        'filter.exclude.tags': GENTLE,
        take: 10,
      }
      if (!seeds.length) params['signal.demographics.age'] = '55_and_older'
      const signals = seeds.map((id) => ({ id, weight: 10 }))
      let found: QlooEntity[] = []
      if (home) found = await q.insights({ ...params, 'filter.release_country': [home] }, signals).catch(() => [])
      if (found.length < 2) found = await q.insights(params, signals).catch(() => [])
      // With picks to go on, Qloo's own order (affinity) is the point; otherwise the most familiar title.
      const pick = seeds.length ? found[0] : found.sort((x, y) => (y.popularity ?? 0) - (x.popularity ?? 0))[0]
      return pick ? card(pick, f.label, TYPE.film) : undefined
    }),
  )
  return pair(cards, new Set()).slice(0, 2)
}
