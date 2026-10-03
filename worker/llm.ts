// The model runs on the owner's ChatGPT plan, through the Codex Responses endpoint. The plan's sign-in stays on the
// owner's machine: the Worker sends each call to the relay there (relay/llm-relay.mjs, behind a Cloudflare tunnel),
// which makes the call and sends back the answer.

export interface LlmEnv {
  LLM_RELAY_URL?: string
  LLM_RELAY_KEY?: string
}

export const MODEL = 'gpt-5.5'

export type ResponseItem = Record<string, any>
export interface ResponseResult {
  output: ResponseItem[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function llmConnected(env: LlmEnv): boolean {
  return Boolean(env.LLM_RELAY_URL && env.LLM_RELAY_KEY)
}

/** One Responses call. The endpoint only streams; the relay reads the stream and sends back the finished answer
 *  (x-relay-collect), because reading it token by token here would cost far more CPU than the Worker may use. */
async function once(env: LlmEnv, body: string, signal: AbortSignal): Promise<ResponseResult> {
  const res = await fetch(`${env.LLM_RELAY_URL}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-relay-key': env.LLM_RELAY_KEY ?? '',
      'x-relay-collect': '1',
      // The zone's browser check rejects requests without a user agent.
      'user-agent': 'encore-worker/1.0',
    },
    body,
    signal,
  })
  if (!res.ok) throw new Error(`ChatGPT plan HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as ResponseResult
}

/** Most answers come back within 10 seconds without a reasoning pass (25 with one), but now and then one takes two or
 *  three times as long. When an answer is that late, the same call goes out again and whichever answer arrives first
 *  is used. */
function hedgeAfter(body: Record<string, unknown>): number {
  return (body.reasoning as { effort?: string } | undefined)?.effort === 'none' ? 10_000 : 25_000
}

export async function respond(env: LlmEnv, body: Record<string, unknown>, timeoutMs = 60_000): Promise<ResponseResult> {
  const payload = JSON.stringify({ ...body, store: false, stream: true })
  const deadline = AbortSignal.timeout(timeoutMs)
  const calls: AbortController[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<ResponseResult>((resolve, reject) => {
      let running = 0
      const start = () => {
        const c = new AbortController()
        calls.push(c)
        running++
        once(env, payload, AbortSignal.any([deadline, c.signal])).then(resolve, (e) => {
          // A failure counts only when no other call is still on its way.
          if (--running === 0) reject(e)
        })
      }
      start()
      timer = setTimeout(start, hedgeAfter(body))
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    for (const c of calls) c.abort()
  }
}

export function outputText(output: ResponseItem[]): string {
  return output
    .filter((item) => item.type === 'message')
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
}

/** Items go back as input on the next turn. With store off, the server keeps nothing, so their ids are dropped. */
export function replayable(output: ResponseItem[]): ResponseItem[] {
  return output.map(({ id: _id, ...item }) => item)
}

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface StructuredRequest {
  name: string
  instructions: string
  input: string
  schema: Record<string, unknown>
  effort?: string
}

/** Who answers a structured request: structured() itself, or the Worker's Planner running it in an invocation of
 *  its own (see index.ts). */
export type Ask = <T>(opts: StructuredRequest) => Promise<{ data: T; cached: boolean }>

/** A JSON answer under a strict schema, cached by its exact input so a repeated request costs nothing. */
export async function structured<T>(env: LlmEnv, opts: StructuredRequest): Promise<{ data: T; cached: boolean }> {
  const body = {
    model: MODEL,
    instructions: opts.instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: opts.input }] }],
    reasoning: { effort: opts.effort ?? 'low' },
    text: { format: { type: 'json_schema', name: opts.name, strict: true, schema: opts.schema } },
  }
  const key = new Request(`https://llm-cache.encore.internal/${await digest(JSON.stringify(body))}`)
  const cache = typeof caches !== 'undefined' ? (caches as any).default : undefined
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined
  if (hit) return { data: (await hit.json()) as T, cached: true }
  const result = await respond(env, body)
  const data = JSON.parse(outputText(result.output)) as T
  if (cache) {
    await cache
      .put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'max-age=2592000', 'Content-Type': 'application/json' } }))
      .catch(() => undefined)
  }
  return { data, cached: false }
}
