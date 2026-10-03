import { useEffect, useState } from 'react'
import type { Seed } from '../../shared/types'
import { interview, type Card } from '../api'
import { getPerson, savePerson } from '../store'
import { go, Img } from '../ui'

type Phase = 'loading' | 'music' | 'film' | 'done' | 'error'

export function Game({ id }: { id: string }) {
  const person = getPerson(id)
  const [phase, setPhase] = useState<Phase>('loading')
  const [pairs, setPairs] = useState<[Card, Card][]>([])
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<Card[]>([])
  const [total, setTotal] = useState(5)
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!person) return
    interview({ birthYear: person.birthYear, heritage: person.heritage ? [person.heritage] : [], round: 'music' })
      .then((p) => {
        setPairs(p)
        setTotal(p.length + 2)
        setPhase(p.length ? 'music' : 'error')
      })
      .catch(() => setPhase('error'))
  }, [id])

  if (!person) return <p>That person isn’t on this device.</p>

  const answered = phase === 'done' ? total : count

  const next = async (chosen: Card[]) => {
    const all = [...picked, ...chosen]
    setPicked(all)
    setCount((c) => c + 1)
    if (i + 1 < pairs.length) return setI(i + 1)
    if (phase === 'music') {
      setPhase('loading')
      const seeds = all.filter((c) => c.type === 'urn:entity:artist').map((c) => c.id)
      try {
        const films = await interview({
          birthYear: person.birthYear,
          heritage: person.heritage ? [person.heritage] : [],
          round: 'film',
          seeds,
        })
        if (films.length) {
          setTotal(pairs.length + films.length)
          setPairs(films)
          setI(0)
          return setPhase('film')
        }
      } catch {
        // Fall through: the music answers alone are still worth keeping.
      }
    }
    setPhase('done')
  }

  const keep = () => {
    const seeds: Seed[] = picked.map((c) => ({ id: c.id, name: c.name, type: c.type, image: c.image }))
    const favorites = [...person.favorites, ...seeds.filter((s) => !person.favorites.some((f) => f.id === s.id))]
    savePerson({ ...person, favorites })
    go(`/p/${person.id}`)
  }

  return (
    <div>
      <span className="tag">This or That with {person.name}</span>
      <h1>Which one feels more like {person.name}?</h1>
      <p className="muted">
        Sit together and ask: “Which of these do you like better?” Let them point. It’s fine to pick both or neither.
      </p>
      <div className="dots" aria-label={`${answered} of ${total} answered`}>
        {Array.from({ length: total }, (_, k) => (
          <i key={k} className={k < answered ? 'done' : ''} />
        ))}
      </div>
      {phase === 'loading' ? (
        <div className="row" style={{ justifyContent: 'center', margin: '60px 0' }}>
          <div className="spinner" /> <span className="muted">Finding favourites from {person.birthYear + 10}–{person.birthYear + 30}…</span>
        </div>
      ) : null}
      {phase === 'error' ? <div className="notice err">Encore couldn’t load choices just now. Try again in a moment.</div> : null}
      {(phase === 'music' || phase === 'film') && pairs[i] ? (
        <>
          <div className="duel">
            {[pairs[i][0], null, pairs[i][1]].map((c, k) =>
              c ? (
                <button key={c.id} className="pick" onClick={() => next([c])}>
                  <Img src={c.image} alt="" fallback={phase === 'music' ? '🎵' : '🎬'} />
                  <span className="tag">{c.label}</span>
                  <b>{c.name}</b>
                  <span className="muted small">{c.when}</span>
                </button>
              ) : (
                <div key={k} className="or">
                  or
                </div>
              ),
            )}
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn quiet" onClick={() => next(pairs[i])}>
              Both
            </button>
            <button className="btn quiet" onClick={() => next([])}>
              Neither
            </button>
          </div>
        </>
      ) : null}
      {phase === 'done' ? (
        <div className="card" style={{ marginTop: 24 }}>
          <h2>{picked.length ? `${person.name} chose:` : 'No favourites this time'}</h2>
          <div className="chips" style={{ margin: '12px 0 20px' }}>
            {picked.map((c) => (
              <span key={c.id} className="chip plum">
                {c.name}
              </span>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={keep}>
              {picked.length ? 'Keep these and plan a session' : 'Back'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
