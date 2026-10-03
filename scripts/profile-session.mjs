// CPU profile of the local Worker (vite dev, inspector on 9230) while it plans one session.
// Usage: node scripts/profile-session.mjs <persona id or json file> [inspector port]
import { execFileSync } from 'node:child_process'
import WebSocket from 'ws'

const [persona = 'p14', port = '9230'] = process.argv.slice(2)
const ws = new WebSocket(`ws://127.0.0.1:${port}/encore`)
let id = 0
const pending = new Map()
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
ws.on('message', (raw) => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})
await new Promise((r) => ws.on('open', r))
await call('Profiler.enable')
await call('Profiler.setSamplingInterval', { interval: 100 })
await call('Profiler.start')
execFileSync('python3', ['scripts/stream-session.py', persona], { stdio: ['ignore', 'ignore', 'inherit'] })
const { profile } = await call('Profiler.stop')
ws.close()

const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
profile.samples.forEach((sid, i) => self.set(sid, (self.get(sid) ?? 0) + (profile.timeDeltas[i] ?? 0)))
const parent = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const label = (n) => {
  const f = n.callFrame
  const file = f.url.split('/').slice(-2).join('/')
  return `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}`
}
const selfBy = new Map()
const totalBy = new Map()
let all = 0
for (const [sid, us] of self) {
  const n = byId.get(sid)
  if (n.callFrame.functionName === '(idle)' || n.callFrame.functionName === '(program)') continue
  all += us
  selfBy.set(label(n), (selfBy.get(label(n)) ?? 0) + us)
  const seen = new Set()
  for (let cur = sid; cur !== undefined; cur = parent.get(cur)) {
    const l = label(byId.get(cur))
    if (seen.has(l)) continue
    seen.add(l)
    totalBy.set(l, (totalBy.get(l) ?? 0) + us)
  }
}
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k)
console.log(`busy ${(all / 1000).toFixed(1)} ms`)
console.log('\nself time')
for (const [l, us] of top(selfBy, 25)) console.log(`${(us / 1000).toFixed(1).padStart(7)} ms  ${l}`)
console.log('\ninclusive time (our code)')
for (const [l, us] of top(new Map([...totalBy].filter(([l]) => /worker\/|shared\//.test(l) || /index\.ts|engine|curate|scout|qloo|llm/.test(l))), 30))
  console.log(`${(us / 1000).toFixed(1).padStart(7)} ms  ${l}`)
