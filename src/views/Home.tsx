import { useStore, type Person } from '../store'
import { Avatar, when } from '../ui'

function PersonCard({ p, last }: { p: Person; last?: number }) {
  return (
    <a className="card person" href={`#/p/${p.id}`}>
      <div className="who">
        <Avatar name={p.name} />
        <div>
          <h3 style={{ margin: 0 }}>{p.name}</h3>
          <div className="muted small">
            Born {p.birthYear}
            {p.hometown ? ` · grew up in ${p.hometown}` : ''}
          </div>
        </div>
      </div>
      <div className="chips">
        {p.favorites.slice(0, 3).map((f) => (
          <span key={f.id} className="chip plum">
            {f.name}
          </span>
        ))}
        {p.heritage ? <span className="chip gold">{p.heritage}</span> : null}
      </div>
      <div className="spread small faint">
        <span>{last ? `Last session ${when(last)}` : 'No sessions yet'}</span>
        {p.example ? <span className="chip">Example</span> : null}
      </div>
    </a>
  )
}

export function Home() {
  const { people, sessions } = useStore()
  const lastFor = (id: string) => sessions.find((s) => s.personIds.includes(id))?.createdAt
  return (
    <>
      <section className="hero">
        <div>
          <span className="tag">For memory care staff and families</span>
          <h1>Twenty minutes back in the years they remember best.</h1>
          <p>
            Encore plans a reminiscence session for someone living with dementia: the songs, films, TV, stars and hometown
            places of their own youth, found through Qloo’s taste graph and checked by a careful curator before you sit down
            together.
          </p>
          <div className="row">
            <a className="btn" href="#/new">
              Add someone
            </a>
            <a className="btn ghost" href={`#/p/${people[0]?.id ?? ''}`}>
              Try an example
            </a>
          </div>
        </div>
        <div className="how">
          <b>How a session works</b>
          <ol>
            <li>Tell Encore when and where they grew up, and a favourite or two. Not sure? Play This or That with them.</li>
            <li>Encore finds era-right music, films, TV, stars and places they are likely to love, and says why.</li>
            <li>Read the prompts aloud, play the clips, and tap how each moment landed.</li>
            <li>Next time, Encore builds on what lit them up and leaves out what didn’t.</li>
          </ol>
        </div>
      </section>
      <h2>Who are we spending time with?</h2>
      <div className="people">
        {people.map((p) => (
          <PersonCard key={p.id} p={p} last={lastFor(p.id)} />
        ))}
        <a className="card add" href="#/new">
          + Add someone
        </a>
      </div>
    </>
  )
}
