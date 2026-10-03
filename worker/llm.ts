// The model on the owner's ChatGPT plan. chatgpt.com refuses calls from Cloudflare Workers, so the Worker sends
// each Responses call to the relay on the owner's machine (relay/llm-relay.mjs, behind a Cloudflare tunnel),
// which holds the plan's tokens and forwards the call to the Codex Responses endpoint.

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

/** One Responses call. The endpoint only streams, and its response.completed event leaves the output out,
 *  so the items are collected from response.output_item.done events. */
export async function respond(env: LlmEnv, body: Record<string, unknown>, timeoutMs = 60_000): Promise<ResponseResult> {
  const res = await fetch(`${env.LLM_RELAY_URL}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-relay-key': env.LLM_RELAY_KEY ?? '',
      // The zone's browser check rejects requests without a user agent.
      'user-agent': 'encore-worker/1.0',
    },
    body: JSON.stringify({ ...body, store: false, stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok || !res.body) throw new Error(`ChatGPT plan HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return readCompleted(res.body)
}

export async function readCompleted(body: ReadableStream<Uint8Array>): Promise<ResponseResult> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  const items: ResponseItem[] = []
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (!data || data === '[DONE]') continue
      const event = JSON.parse(data) as {
        type?: string
        item?: ResponseItem
        response?: ResponseResult & { error?: { message?: string } }
        message?: string
      }
      if (event.type === 'response.output_item.done' && event.item) items.push(event.item)
      if (event.type === 'response.completed' && event.response) {
        return { output: items.length ? items : (event.response.output ?? []), usage: event.response.usage }
      }
      if (event.type === 'response.failed' || event.type === 'error') {
        throw new Error(`ChatGPT plan: ${event.response?.error?.message ?? event.message ?? event.type}`)
      }
    }
    if (done) throw new Error('ChatGPT plan: the stream ended before the response completed')
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

/** A JSON answer under a strict schema, cached by its exact input so a repeated request costs nothing. */
export async function structured<T>(
  env: LlmEnv,
  opts: { name: string; instructions: string; input: string; schema: Record<string, unknown>; effort?: string },
): Promise<{ data: T; cached: boolean }> {
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
