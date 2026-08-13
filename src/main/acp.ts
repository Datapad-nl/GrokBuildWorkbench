import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import readline from 'readline'
import { getApiKey } from './store'

type JsonRpc = {
  jsonrpc?: string
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string; code?: number }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type SessionUpdate = {
  sessionId: string
  update: {
    sessionUpdate?: string
    content?: unknown
    title?: string
    kind?: string
    status?: string
    toolCallId?: string
    locations?: Array<{ path?: string; line?: number }>
    entries?: Array<{ content?: string; status?: string; priority?: string }>
    rawInput?: unknown
    rawOutput?: unknown
    name?: string
  }
}

export function contentText(content: unknown): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.map(contentText).filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('') : null
  }
  if (typeof content !== 'object') return null
  const record = content as { text?: unknown; content?: unknown }
  if (typeof record.text === 'string') return record.text
  if (record.content !== undefined) return contentText(record.content)
  return null
}

const UPDATE_LISTENERS = new Set<(update: SessionUpdate) => void>()

let proc: ChildProcessWithoutNullStreams | null = null
let ready: Promise<void> | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function grokBinary(): string {
  const homeBin = join(homedir(), '.grok', 'bin', 'grok')
  if (process.env.GROK_BIN && existsSync(process.env.GROK_BIN)) return process.env.GROK_BIN
  if (existsSync(homeBin)) return homeBin
  return 'grok'
}

function send(payload: object): void {
  if (!proc?.stdin.writable) throw new Error('Grok Build is not running')
  proc.stdin.write(`${JSON.stringify(payload)}\n`)
}

function request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer
    })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function handleMessage(message: JsonRpc): void {
  if (message.method === 'session/update') {
    const params = message.params as SessionUpdate | undefined
    if (params?.sessionId) {
      for (const listener of UPDATE_LISTENERS) listener(params)
    }
    return
  }

  if (message.method === 'session/request_permission') {
    const params = message.params as {
      options?: Array<{ optionId: string; kind?: string }>
    }
    const options = params?.options ?? []
    const allow =
      options.find((option) => (option.kind ?? '').toLowerCase().startsWith('allow')) ?? options[0]
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: allow
        ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
        : { outcome: { outcome: 'cancelled' } }
    })
    return
  }

  if (message.id === undefined) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  clearTimeout(waiter.timer)
  pending.delete(message.id)
  if (message.error) {
    waiter.reject(new Error(message.error.message || JSON.stringify(message.error)))
    return
  }
  waiter.resolve(message.result)
}

async function authenticate(): Promise<void> {
  const init = await request<{
    authMethods?: Array<{ id: string }>
    agentCapabilities?: { loadSession?: boolean }
  }>(
    'initialize',
    {
      protocolVersion: 1,
      clientInfo: { name: 'GrokCode', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      }
    },
    30_000
  )

  const methods = new Set((init.authMethods ?? []).map((method) => method.id))
  const apiKey = await getApiKey()
  const methodId = methods.has('cached_token')
    ? 'cached_token'
    : apiKey && methods.has('xai.api_key')
      ? 'xai.api_key'
      : null

  if (!methodId) {
    throw new Error('Run `grok login` once. GrokCode uses your Grok Build session.')
  }

  await request('authenticate', { methodId, _meta: { headless: true } }, 30_000)
}

function attachProcess(child: ChildProcessWithoutNullStreams): void {
  proc = child
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return
    try {
      handleMessage(JSON.parse(trimmed) as JsonRpc)
    } catch {
      // ignore non-JSON banners
    }
  })
  child.stderr.on('data', () => {
    // keep stderr from filling the pipe
  })
  child.on('exit', () => {
    proc = null
    ready = null
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Grok Build exited'))
    }
    pending.clear()
  })
}

export function onSessionUpdate(listener: (update: SessionUpdate) => void): () => void {
  UPDATE_LISTENERS.add(listener)
  return () => {
    UPDATE_LISTENERS.delete(listener)
  }
}

export async function ensureAgent(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    const child = spawn(grokBinary(), ['agent', '--no-leader', '--always-approve', 'stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })
    attachProcess(child)
    await authenticate()
  })()
  try {
    await ready
  } catch (error) {
    ready = null
    proc?.kill()
    proc = null
    throw error
  }
}

export async function newSession(cwd: string): Promise<string> {
  await ensureAgent()
  const result = await request<{ sessionId: string }>(
    'session/new',
    { cwd, mcpServers: [] },
    30_000
  )
  return result.sessionId
}

export async function loadSession(sessionId: string, cwd: string): Promise<void> {
  await ensureAgent()
  await request('session/load', { sessionId, cwd, mcpServers: [] }, 60_000)
}

export async function promptSession(
  sessionId: string,
  text: string,
  images: Array<{ mimeType: string; data: string }> = []
): Promise<void> {
  await ensureAgent()
  const prompt: Array<{ type: string; text?: string; mimeType?: string; data?: string }> = []
  if (text.trim()) {
    prompt.push({ type: 'text', text })
  }
  for (const image of images) {
    prompt.push({ type: 'image', mimeType: image.mimeType, data: image.data })
  }
  if (prompt.length === 0) {
    throw new Error('Message is empty')
  }
  await request(
    'session/prompt',
    {
      sessionId,
      prompt
    },
    15 * 60_000
  )
}

export function cancelSession(sessionId: string): void {
  if (!proc) return
  send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
}

export function isAgentRunning(): boolean {
  return proc !== null
}
