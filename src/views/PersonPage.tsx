import { AVOID_PRESETS } from '../../shared/presets'
import { getPerson, learned, removePerson, useStore } from '../store'
import { Avatar, go, when } from '../ui'

export function PersonPage({ id }: { id: string }) {
  const { sessions } = useStore()
  const p = getPerson(id)
  if (!p)
    return (
      <div className="card">
        <h2>Not on this device</h2>
        <p className="muted">People and sessions live in the browser where they were added.</p>
        <a className="btn" href="#/">
          Back to people
        </a>
      </div>
    )
  const { liked, avoid } = learned(p.id)
  const mine = sessions.filter((s) => s.personIds.includes(p.id))
  const facts = [
    `Born ${p.birthYear}`,
    p.hometown && `grew up in ${p.hometown}`,
    p.heritage && `roots in ${p.heritage}`,
    p.language && !/^english$/i.test(p.language) && `speaks ${p.language}`,
  ].filter(Boolean)

  return (
    <>
      <div className="session-head">
        <Avatar big name={p.name} />
        <div>
          <span className="tag">{p.example ? 'Example person' : 'Person'}</span>
          <h1 style={{ margin: 0 }}>{p.name}</h1>
          <div className="muted">{facts.join(' · ')}</div>
        </div>
      </div>
      <div className="row">
        <a className="btn" href={`#/plan/${p.id}`}>
          Plan today’s session
        </a>
        <a className="btn ghost" href={`#/p/${p.id}/game`}>
          Play This or That
        </a>
        <a className="btn quiet" href={`#/p/${p.id}/edit`}>
          Edit
        </a>
      </div>
      <div className="two" style={{ marginTop: 24 }}>
        <div className="card">
          <h3>Loves</h3>
          <div className="chips">
            {p.favorites.length ? (
              p.favorites.map((f) => (
                <span key={f.id} className="chip plum">
                  {f.name}
                </span>
              ))
            ) : (
              <span className="muted">Nothing yet. This or That is a gentle way to find out.</span>
            )}
          </div>
          {liked.length ? (
            <>
              <h3 style={{ marginTop: 18 }}>Lit up in sessions</h3>
              <div className="chips">
                {liked.map((f) => (
                  <span key={f.id} className="chip green">
                    {f.name}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="card">
          <h3>Leave out</h3>
          <div className="chips">
            {p.avoid.map((k) => (
              <span key={k} className="chip red">
                {AVOID_PRESETS[k]?.label ?? k}
              </span>
            ))}
            {avoid.map((s) => (
              <span key={s.id} className="chip red">
                {s.name}
              </span>
            ))}
            {!p.avoid.length && !avoid.length ? <span className="muted">Nothing set</span> : null}
          </div>
          {p.notes ? (
            <>
              <h3 style={{ marginTop: 18 }}>Notes</h3>
              <p className="muted" style={{ margin: 0 }}>
                {p.notes}
              </p>
            </>
          ) : null}
        </div>
      </div>
      <h2 style={{ marginTop: 34 }}>Sessions</h2>
      {mine.length ? (
        <div className="history">
          {mine.map((s) => {
            const lit = Object.values(s.reactions).filter((r) => r === 'lit').length
            return (
              <a key={s.id} href={`#/s/${s.id}`}>
                <span>
                  <b>{when(s.createdAt)}</b>
                  <span className="muted"> · {s.session.slots.map((x) => x.item.name).slice(0, 3).join(', ')}…</span>
                </span>
                <span className="muted small">{s.finishedAt ? `${lit} lit up` : 'Not finished'}</span>
              </a>
            )
          })}
        </div>
      ) : (
        <p className="muted">No sessions yet.</p>
      )}
      {!p.example ? (
        <p style={{ marginTop: 40 }}>
          <button
            className="btn quiet small"
            onClick={() => {
              if (confirm(`Remove ${p.name} and their sessions from this device?`)) {
                removePerson(p.id)
                go('/')
              }
            }}
          >
            Remove from this device
          </button>
        </p>
      ) : null}
    </>
  )
}
