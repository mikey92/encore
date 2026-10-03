import { useState } from 'react'
import type { Patch, TraceStep } from '../../shared/types'
import { adjust } from '../api'
import { savePerson, tasteFor, type Person } from '../store'
import { go } from '../ui'

const EXAMPLES = ['It’s December: make it festive', 'She was a nurse for forty years', 'He was a big Brooklyn Dodgers fan', 'Leave out anything about the sea']

/** Merge Ask Encore's change into the person, without duplicates. */
function applyPatch(p: Person, patch: Patch): Person {
  const add = <T extends { id: string }>(xs: T[] = [], more: T[]) => [...xs, ...more.filter((m) => !xs.some((x) => x.id === m.id))]
  return {
    ...p,
    favorites: add(p.favorites, patch.addFavorites),
    interestTags: add(p.interestTags, patch.interestTags),
    avoidTags: add(p.avoidTags, patch.avoidTags),
    avoidItems: add(p.avoidItems, patch.avoidEntities),
    notes: patch.note ? [p.notes, patch.note].filter(Boolean).join('\n') : p.notes,
  }
}

export function AskEncore({ person, moments }: { person: Person; moments: string[] }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ patch: Patch; steps: TraceStep[] } | null>(null)

  const ask = async (request: string) => {
    if (!request.trim()) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await adjust(tasteFor(person), request, moments))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changes = result
    ? [
        ...result.patch.addFavorites.map((x) => ({ k: 'plum', t: `+ ${x.name}` })),
        ...result.patch.interestTags.map((x) => ({ k: 'gold', t: `More: ${x.name}` })),
        ...result.patch.avoidTags.map((x) => ({ k: 'red', t: `Leave out: ${x.name}` })),
        ...result.patch.avoidEntities.map((x) => ({ k: 'red', t: `Leave out: ${x.name}` })),
      ]
    : []

  return (
    <div className="card noprint" style={{ marginTop: 24 }}>
      <h3>Ask Encore to change something</h3>
      <p className="muted small">Say it the way you would to a colleague. Encore looks it up in Qloo and plans again.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. She loved Christmas" style={{ flex: 1, minWidth: 240 }} />
        <button className="btn" disabled={busy || !text.trim()}>
          {busy ? 'Looking…' : 'Ask'}
        </button>
      </form>
      <div className="chips" style={{ marginTop: 10 }}>
        {EXAMPLES.map((x) => (
          <button
            key={x}
            type="button"
            className="chip"
            style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 15 }}
            onClick={() => {
              setText(x)
              ask(x)
            }}
          >
            {x}
          </button>
        ))}
      </div>
      {busy ? (
        <div className="row" style={{ marginTop: 14 }}>
          <div className="spinner" /> <span className="muted">Searching Qloo for what you asked…</span>
        </div>
      ) : null}
      {error ? <div className="notice err">{error}</div> : null}
      {result ? (
        <div style={{ marginTop: 16 }}>
          <div className="trace-list" style={{ marginBottom: 12 }}>
            {result.steps
              .filter((s) => s.tool !== 'agent')
              .map((s, k) => (
                <div key={k} className="step">
                  <b>{s.tool}</b>
                  <span>
                    {s.detail} → {s.count}
                  </span>
                </div>
              ))}
          </div>
          <div className="why">{result.patch.reply}</div>
          <div className="chips" style={{ marginBottom: 14 }}>
            {changes.map((c, k) => (
              <span key={k} className={`chip ${c.k}`}>
                {c.t}
              </span>
            ))}
          </div>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                savePerson(applyPatch(person, result.patch))
                go(`/plan/${person.id}`)
              }}
            >
              Plan again with this
            </button>
            <button className="btn quiet" onClick={() => setResult(null)}>
              Never mind
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
