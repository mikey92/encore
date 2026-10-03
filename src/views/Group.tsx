import { useState } from 'react'
import { useStore } from '../store'
import { Avatar, go } from '../ui'

export function Group() {
  const { people } = useStore()
  const [chosen, setChosen] = useState<string[]>([])
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 6 ? [...c, id] : c))
  return (
    <div>
      <span className="tag">Group session</span>
      <h1>Who’s at the table today?</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Encore finds the songs, films and stars this group has in common, makes sure everyone gets a moment that is theirs,
        and leaves out anything any one of them should avoid.
      </p>
      <div className="people" style={{ margin: '22px 0' }}>
        {people.map((p) => {
          const on = chosen.includes(p.id)
          return (
            <button
              key={p.id}
              className="card person"
              style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', borderColor: on ? 'var(--plum)' : undefined, borderWidth: on ? 3 : 1 }}
              onClick={() => toggle(p.id)}
              aria-pressed={on}
            >
              <div className="who">
                <Avatar name={p.name} />
                <div>
                  <h3 style={{ margin: 0 }}>
                    {on ? '✓ ' : ''}
                    {p.name}
                  </h3>
                  <div className="muted small">
                    Born {p.birthYear}
                    {p.hometown ? ` · ${p.hometown}` : ''}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="row">
        <button className="btn" disabled={chosen.length < 2} onClick={() => go(`/plan/${chosen.join('+')}`)}>
          {chosen.length < 2 ? 'Choose at least two people' : `Plan for ${chosen.length} people`}
        </button>
        <a className="btn quiet" href="#/">
          Cancel
        </a>
      </div>
    </div>
  )
}
