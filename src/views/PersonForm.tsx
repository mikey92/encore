import { useEffect, useRef, useState } from 'react'
import { AVOID_PRESETS } from '../../shared/presets'
import type { Seed } from '../../shared/types'
import { search, type SearchResult } from '../api'
import { getPerson, savePerson, uid, type Person } from '../store'
import { go, Img, typeLabel } from '../ui'

function FavoriteSearch({ value, onChange }: { value: Seed[]; onChange: (v: Seed[]) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      ctrl.current?.abort()
      ctrl.current = new AbortController()
      setBusy(true)
      try {
        setResults(await search(text, ctrl.current.signal))
      } catch {
        // A newer search replaced this one, or the network blinked; keep what we had.
      } finally {
        setBusy(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q])
  const add = (r: SearchResult) => {
    if (!value.some((v) => v.id === r.id)) onChange([...value, { id: r.id, name: r.name, type: r.type, image: r.image, year: r.year }])
    setQ('')
    setResults([])
  }
  return (
    <div>
      <div className="chips" style={{ marginBottom: value.length ? 10 : 0 }}>
        {value.map((v) => (
          <span key={v.id} className="chip plum">
            {v.name}
            {v.year ? ` (${v.year})` : ''}
            <button type="button" aria-label={`Remove ${v.name}`} onClick={() => onChange(value.filter((x) => x.id !== v.id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="search"
        placeholder="A singer, film, TV show or star: try “Patsy Cline” or “Gunsmoke”"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search for a favourite"
      />
      {busy ? <div className="hint">Searching Qloo…</div> : null}
      {results.length ? (
        <div className="results">
          {results.map((r) => (
            <button key={r.id} type="button" className="result" onClick={() => add(r)}>
              <Img src={r.image} alt="" fallback="♪" className="thumb" />
              <span>
                <b>{r.name}</b>
                <span className="muted small">
                  {' '}
                  · {typeLabel(r.type)}
                  {r.year ? ` · ${r.year}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PersonForm({ id }: { id?: string }) {
  const existing = id ? getPerson(id) : undefined
  const [p, setP] = useState<Person>(
    existing ?? { id: uid(), name: '', birthYear: 1945, favorites: [], avoid: ['war'], createdAt: Date.now() },
  )
  const [error, setError] = useState('')
  const set = <K extends keyof Person>(k: K, v: Person[K]) => setP((x) => ({ ...x, [k]: v }))
  const toggle = (key: string) => set('avoid', p.avoid.includes(key) ? p.avoid.filter((k) => k !== key) : [...p.avoid, key])

  const save = (next: 'page' | 'game') => {
    if (!p.name.trim()) return setError('Add a first name or nickname.')
    if (!(p.birthYear >= 1915 && p.birthYear <= 1975)) return setError('Encore works for people born between 1915 and 1975.')
    savePerson({ ...p, name: p.name.trim(), example: false })
    go(next === 'game' ? `/p/${p.id}/game` : `/p/${p.id}`)
  }

  return (
    <div className="form">
      <div>
        <span className="tag">{existing ? 'Edit' : 'New person'}</span>
        <h1>{existing ? `About ${existing.name}` : 'Who are we planning for?'}</h1>
        <p className="muted">Their name and notes stay on this device. Encore sends only the year, places and tastes to plan with.</p>
      </div>
      <div className="two">
        <label className="field">
          First name or nickname
          <input type="text" value={p.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          Year of birth
          <input
            type="number"
            inputMode="numeric"
            min={1915}
            max={1975}
            value={p.birthYear || ''}
            onChange={(e) => set('birthYear', Number(e.target.value))}
          />
        </label>
      </div>
      <div className="two">
        <label className="field">
          Where they grew up
          <small>A town or city, e.g. “Memphis” or “Guadalajara”</small>
          <input type="text" value={p.hometown ?? ''} onChange={(e) => set('hometown', e.target.value)} />
        </label>
        <label className="field">
          Family roots, if not the U.S.
          <small>A country, e.g. “Mexico” or “Philippines”</small>
          <input type="text" value={p.heritage ?? ''} onChange={(e) => set('heritage', e.target.value)} />
        </label>
      </div>
      <label className="field">
        The language they are most at home in
        <small>Prompts come in this language too</small>
        <input type="text" value={p.language ?? ''} placeholder="English" onChange={(e) => set('language', e.target.value)} />
      </label>
      <div className="field">
        <b>Things they loved</b>
        <span className="hint">One or two is plenty. Encore finds the rest.</span>
        <FavoriteSearch value={p.favorites} onChange={(v) => set('favorites', v)} />
      </div>
      <div className="field">
        <b>Leave out</b>
        <span className="hint">Encore skips these themes everywhere</span>
        <div className="toggles">
          {Object.entries(AVOID_PRESETS).map(([key, preset]) => (
            <button key={key} type="button" className={`toggle${p.avoid.includes(key) ? ' on' : ''}`} onClick={() => toggle(key)}>
              {p.avoid.includes(key) ? '✕ ' : ''}
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Anything else that helps
        <small>Work, faith, family, things to steer around. This goes to the writing assistant, so leave out names.</small>
        <textarea value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
      {error ? <div className="notice err">{error}</div> : null}
      <div className="row">
        <button type="button" className="btn" onClick={() => save('page')}>
          Save
        </button>
        <button type="button" className="btn ghost" onClick={() => save('game')}>
          Save and play This or That
        </button>
        <a className="btn quiet" href={existing ? `#/p/${existing.id}` : '#/'}>
          Cancel
        </a>
      </div>
    </div>
  )
}
