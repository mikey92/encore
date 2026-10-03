import type { Patch, Session, Slot, TasteRequest, TraceStep } from '../shared/types'

export interface SearchResult {
  id: string
  name: string
  type: string
  year?: number
  image?: string
  popularity?: number
}

export interface Card {
  id: string
  name: string
  type: string
  label: string
  when?: string
  image?: string
}

export type SessionEvent =
  | { type: 'step'; step: TraceStep }
  | { type: 'plan'; session: Session }
  | { type: 'curated'; session: Session }
  | { type: 'moment'; slot: Slot }
  | { type: 'note'; message: string }
  | { type: 'done'; stats: Record<string, unknown> }
  | { type: 'error'; message: string }

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export async function search(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return (await post<{ results: SearchResult[] }>('/api/search', { q }, signal)).results
}

export async function interview(body: { birthYear: number; heritage?: string[]; round: 'music' | 'film'; seeds?: string[] }) {
  return (await post<{ pairs: [Card, Card][] }>('/api/interview', body)).pairs
}

export async function adjust(taste: TasteRequest, request: string, moments: string[]) {
  return post<{ patch: Patch; steps: TraceStep[]; model: string }>('/api/adjust', { taste, request, moments })
}

/** Streams a session: Qloo steps as they happen, a first plan, then the curated version. */
const STALL_MS = 90_000

/** Streams a session's events; resolves when the stream ends, whether or not a 'done' event came. */
export async function streamSession(
  taste: TasteRequest | { members: TasteRequest[] },
  on: (e: SessionEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/session?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(taste),
    signal,
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  // A stream that goes quiet for this long has stalled; end it and keep what arrived.
  let idle: ReturnType<typeof setTimeout> | undefined
  const wake = () => {
    clearTimeout(idle)
    idle = setTimeout(() => void reader.cancel('stalled').catch(() => undefined), STALL_MS)
  }
  let buffer = ''
  for (;;) {
    wake()
    const { value, done } = await reader.read().finally(() => clearTimeout(idle))
    if (value) buffer += value
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) on(JSON.parse(line) as SessionEvent)
    }
    if (done) break
  }
}
