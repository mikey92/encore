// "Ask Encore": a caregiver says what to change in plain words ("more Christmas", "she was a nurse",
// "nothing about the sea"). The agent looks things up in Qloo with tools and returns a small change to the
// person's taste profile; the session is then planned again from it.

import type { Patch, Seed, TasteRequest, TraceStep } from '../shared/types'
import { TYPE } from './engine'
import { MODEL, outputText, replayable, respond, type LlmEnv, type ResponseItem } from './llm'
import type { Qloo } from './qloo'

const KINDS: Record<string, string> = { music: TYPE.music, film: TYPE.film, tv: TYPE.tv, star: TYPE.star }

const INSTRUCTIONS = `You are Encore's assistant. Encore plans reminiscence sessions for a person living with dementia from Qloo's taste graph. A caregiver asks you to change something. Turn the request into a small change to the person's taste profile:
- add_favorites: Qloo entities they love (find them with search_entities)
- interest_tags: Qloo tags that should steer suggestions, e.g. a holiday, a hobby, a genre (find them with search_tags)
- avoid_tags / avoid_entities: themes or items to leave out
- note: a short fact worth remembering about their life, if the request gave one (no names)
Use only ids that the tools returned. Prefer one or two precise changes over many. Search before you decide; then call apply_changes exactly once. In reply, tell the caregiver in one or two plain sentences what you changed.`

const TOOLS = [
  {
    type: 'function',
    name: 'search_entities',
    description: 'Find Qloo entities (singers, films, TV shows, people) by name.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'kind'],
      properties: {
        query: { type: 'string' },
        kind: { type: 'string', enum: ['music', 'film', 'tv', 'star', 'any'] },
      },
    },
  },
  {
    type: 'function',
    name: 'search_tags',
    description: 'Find Qloo tags (genres, themes, holidays, hobbies, occupations) by keyword.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
  },
  {
    type: 'function',
    name: 'apply_changes',
    description: 'Finish: the change to the taste profile and a short reply to the caregiver.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['add_favorites', 'interest_tags', 'avoid_tags', 'avoid_entities', 'note', 'reply'],
      properties: {
        add_favorites: { type: 'array', items: { type: 'string' }, description: 'entity ids' },
        interest_tags: { type: 'array', items: { type: 'string' }, description: 'tag ids' },
        avoid_tags: { type: 'array', items: { type: 'string' }, description: 'tag ids' },
        avoid_entities: { type: 'array', items: { type: 'string' }, description: 'entity ids' },
        note: { type: 'string' },
        reply: { type: 'string' },
      },
    },
  },
]

const MAX_TURNS = 5

function parse(s: unknown): Record<string, any> {
  if (typeof s !== 'string') return (s as Record<string, any>) ?? {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

export async function adjust(
  env: LlmEnv,
  q: Qloo,
  taste: TasteRequest,
  request: string,
  context: { moments: string[] },
): Promise<{ patch: Patch; steps: TraceStep[]; model: string }> {
  const steps: TraceStep[] = []
  const entities = new Map<string, Seed>()
  const tags = new Map<string, { id: string; name: string }>()

  const use = async (name: string, args: Record<string, any>): Promise<string> => {
    const t = Date.now()
    if (name === 'search_entities') {
      const kind = KINDS[args.kind] ? [KINDS[args.kind]] : Object.values(KINDS)
      const found = await q.search(String(args.query ?? '').slice(0, 80), kind, 6).catch(() => [])
      const rows = found.map((e) => {
        const year = Number(String(e.properties?.release_year ?? e.properties?.start_year ?? e.properties?.date_of_birth ?? '').slice(0, 4)) || undefined
        const seed: Seed = { id: e.entity_id, name: e.name, type: e.type ?? e.subtype ?? '', year }
        entities.set(seed.id, seed)
        return { id: seed.id, name: seed.name, type: seed.type.replace('urn:entity:', ''), year }
      })
      steps.push({ tool: 'qloo.search', detail: `“${args.query}”`, count: rows.length, ms: Date.now() - t })
      return JSON.stringify(rows)
    }
    if (name === 'search_tags') {
      const found = await q.tags(String(args.query ?? '').slice(0, 60), 10).catch(() => [])
      const rows = found.filter((x) => x.id).map((x) => {
        tags.set(x.id, { id: x.id, name: x.name })
        return { id: x.id, name: x.name, type: x.type }
      })
      steps.push({ tool: 'qloo.tags', detail: `“${args.query}”`, count: rows.length, ms: Date.now() - t })
      return JSON.stringify(rows)
    }
    return 'unknown tool'
  }

  const input: ResponseItem[] = [
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: JSON.stringify({
            person: {
              born: taste.birthYear,
              hometown: taste.hometown ?? null,
              heritage: taste.heritage ?? [],
              favourites: (taste.favorites ?? []).map((f) => f.name),
              notes: taste.notes ?? null,
            },
            current_session: context.moments,
            request,
          }),
        },
      ],
    },
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await respond(env, {
      model: MODEL,
      instructions: INSTRUCTIONS,
      input,
      tools: TOOLS,
      tool_choice: turn === MAX_TURNS - 1 ? { type: 'function', name: 'apply_changes' } : 'auto',
      parallel_tool_calls: true,
      reasoning: { effort: 'low' },
      include: ['reasoning.encrypted_content'],
    })
    input.push(...replayable(result.output))
    const calls = result.output.filter((item) => item.type === 'function_call')
    const done = calls.find((c) => c.name === 'apply_changes')
    if (done) {
      const a = parse(done.arguments)
      const ids = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : [])
      const patch: Patch = {
        addFavorites: ids(a.add_favorites).map((id) => entities.get(id)).filter((x): x is Seed => !!x),
        interestTags: ids(a.interest_tags).map((id) => tags.get(id)).filter((x): x is { id: string; name: string } => !!x),
        avoidTags: ids(a.avoid_tags).map((id) => tags.get(id)).filter((x): x is { id: string; name: string } => !!x),
        avoidEntities: ids(a.avoid_entities).map((id) => entities.get(id)).filter((x): x is Seed => !!x),
        note: String(a.note ?? '').slice(0, 300),
        reply: String(a.reply ?? '').slice(0, 400),
      }
      steps.push({ tool: 'agent', detail: patch.reply })
      return { patch, steps, model: MODEL }
    }
    if (!calls.length) {
      // The model answered in prose instead of finishing; ask once more for the change itself.
      input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Call apply_changes now. ${outputText(result.output).slice(0, 200)}` }] })
      continue
    }
    for (const call of calls) {
      input.push({ type: 'function_call_output', call_id: call.call_id, output: await use(call.name, parse(call.arguments)) })
    }
  }
  throw new Error('The assistant did not settle on a change')
}
