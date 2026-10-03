// Thin Qloo client: cached, and paced under the 5 requests/second limit.
// GET for everything except weighted insights, which need a JSON body.

const BASE = 'https://hackathon.api.qloo.com'
const TTL_SECONDS = 60 * 60 * 24 * 14
const SPACING_MS = 230

export interface QlooEntity {
  entity_id: string
  name: string
  type?: string
  subtype?: string
  popularity?: number
  properties?: Record<string, any>
  tags?: { id: string; name: string; type: string }[]
  query?: { affinity?: number; explainability?: Record<string, { entity_id: string; score: number }[]> }
  location?: { lat: number; lon: number }
}

export type Params = Record<string, string | number | boolean | string[] | undefined>

export interface WeightedSignal {
  id: string
  weight: number
}

const memory = new Map<string, any>()
let nextSlot = 0

/** Monthly quota left, as last reported by Qloo. */
export const quota = { monthRemaining: -1, monthLimit: -1 }

async function pace() {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + SPACING_MS
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

export function encode(params: Params): string {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '' && !(Array.isArray(params[k]) && !(params[k] as unknown[]).length))
    .sort()
  return keys
    .map((k) => {
      const v = params[k]
      const s = Array.isArray(v) ? v.join(',') : String(v)
      return `${encodeURIComponent(k)}=${encodeURIComponent(s).replace(/%2C/g, ',')}`
    })
    .join('&')
}

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class Qloo {
  calls = 0
  cached = 0
  constructor(private key: string) {}

  private async cachedFetch(cacheId: string, doFetch: () => Promise<Response>, label: string): Promise<any> {
    if (memory.has(cacheId)) {
      this.cached++
      return memory.get(cacheId)
    }
    const cacheKey = new Request(`https://qloo-cache.encore.internal/${await digest(cacheId)}`)
    const cache = typeof caches !== 'undefined' ? (caches as any).default : undefined
    const hit = cache ? await cache.match(cacheKey).catch(() => undefined) : undefined
    if (hit) {
      const data = await hit.json()
      memory.set(cacheId, data)
      this.cached++
      return data
    }
    let res: Response | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      await pace()
      res = await doFetch()
      if (res.status !== 429) break
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
    this.calls++
    const left = Number(res?.headers.get('X-Month-RateLimit-Remaining'))
    if (Number.isFinite(left) && left >= 0) {
      quota.monthRemaining = left
      quota.monthLimit = Number(res?.headers.get('X-Month-RateLimit-Limit')) || quota.monthLimit
    }
    if (!res || !res.ok) {
      const body = res ? await res.text() : 'no response'
      throw new QlooError(res?.status ?? 0, body.slice(0, 300), label)
    }
    const data = await res.json()
    if (memory.size > 500) memory.delete(memory.keys().next().value!)
    memory.set(cacheId, data)
    if (cache) {
      const stored = new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${TTL_SECONDS}` },
      })
      await cache.put(cacheKey, stored).catch(() => undefined)
    }
    return data
  }

  get(path: string, params: Params): Promise<any> {
    const url = `${BASE}${path}?${encode(params)}`
    return this.cachedFetch(
      'GET ' + url,
      () => fetch(url, { headers: { 'X-Api-Key': this.key, Accept: 'application/json' } }),
      path,
    )
  }

  post(path: string, body: Record<string, unknown>): Promise<any> {
    const ordered = Object.fromEntries(Object.entries(body).sort(([a], [b]) => (a < b ? -1 : 1)))
    const full = JSON.stringify(ordered)
    return this.cachedFetch(
      'POST ' + path + ' ' + full,
      () =>
        fetch(BASE + path, {
          method: 'POST',
          headers: { 'X-Api-Key': this.key, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: full,
        }),
      path,
    )
  }

  async search(query: string, types?: string[], take = 6): Promise<QlooEntity[]> {
    const data = await this.get('/search', { query, types, take })
    return (data.results ?? []).map(normalize)
  }

  /** Insights with weighted entity signals (POST) or plain parameters (GET). */
  async insights(params: Params, signals?: WeightedSignal[]): Promise<QlooEntity[]> {
    let data: any
    if (signals && signals.length) {
      const body: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue
        body[k] = Array.isArray(v) ? v.join(',') : v
      }
      body['signal.interests.entities'] = signals.map((s) => ({ id: s.id, weight: s.weight }))
      data = await this.post('/v2/insights', body)
    } else {
      data = await this.get('/v2/insights', params)
    }
    return (data.results?.entities ?? []).map(normalize)
  }

  async tags(query: string, take = 8): Promise<{ id: string; name: string; type?: string }[]> {
    const data = await this.get('/v2/tags', { 'filter.query': query, take })
    return (data.results?.tags ?? []).map((t: any) => ({ id: t.tag_id ?? t.id, name: t.name, type: t.subtype ?? t.type }))
  }

  /** Tags two groups of entities have in common, with how strongly they share them. */
  async compare(a: string[], b: string[], take = 20): Promise<{ id: string; name: string; type?: string; score: number }[]> {
    const data = await this.get('/v2/analysis/compare', {
      'a.signal.interests.entities': a,
      'b.signal.interests.entities': b,
      take,
    })
    return (data.results?.tags ?? []).map((t: any) => ({
      id: t.tag_id ?? t.id,
      name: t.name,
      type: t.subtype ?? t.type,
      score: Number(t.query?.score ?? 0),
    }))
  }
}

export class QlooError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`Qloo ${path} ${status}: ${body}`)
  }
}

function normalize(e: any): QlooEntity {
  return { ...e, entity_id: e.entity_id ?? e.id }
}
