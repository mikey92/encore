// Group sessions: several people at one table. Their favourites become one weighted signal (each person
// counts equally however many favourites they have), the window spans everyone's youth, anything one
// person must avoid is avoided for all, and Qloo's explainability shows whose taste each moment serves.

import type { Item, Seed, Session, TasteRequest, TraceStep } from '../shared/types'
import { currentYear, planSession, type Ctx, type SlotDef } from './engine'
import type { Qloo } from './qloo'

const GROUP_SLOTS: SlotDef[] = [
  { key: 'opener', title: 'A song everyone knows', minutes: 4, domain: 'music' },
  { key: 'film', title: 'At the movies', minutes: 6, domain: 'film' },
  { key: 'star', title: 'Stars of the day', minutes: 4, domain: 'star' },
  { key: 'tv', title: 'TV night', minutes: 5, domain: 'tv' },
  { key: 'singalong', title: 'Sing-along', minutes: 4, domain: 'music' },
  { key: 'closer', title: 'One more song', minutes: 3, domain: 'music' },
]

/** Traits worth saying out loud; regions and vague adjectives are not. */
const SAYABLE = /genre|theme|instrument|characteristic:music|subgenre/
const VAGUE = /^(diverse|engaging|eclectic|unique|popular|mainstream)$/i

const unique = <T,>(xs: T[]) => [...new Set(xs)]

function seedsOf(m: TasteRequest): Seed[] {
  return [...(m.favorites ?? []), ...(m.liked ?? [])]
}

/** Which people an item is for, from Qloo's explainability: the owners of the favourites behind it. */
export function whoFor(it: Item, owners: Map<string, number[]>): number[] {
  return unique(it.because.filter((b) => b.share >= 0.15).flatMap((b) => owners.get(b.id) ?? [])).sort()
}

export async function planGroup(
  q: Qloo,
  members: TasteRequest[],
  onStep?: (step: TraceStep) => void,
): Promise<{ session: Session; ctx: Ctx; combined: TasteRequest; owners: Map<string, number[]> }> {
  const owners = new Map<string, number[]>()
  const favorites: Seed[] = []
  members.forEach((m, i) => {
    const seeds = seedsOf(m)
    const share = seeds.length ? Math.max(3, Math.round(30 / seeds.length)) : 0
    for (const s of seeds) {
      owners.set(s.id, unique([...(owners.get(s.id) ?? []), i]))
      const had = favorites.find((f) => f.id === s.id)
      if (had) had.weight = (had.weight ?? 0) + share
      else favorites.push({ ...s, weight: share })
    }
  })
  const years = members.map((m) => m.birthYear).sort((a, b) => a - b)
  const window: [number, number] = [years[0] + 10, Math.min(years[years.length - 1] + 30, currentYear())]
  const combined: TasteRequest = {
    birthYear: years[Math.floor(years.length / 2)],
    favorites,
    heritage: unique(members.flatMap((m) => m.heritage ?? [])).slice(0, 2),
    avoidTags: unique(members.flatMap((m) => m.avoidTags ?? [])),
    avoidEntities: unique(members.flatMap((m) => m.avoidEntities ?? [])),
    used: unique(members.flatMap((m) => m.used ?? [])),
    interestTags: unique(members.flatMap((m) => m.interestTags ?? [])).slice(0, 8),
  }
  const { session, ctx } = await planSession(q, combined, onStep, { slots: GROUP_SLOTS, window, anchor: false })

  // Make sure everyone has a moment: swap in an alternate that serves anyone left out.
  for (let person = 0; person < members.length; person++) {
    if (session.slots.some((s) => whoFor(s.item, owners).includes(person))) continue
    for (const slot of [...session.slots].reverse()) {
      const alt = slot.alternates.find((a) => whoFor(a, owners).includes(person))
      const current = whoFor(slot.item, owners)
      // Only take a moment from someone who is served elsewhere too.
      const safe = current.every((c) => session.slots.filter((s) => s !== slot && whoFor(s.item, owners).includes(c)).length > 0)
      if (alt && safe) {
        slot.alternates = [slot.item, ...slot.alternates.filter((a) => a.id !== alt.id)]
        slot.item = alt
        break
      }
    }
  }
  const servedBy: Record<string, number[]> = {}
  for (const slot of session.slots) servedBy[slot.key] = whoFor(slot.item, owners)

  // What the group shares: compare each of the first three people with everyone else.
  const t = Date.now()
  const ids = members.map((m) => seedsOf(m).map((s) => s.id))
  const lists = await Promise.all(
    ids.slice(0, 3).map((mine, i) => {
      const others = unique(ids.filter((_, j) => j !== i).flat()).filter((id) => !mine.includes(id))
      return mine.length && others.length ? q.compare(mine, others).catch(() => []) : Promise.resolve([])
    }),
  )
  const score = new Map<string, { id: string; name: string; total: number; hits: number }>()
  for (const list of lists)
    for (const tag of list) {
      if (!SAYABLE.test(tag.type ?? tag.id) || VAGUE.test(tag.name)) continue
      const k = tag.name.toLowerCase()
      const cur = score.get(k) ?? { id: tag.id, name: tag.name, total: 0, hits: 0 }
      cur.total += tag.score
      cur.hits++
      score.set(k, cur)
    }
  const commonGround = [...score.values()]
    .sort((a, b) => b.hits - a.hits || b.total - a.total)
    .slice(0, 6)
    .map(({ id, name }) => ({ id, name }))
  const step: TraceStep = { tool: 'qloo.compare', detail: 'What this group’s tastes have in common', count: commonGround.length, ms: Date.now() - t }
  session.trace.push(step)
  onStep?.(step)

  return { session: { ...session, servedBy, commonGround }, ctx, combined, owners }
}
