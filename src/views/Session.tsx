import { useEffect, useRef, useState } from 'react'
import type { Session, Slot, TraceStep } from '../../shared/types'
import { streamSession } from '../api'
import { getPerson, getSession, saveSession, tasteFor, uid, useStore, type Person, type Reaction, type SavedSession } from '../store'
import { Avatar, DOMAIN_ICON, go, Img, when } from '../ui'
import { AskEncore } from './Ask'

const REACTIONS: { key: Reaction; icon: string; label: string }[] = [
  { key: 'lit', icon: '😊', label: 'Lit up' },
  { key: 'calm', icon: '🙂', label: 'Calm' },
  { key: 'none', icon: '😐', label: 'No response' },
  { key: 'unsettled', icon: '😟', label: 'Unsettled' },
]

/** The curator calls group members "Person A", "Person B"…; names only exist here, on the device. */
function named(text: string | undefined, people: Person[]): string {
  if (!text || people.length < 2) return text ?? ''
  return text.replace(/Person ([A-H])\b/g, (m, l: string) => people[l.charCodeAt(0) - 65]?.name ?? m)
}

function listNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function linkLabel(slot: Slot): string {
  switch (slot.item.domain) {
    case 'music':
      return 'Play the song'
    case 'film':
      return 'Watch the trailer'
    case 'tv':
      return 'Play the theme'
    case 'place':
      return 'See it on a map'
    default:
      return 'Look them up'
  }
}

function Moment({
  slot,
  index,
  reaction,
  onReact,
  onSwap,
  people,
  servedBy,
}: {
  slot: Slot
  index: number
  reaction?: Reaction
  onReact: (r: Reaction) => void
  onSwap?: () => void
  people: Person[]
  servedBy?: number[]
}) {
  const it = slot.item
  const person = people[0]
  const group = people.length > 1
  const forWhom = (servedBy ?? []).map((i) => people[i]?.name).filter(Boolean) as string[]
  const native = it.promptsNative?.length ? it.promptsNative : undefined
  return (
    <article className="card moment">
      <div className="art">
        <Img src={it.image} alt="" fallback={DOMAIN_ICON[it.domain]} />
        <span className="num">{index + 1}</span>
      </div>
      <div>
        <span className="tag">
          {slot.title} · {slot.minutes} min
        </span>
        <h3>{it.name}</h3>
        <div className="meta">
          {[it.when, it.feature && (it.domain === 'music' ? `“${it.feature}”` : it.feature)].filter(Boolean).join(' · ')}
        </div>
        {group && forWhom.length ? (
          <div className="chips" style={{ marginBottom: 10 }}>
            {forWhom.map((n) => (
              <span key={n} className="chip green">
                For {n}
              </span>
            ))}
          </div>
        ) : null}
        {it.because.length ? (
          <div className="because">
            Because {group ? 'the group loves' : `${person.name} loves`}{' '}
            {it.because.map((b, k) => (
              <span key={b.id}>
                {k ? ', ' : ''}
                <span className="bar" style={{ width: Math.max(8, Math.round(b.share * 60)) }} />
                {b.name}
              </span>
            ))}
            <span className="faint"> · Qloo affinity{it.affinity ? ` ${Math.round(it.affinity * 100)}%` : ''}</span>
          </div>
        ) : null}
        {it.why ? <div className="why">{named(it.why, people)}</div> : null}
        <ul className="prompts">
          {it.prompts.map((q, k) => (
            <li key={k}>
              {named(native ? native[k] : q, people)}
              {native ? <span className="native">{named(q, people)}</span> : null}
            </li>
          ))}
        </ul>
        {it.sensory ? <div className="sense">✋ {named(it.sensory, people)}</div> : null}
        <div className="row noprint" style={{ marginBottom: 12 }}>
          {it.link ? (
            <a className="btn small" href={it.link} target="_blank" rel="noreferrer">
              {linkLabel(slot)} ↗
            </a>
          ) : null}
          {onSwap ? (
            <button className="btn quiet small" onClick={onSwap}>
              Try another
            </button>
          ) : null}
        </div>
        <div className="reactions" role="group" aria-label="How did it land?">
          {REACTIONS.map((r) => (
            <button key={r.key} className={`react ${r.key}${reaction === r.key ? ' on' : ''}`} onClick={() => onReact(r.key)} aria-pressed={reaction === r.key}>
              <span>{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  )
}

function Steps({ steps }: { steps: TraceStep[] }) {
  return (
    <div className="trace-list">
      {steps.map((s, k) => (
        <div key={k} className="step">
          <b>{s.tool}</b>
          <span>
            {s.detail}
            {s.count !== undefined ? ` → ${s.count}` : ''}
            {s.ms ? <span className="faint"> · {(s.ms / 1000).toFixed(1)}s</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}

function Body({ saved, people, curating, note }: { saved: SavedSession; people: Person[]; curating?: boolean; note?: string }) {
  const s = saved.session
  const minutes = s.slots.reduce((n, x) => n + x.minutes, 0)
  const person = people[0]
  const group = people.length > 1
  const update = (patch: Partial<SavedSession>) => saveSession({ ...saved, ...patch })
  const react = (key: string, r: Reaction) => {
    const reactions = { ...saved.reactions }
    if (reactions[key] === r) delete reactions[key]
    else reactions[key] = r
    update({ reactions })
  }
  const swap = (index: number) => {
    const slots = s.slots.map((slot, k) => (k === index && slot.alternates.length ? { ...slot, item: slot.alternates[0], alternates: [...slot.alternates.slice(1), slot.item] } : slot))
    const reactions = { ...saved.reactions }
    delete reactions[s.slots[index].key]
    update({ session: { ...s, slots }, reactions })
  }
  const lit = s.slots.filter((x) => saved.reactions[x.key] === 'lit')
  const off = s.slots.filter((x) => saved.reactions[x.key] === 'unsettled')
  return (
    <>
      <div className="session-head">
        {group ? (
          <div className="row" style={{ gap: 4 }}>
            {people.map((p) => (
              <Avatar key={p.id} name={p.name} />
            ))}
          </div>
        ) : (
          <Avatar big name={person.name} />
        )}
        <div>
          <span className="tag">{group ? `Group session · ${when(saved.createdAt)}` : when(saved.createdAt)}</span>
          <h1 style={{ margin: 0 }}>Today with {listNames(people.map((p) => p.name))}</h1>
          <div className="muted">
            About {minutes} minutes · from the years {s.window[0]}–{s.window[1]}
          </div>
        </div>
      </div>
      {group && s.commonGround?.length ? (
        <div className="why">
          <b>What this group shares, according to Qloo: </b>
          {s.commonGround.map((c) => c.name.toLowerCase()).join(', ')}
        </div>
      ) : null}
      {curating ? (
        <div className="notice row">
          <div className="spinner" /> Encore’s curator is checking each moment for safety, era and culture, and writing prompts for{' '}
          {person.name}. You can start reading now.
        </div>
      ) : null}
      {note ? <div className="notice warn">{note}</div> : null}
      {s.opening ? (
        <div className="say">
          <small>Begin with</small>
          {named(s.opening, people)}
        </div>
      ) : null}
      <div className="moments">
        {s.slots.map((slot, k) => (
          <Moment
            key={slot.key + slot.item.id}
            slot={slot}
            index={k}
            people={people}
            servedBy={s.servedBy?.[slot.key]}
            reaction={saved.reactions[slot.key]}
            onReact={(r) => react(slot.key, r)}
            onSwap={slot.alternates.length ? () => swap(k) : undefined}
          />
        ))}
      </div>
      {s.closing ? (
        <div className="say">
          <small>End with</small>
          {named(s.closing, people)}
        </div>
      ) : null}
      <div className="card noprint" style={{ marginTop: 24 }}>
        {saved.finishedAt ? (
          <>
            <h2>Saved. Here’s what Encore will remember.</h2>
            <p className="muted">
              {lit.length ? `Next time it builds on ${lit.map((x) => x.item.name).join(', ')}.` : 'Nothing lit up strongly this time; next time Encore tries new directions.'}{' '}
              {off.length ? `It will leave out ${off.map((x) => x.item.name).join(', ')}.` : ''}
            </p>
            <div className="row">
              <a className="btn" href={`#/plan/${people.map((p) => p.id).join('+')}`}>
                Plan the next session
              </a>
              <a className="btn ghost" href={group ? '#/' : `#/p/${person.id}`}>
                {group ? 'Back to people' : `Back to ${person.name}`}
              </a>
            </div>
          </>
        ) : (
          <div className="spread">
            <span className="muted">Tap how each moment landed, then save. Encore learns from it.</span>
            <div className="row">
              <button className="btn quiet" onClick={() => window.print()}>
                Print
              </button>
              <button className="btn" onClick={() => update({ finishedAt: Date.now() })} disabled={curating}>
                Finish and save
              </button>
            </div>
          </div>
        )}
      </div>
      {!saved.finishedAt && !curating && !group ? <AskEncore person={person} moments={s.slots.map((x) => x.item.name)} /> : null}
      <details className="trace">
        <summary>How Encore built this session</summary>
        <p className="muted small" style={{ marginTop: 10 }}>
          Every moment comes from Qloo’s taste graph. {s.narration === 'ai' ? `The curator (${s.model}) chose among Qloo’s candidates and wrote the prompts.` : 'Standard prompts were used.'}
        </p>
        <Steps steps={s.trace} />
        {s.skipped?.length ? (
          <>
            <h3 style={{ marginTop: 18 }}>Left out by the curator</h3>
            <div className="trace-list">
              {s.skipped.map((x) => (
                <div key={x.id} className="step">
                  <b>skip</b>
                  <span>
                    {x.name}: {x.reason}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </details>
    </>
  )
}

export function Plan({ ids }: { ids: string[] }) {
  const people = ids.map((id) => getPerson(id)).filter((p): p is Person => !!p)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [curating, setCurating] = useState(true)
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  const sid = useRef(uid())
  const { sessions } = useStore()
  const saved = sessions.find((s) => s.id === sid.current)

  useEffect(() => {
    if (!people.length) return
    const ctrl = new AbortController()
    const createdAt = Date.now()
    const keep = (session: Session) => {
      // Keep any reactions tapped while the curator was still working.
      const prev = getSession(sid.current)
      saveSession({ id: sid.current, personIds: people.map((p) => p.id), createdAt, session, reactions: prev?.reactions ?? {} })
    }
    streamSession(
      people.length > 1 ? { members: people.map(tasteFor) } : tasteFor(people[0]),
      (e) => {
        if (e.type === 'step') setSteps((s) => [...s, e.step])
        if (e.type === 'plan') keep(e.session)
        if (e.type === 'curated') keep(e.session)
        if (e.type === 'note') setNote(e.message)
        if (e.type === 'error') setError(e.message)
        if (e.type === 'done') {
          setCurating(false)
          go(`/s/${sid.current}`, true)
        }
      },
      ctrl.signal,
    ).catch((err) => {
      // An aborted stream belongs to a view that is gone (or React's development double run); leave state alone.
      if (ctrl.signal.aborted) return
      setError(String(err.message ?? err))
      setCurating(false)
    })
    return () => ctrl.abort()
  }, [ids.join('+')])

  if (!people.length) return <p>That person isn’t on this device.</p>
  if (error && !saved) return <div className="notice err">Encore couldn’t plan a session: {error}</div>
  if (!saved)
    return (
      <div>
        <span className="tag">Planning</span>
        <h1>{people.length > 1 ? `Finding what ${listNames(people.map((p) => p.name))} share…` : `Finding ${people[0].name}’s years…`}</h1>
        <p className="muted">
          Encore is asking Qloo’s taste graph for the music, films, TV, stars and places of {people[0].birthYear + 10}–
          {Math.min(people[0].birthYear + 30, new Date().getFullYear())}.
        </p>
        <div className="row" style={{ margin: '18px 0' }}>
          <div className="spinner" />
          <span className="muted">Working…</span>
        </div>
        <Steps steps={steps} />
      </div>
    )
  return <Body saved={saved} people={people} curating={curating} note={note} />
}

export function SessionView({ id }: { id: string }) {
  const { sessions } = useStore()
  const saved = sessions.find((s) => s.id === id)
  if (!saved) return <p>This session isn’t on this device.</p>
  const people = saved.personIds.map((pid) => getPerson(pid)).filter((p): p is Person => !!p)
  if (!people.length) return <p>The person for this session was removed.</p>
  return <Body saved={saved} people={people} />
}
