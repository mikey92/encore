// The curator: the model reviews the candidates Qloo found for each moment, picks the safest and most
// fitting one, and writes what the caregiver will say. It can only choose among Qloo's candidates.

import type { Item, Session, Slot, TasteRequest } from '../shared/types'
import { AVOID_PRESETS } from '../shared/presets'
import { MODEL, structured, type LlmEnv } from './llm'

const INSTRUCTIONS = `You are Encore's session curator. Encore helps activity staff and families in memory care run a short reminiscence session for one person living with dementia. You get the person's details and, for each moment of the session, candidates that Qloo's taste graph found for them. Every candidate is real. Choose only among a moment's candidates, by id.

For each moment pick one candidate and up to two alternates (never reuse an id across moments). Judge in this order:
1. Safety. Skip anything likely to upset someone living with dementia: stories centred on murder, abuse, war, terminal illness or the death of a child; horror; explicit content; divisive political figures; places tied to tragedy. A gentle family favourite is fine even if it is a detective show.
2. Their time. It should have been popular while they were about 10 to 30 (the years are given). For places pick ones that existed then (landmarks, historic sites, long-standing institutions), not recent attractions. For stars pick entertainers they would have known then (actors, singers, comedians, sports heroes), not writers, academics, politicians or journalists.
3. Their culture and language. If they grew up elsewhere, things from home usually mean the most.
4. Recognisability. Something familiar beats something obscure.
List the candidates you rejected for safety or era, each with a short reason.

For each pick write:
- why: one sentence for staff on why it suits this person, naming the favourite it connects to.
- prompts: three short, warm, open conversation starters a caregiver reads aloud to the person ("you"). Invite stories and feelings. Never test memory: no "Do you remember", no quiz questions, no yes/no questions. Use a fact only if you are sure of it (title, year, star, a famous song or scene).
- sensory: one practical idea for the senses (what to play, an object to hold, a soft food or a smell). Nothing hot, sharp or hard to chew.
- prompts_native: if a home language other than English is given, the same three prompts in that language; otherwise an empty list.
Also write opening (one sentence to begin warmly) and closing (one sentence to end on a good note).
Plain, respectful language. No medical claims.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['opening', 'closing', 'moments'],
  properties: {
    opening: { type: 'string' },
    closing: { type: 'string' },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'pick', 'alternates', 'why', 'prompts', 'prompts_native', 'sensory', 'rejected'],
        properties: {
          key: { type: 'string' },
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
        },
      },
    },
  },
}

interface Curated {
  opening: string
  closing: string
  moments: {
    key: string
    pick: string
    alternates: string[]
    why: string
    prompts: string[]
    prompts_native: string[]
    sensory: string
    rejected: { id: string; reason: string }[]
  }[]
}

function describe(it: Item) {
  return {
    id: it.id,
    name: it.name,
    when: it.when,
    known_for: it.feature,
    about: it.description?.slice(0, 220),
    tags: it.tags.slice(0, 5).map((t) => t.name),
  }
}

function avoidLabels(req: TasteRequest): string[] {
  const set = new Set(req.avoidTags ?? [])
  return Object.values(AVOID_PRESETS)
    .filter((p) => p.tags.some((t) => set.has(t)))
    .map((p) => p.label)
}

export async function curate(env: LlmEnv, session: Session, req: TasteRequest): Promise<{ session: Session; cached: boolean }> {
  const input = {
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
    moments: session.slots.map((s) => ({ key: s.key, title: s.title, candidates: [s.item, ...s.alternates].map(describe) })),
  }
  const { data, cached } = await structured<Curated>(env, {
    name: 'session',
    instructions: INSTRUCTIONS,
    input: JSON.stringify(input),
    schema: SCHEMA,
  })

  const used = new Set<string>()
  const skipped: { id: string; name: string; reason: string }[] = []
  const slots: Slot[] = []
  for (const slot of session.slots) {
    const pool = [slot.item, ...slot.alternates]
    const byId = new Map(pool.map((it) => [it.id, it]))
    const m = data.moments.find((x) => x.key === slot.key)
    for (const r of m?.rejected ?? []) {
      const it = byId.get(r.id)
      if (it) skipped.push({ id: it.id, name: it.name, reason: r.reason })
    }
    const rejected = new Set((m?.rejected ?? []).map((r) => r.id))
    // Trust the pick only if it is one of this moment's candidates and not used elsewhere.
    let pick = m && byId.get(m.pick) && !used.has(m.pick) ? byId.get(m.pick)! : undefined
    if (!pick) pick = pool.find((it) => !used.has(it.id) && !rejected.has(it.id))
    if (!pick) continue
    used.add(pick.id)
    const alternates = [
      ...(m?.alternates ?? []).map((id) => byId.get(id)).filter((it): it is Item => !!it),
      ...pool.filter((it) => !rejected.has(it.id)),
    ].filter((it, i, arr) => it.id !== pick!.id && !used.has(it.id) && arr.findIndex((x) => x.id === it.id) === i)
    const item: Item = { ...pick }
    if (m && m.pick === pick.id) {
      item.why = m.why
      if (m.prompts.length) item.prompts = m.prompts.slice(0, 3)
      if (m.prompts_native.length) item.promptsNative = m.prompts_native.slice(0, 3)
      if (m.sensory) item.sensory = m.sensory
    }
    slots.push({ ...slot, item, alternates: alternates.slice(0, 3) })
  }
  return {
    session: { ...session, slots, opening: data.opening, closing: data.closing, skipped, narration: 'ai', model: `${MODEL} (ChatGPT plan)` },
    cached,
  }
}
