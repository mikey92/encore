// Bakes a ready-made session for each example person into src/examples.json, so a first visit shows a full
// session at once, anywhere, even before Qloo or the writing assistant have warmed up in that region.
// Usage: node scripts/examples.mjs [base-url]   (base defaults to the local dev server)
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5180'
const src = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8')
const presets = readFileSync(new URL('../shared/presets.ts', import.meta.url), 'utf8')
// The examples and avoid presets live in TypeScript; pull the literal blocks out rather than duplicating them.
const examples = Function(`return ${src.match(/const EXAMPLES: Person\[\] = (\[[\s\S]*?\n\])/)[1]}`)()
const avoid = Function(`return ${presets.match(/export const AVOID_PRESETS[^=]*= (\{[\s\S]*?\n\})/)[1]}`)()

const out = {}
for (const p of examples) {
  const taste = {
    birthYear: p.birthYear,
    hometown: p.hometown,
    heritage: p.heritage ? [p.heritage] : [],
    language: p.language,
    favorites: p.favorites,
    liked: [],
    avoidTags: p.avoid.flatMap((k) => avoid[k]?.tags ?? []),
    avoidEntities: [],
    used: [],
    notes: p.notes,
    interestTags: [],
  }
  const res = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(taste) })
  const data = await res.json()
  if (data.session?.narration !== 'ai') throw new Error(`${p.name}: session was not curated (${JSON.stringify(data.notes)})`)
  out[p.id] = data.session
  console.log(p.name, data.session.slots.map((s) => s.item.name).join(' · '))
}
writeFileSync(new URL('../src/examples.json', import.meta.url), JSON.stringify(out))
console.log('wrote src/examples.json')
