// Everything about a person stays in this browser. Only taste signals go to the server.

import { useSyncExternalStore } from 'react'
import { AVOID_PRESETS } from '../shared/presets'
import type { Seed, Session, TasteRequest } from '../shared/types'

export type Reaction = 'lit' | 'calm' | 'none' | 'unsettled'

export interface Person {
  id: string
  name: string
  birthYear: number
  hometown?: string
  heritage?: string
  language?: string
  favorites: Seed[]
  avoid: string[] // keys of AVOID_PRESETS
  /** Set through Ask Encore: tags that steer suggestions, and extra tags and items to leave out */
  interestTags?: { id: string; name: string }[]
  avoidTags?: { id: string; name: string }[]
  avoidItems?: Seed[]
  notes?: string
  createdAt: number
  example?: boolean
}

export interface SavedSession {
  id: string
  personIds: string[]
  createdAt: number
  session: Session
  reactions: Record<string, Reaction>
  finishedAt?: number
}

interface State {
  people: Person[]
  sessions: SavedSession[]
}

const KEY = 'encore.v1'
const listeners = new Set<() => void>()

const EXAMPLES: Person[] = [
  {
    id: 'ex-dorothy',
    name: 'Dorothy',
    birthYear: 1941,
    hometown: 'Memphis',
    language: 'English',
    favorites: [
      { id: '95593E4D-2CBE-44E5-BF82-F1E542B63A96', name: 'Elvis Presley', type: 'urn:entity:artist' },
      { id: '5D54CE58-DC3E-4294-A359-581A9C072952', name: 'The Sound of Music', type: 'urn:entity:movie', year: 1965 },
    ],
    avoid: ['war'],
    notes: 'Taught second grade for thirty years. Loved Sunday drives and anything with a piano.',
    createdAt: 0,
    example: true,
  },
  {
    id: 'ex-rosa',
    name: 'Rosa',
    birthYear: 1938,
    hometown: 'San Antonio',
    heritage: 'Mexico',
    language: 'Spanish',
    favorites: [{ id: 'BEC81FD4-2934-41D7-9602-80D229CF3434', name: 'Pedro Infante', type: 'urn:entity:artist' }],
    avoid: ['war'],
    notes: 'Sang in the church choir. Ran a small bakery with her husband.',
    createdAt: 0,
    example: true,
  },
  {
    id: 'ex-walter',
    name: 'Walter',
    birthYear: 1934,
    hometown: 'Brooklyn',
    heritage: 'Italy',
    language: 'English',
    favorites: [
      { id: 'FC0F8D26-BA80-4D83-8BBF-FC011DC8D241', name: 'Frank Sinatra', type: 'urn:entity:artist' },
      { id: '65E28499-5D62-4D74-A0B8-0C60DD6C2358', name: 'I Love Lucy', type: 'urn:entity:tv_show', year: 1951 },
    ],
    avoid: ['war', 'violence'],
    notes: 'Served in Korea and does not talk about it. Loves baseball and his mother’s Sunday sauce.',
    createdAt: 0,
    example: true,
  },
]

function read(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // Private mode or blocked storage: start fresh in memory.
  }
  return { people: EXAMPLES, sessions: [] }
}

let state: State = read()

function write(next: State) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage can be full or blocked; the app keeps working for this visit.
  }
  listeners.forEach((l) => l())
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export function savePerson(p: Person) {
  const people = state.people.some((x) => x.id === p.id) ? state.people.map((x) => (x.id === p.id ? p : x)) : [...state.people, p]
  write({ ...state, people })
}

export function removePerson(id: string) {
  write({ people: state.people.filter((p) => p.id !== id), sessions: state.sessions.filter((s) => !s.personIds.includes(id)) })
}

export function saveSession(s: SavedSession) {
  const sessions = state.sessions.some((x) => x.id === s.id) ? state.sessions.map((x) => (x.id === s.id ? s : x)) : [s, ...state.sessions]
  write({ ...state, sessions })
}

export function getPerson(id: string): Person | undefined {
  return state.people.find((p) => p.id === id)
}

export function getSession(id: string): SavedSession | undefined {
  return state.sessions.find((s) => s.id === id)
}

export function sessionsFor(personId: string): SavedSession[] {
  return state.sessions.filter((s) => s.personIds.includes(personId))
}

/** What Encore learned from earlier sessions: items that lit them up, and items to leave out. */
export function learned(personId: string) {
  const liked: Seed[] = []
  const avoid: Seed[] = []
  const used = new Set<string>()
  for (const s of sessionsFor(personId)) {
    for (const slot of s.session.slots) {
      used.add(slot.item.id)
      const r = s.reactions[slot.key]
      const seed = { id: slot.item.id, name: slot.item.name, type: slot.item.type }
      if (r === 'lit') liked.push(seed)
      if (r === 'unsettled') avoid.push(seed)
    }
  }
  return { liked, avoid, used: [...used] }
}

/** The request for the server: no name, no ids of ours, just taste. */
export function tasteFor(p: Person): TasteRequest {
  const { liked, avoid, used } = learned(p.id)
  return {
    birthYear: p.birthYear,
    hometown: p.hometown || undefined,
    heritage: p.heritage ? [p.heritage] : [],
    language: p.language || undefined,
    favorites: p.favorites,
    liked,
    avoidTags: [...p.avoid.flatMap((k) => AVOID_PRESETS[k]?.tags ?? []), ...(p.avoidTags ?? []).map((t) => t.id)],
    avoidEntities: [...avoid, ...(p.avoidItems ?? [])].map((s) => s.id),
    interestTags: (p.interestTags ?? []).map((t) => t.id),
    used,
    notes: p.notes || undefined,
  }
}

export function resetExamples() {
  const mine = state.people.filter((p) => !p.example)
  write({ people: [...EXAMPLES, ...mine], sessions: state.sessions.filter((s) => s.personIds.some((id) => mine.some((m) => m.id === id))) })
}
