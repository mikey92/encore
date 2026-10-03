// The curator: the model reviews the candidates Qloo found for each moment, picks the safest and most
// fitting one, and writes what the caregiver will say. It can only choose among Qloo's candidates.
// Each moment is reviewed in its own call and the calls run side by side, so a whole session takes
// about as long as its slowest moment.

import type { Item, Session, Slot, TasteRequest } from '../shared/types'
import { AVOID_PRESETS } from '../shared/presets'
import { MODEL, structured, type LlmEnv } from './llm'

const INSTRUCTIONS = `You are Encore's session curator. Encore helps activity staff and families in memory care run a short reminiscence session for one person living with dementia. You get the person's details and one moment of the session, with candidates that Qloo's taste graph found for them. Every candidate is real. Choose only among the moment's candidates, by id.

Pick one candidate and up to two alternates. Judge in this order:
1. Safety. Skip anything likely to upset someone living with dementia: stories centred on murder, abuse, war, terminal illness or the death of a child; horror; explicit content; divisive political figures; places tied to tragedy. A gentle family favourite is fine even if it is a detective show.
2. Their time. It should have been popular while they were about 10 to 30 (the years are given). For places pick ones that existed then (landmarks, historic sites, long-standing institutions), not recent attractions. For stars pick entertainers they would have known then (actors, singers, comedians, sports heroes), not writers, academics, politicians or journalists.
3. Their culture and language. If they grew up elsewhere, things from home usually mean the most.
4. Recognisability. Something familiar beats something obscure.
List the candidates you rejected for safety or era, each with a short reason.
If no candidate really suits this person (wrong culture, wrong years, too obscure), set pick to "none" and the moment is left out: a shorter session beats a poor fit.

For the pick write:
- why: one sentence for staff on why it suits this person, naming the favourite it connects to.
- prompts: three short, warm, open conversation starters a caregiver reads aloud to the person ("you"). Invite stories and feelings. Never test memory: no "Do you remember", no quiz questions, no yes/no questions. Keep them about this pick; bring in a favourite only if it is part of it. Use a fact only if you are sure of it (title, year, star, a famous song or scene).
- sensory: one practical idea for the senses (what to play, an object to hold, a soft food or a smell). Nothing hot, sharp or hard to chew.
- prompts_native: if a home language other than English is given, the same three prompts in that language; otherwise an empty list.
If the moment is the session's first, also write opening: one sentence to begin the session warmly. If it is the last, write closing: one sentence to end on a good note. Otherwise leave them empty.
Plain, respectful language. Their gender is not given, so never say he or she. No medical claims.`

const GROUP = `

This is a group session. The people are called Person A, Person B and so on; never invent names. The moment says whom it is meant for: prefer a candidate that connects to them and that others at the table may know too. Prompts speak to the whole group ("Who here…", "Tell us about…") and invite each person to share. In why, say which people it connects to (e.g. "Person A and Person C both love…").`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pick', 'alternates', 'why', 'prompts', 'prompts_native', 'sensory', 'rejected', 'opening', 'closing'],
  properties: {
    pick: { type: 'string' },
    alternates: { type: 'array', items: { type: 'string' } },
    why: { type: 'string' },
    prompts: { type: 'array', items: { type: 'string' } },
    prompts_native: { type: 'array', items: { type: 'string' } },
    sensory: { type: 'string' },
    rejected: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    opening: { type: 'string' },
    closing: { type: 'string' },
  },
}

interface Moment {
  pick: string
  alternates: string[]
  why: string
  prompts: string[]
  prompts_native: string[]
  sensory: string
  rejected: { id: string; reason: string }[]
  opening: string
  closing: string
}

/** When more moments are judged unfit than a session can lose, these go first. */
const DROP_ORDER = ['place', 'star', 'tv', 'film', 'singalong']
const MIN_MOMENTS = 4
const MAX_DROPS = 2

function describe(it: Item) {
  return {
    id: it.id,
    name: it.name,
    when: it.when,
    known_for: it.feature,
    about: it.description?.slice(0, 140),
    tags: it.tags.slice(0, 3).map((t) => t.name),
  }
}

function avoidLabels(req: TasteRequest): string[] {
  const set = new Set(req.avoidTags ?? [])
  return Object.values(AVOID_PRESETS)
    .filter((p) => p.tags.some((t) => set.has(t)))
    .map((p) => p.label)
}

const label = (i: number) => `Person ${String.fromCharCode(65 + i)}`

type Skip = { id: string; name: string; reason: string }

/** The candidates the curator turned down in one moment, with its reasons. */
function rejections(slot: Slot, m: Moment | undefined): Skip[] {
  const pool = new Map([slot.item, ...slot.alternates].map((it) => [it.id, it]))
  return (m?.rejected ?? []).flatMap((r) => {
    const it = pool.get(r.id)
    return it ? [{ id: it.id, name: it.name, reason: r.reason }] : []
  })
}

/** One moment as the curator left it. Its pick is trusted only if it is one of the moment's candidates and
 *  not used elsewhere; otherwise the first candidate it did not turn down stands, with standard prompts. */
function settle(slot: Slot, m: Moment | undefined, used: Set<string>): Slot | undefined {
  const pool = [slot.item, ...slot.alternates]
  const byId = new Map(pool.map((it) => [it.id, it]))
  const rejected = new Set((m?.rejected ?? []).map((r) => r.id))
  let pick = m && byId.get(m.pick) && !used.has(m.pick) ? byId.get(m.pick)! : undefined
  if (!pick) pick = pool.find((it) => !used.has(it.id) && !rejected.has(it.id))
  if (!pick) return undefined
  used.add(pick.id)
  const alternates = [
    ...(m?.alternates ?? []).map((id) => byId.get(id)).filter((it): it is Item => !!it),
    ...pool.filter((it) => !rejected.has(it.id)),
  ].filter((it, j, arr) => it.id !== pick!.id && !used.has(it.id) && arr.findIndex((x) => x.id === it.id) === j)
  const item: Item = { ...pick }
  if (m && m.pick === pick.id) {
    item.why = m.why
    if (m.prompts.length) item.prompts = m.prompts.slice(0, 3)
    if (m.prompts_native.length) item.promptsNative = m.prompts_native.slice(0, 3)
    if (m.sensory) item.sensory = m.sensory
  }
  return { ...slot, item, alternates: alternates.slice(0, 3) }
}

/** Reviews every moment at once. onMoment hears about each one as soon as it is done; the session that comes
 *  back is final (moments judged unfit are left out only then, once the whole session is known). */
export async function curate(
  env: LlmEnv,
  session: Session,
  req: TasteRequest,
  members?: TasteRequest[],
  onMoment?: (slot: Slot) => void,
): Promise<{ session: Session; cached: boolean; reviewed: number }> {
  const group = members && members.length > 1
  const who = group
    ? {
        people: members.map((m, i) => ({
          label: label(i),
          born: m.birthYear,
          hometown: m.hometown ?? null,
          heritage: m.heritage ?? [],
          favourites: [...(m.favorites ?? []), ...(m.liked ?? [])].map((s) => s.name),
          avoid: avoidLabels(m),
          notes: m.notes?.slice(0, 300) ?? null,
        })),
      }
    : {
        person: {
          born: req.birthYear,
          youth_years: session.window,
          hometown: req.hometown ?? null,
          heritage: req.heritage ?? [],
          home_language: req.language && !/^english$/i.test(req.language) ? req.language : null,
          favourites: [...(req.favorites ?? []), ...(req.liked ?? [])].map((s) => s.name),
          avoid: avoidLabels(req),
          notes: req.notes?.slice(0, 500) ?? null,
        },
      }
  const last = session.slots.length - 1
  // What each moment shows right now, so an early answer does not take another moment's pick.
  const showing = new Map(session.slots.map((s) => [s.key, s.item.id]))
  const settled = await Promise.allSettled(
    session.slots.map(async (slot, i) => {
      const answer = await structured<Moment>(env, {
        name: 'moment',
        instructions: group ? INSTRUCTIONS + GROUP : INSTRUCTIONS,
        input: JSON.stringify({
          ...who,
          moment: {
            title: slot.title,
            first: i === 0,
            last: i === last,
            for: group ? (session.servedBy?.[slot.key] ?? []).map(label) : undefined,
            candidates: [slot.item, ...slot.alternates].slice(0, 5).map(describe),
          },
        }),
        schema: SCHEMA,
      })
      if (onMoment && answer.data.pick !== 'none') {
        const others = new Set([...showing].filter(([k]) => k !== slot.key).map(([, id]) => id))
        const now = settle(slot, answer.data, others)
        if (now) {
          showing.set(slot.key, now.item.id)
          onMoment(now)
        }
      }
      return answer
    }),
  )
  const answers = settled.map((r) => (r.status === 'fulfilled' ? r.value : undefined))
  if (!answers.some(Boolean)) throw (settled[0] as PromiseRejectedResult).reason
  for (const r of settled) if (r.status === 'rejected') console.error('curate moment failed', String(r.reason))

  // Leave out the moments judged unfit, as long as the session keeps enough of them.
  const room = Math.max(0, Math.min(MAX_DROPS, session.slots.length - MIN_MOMENTS))
  const rank = (key: string) => (DROP_ORDER.includes(key) ? DROP_ORDER.indexOf(key) : DROP_ORDER.length)
  const drops = new Set(
    session.slots
      .filter((_, i) => answers[i]?.data.pick === 'none')
      .map((s) => s.key)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, room),
  )

  const used = new Set<string>()
  const skipped: Skip[] = []
  const slots: Slot[] = []
  session.slots.forEach((slot, i) => {
    const m = answers[i]?.data
    for (const r of rejections(slot, m)) if (!skipped.some((x) => x.id === r.id)) skipped.push(r)
    if (drops.has(slot.key)) return
    const done = settle(slot, m, used)
    if (done) slots.push(done)
  })
  return {
    session: {
      ...session,
      slots,
      opening: answers[0]?.data.opening || session.opening,
      closing: answers[last]?.data.closing || session.closing,
      skipped,
      narration: 'ai',
      model: MODEL,
    },
    cached: answers.every((a) => a?.cached),
    reviewed: answers.filter(Boolean).length,
  }
}
