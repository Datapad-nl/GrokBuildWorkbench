import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import readline from 'readline'
import { BROWSER_SESSION_RULE, browserMcpServers } from './browserAgent'
import {
  askPermission,
  cancelAllPermissions,
  chatIdForSession,
  decidePermission,
  fallbackSessionId,
  isMutatingTool,
  isPlanGateTool,
  modeForSession,
  noteDeniedPermission,
  outcomeFor,
  type PermissionParams
} from './permissions'
import {
  askUserQuestions,
  cancelAllQuestions,
  elicitationResult,
  isElicitationMethod,
  isUserQuestionMethod,
  looksLikeUserQuestion,
  parseQuestions,
  skipOutcome
} from './questions'
import type { UsagePeriodKind, UsageSnapshot } from '../shared/types'
import { getApiKey } from './store'
import { readGrokPlan } from './sessions'

type JsonRpc = {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string; code?: number }
}

export type SessionMode = {
  id: string
  name: string
  description?: string
}

export type ExitPlanOutcome = 'approved' | 'cancelled' | 'abandoned'

type ExitPlanParams = {
  sessionId?: string
  planContent?: string
  plan_content?: string
  plan?: string | { content?: string; markdown?: string }
  markdown?: string
  content?: string
}

type PendingExit = {
  id: number | string
  sessionId: string
  chatId: string
  markdown: string
  resolve: (outcome: ExitPlanOutcome) => void
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
    currentModeId?: string
    modeId?: string
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
const EXIT_PLAN_LISTENERS = new Set<(input: { chatId: string; sessionId: string; markdown: string }) => void>()
const acpSessionModes = new Map<string, { current: string; available: SessionMode[] }>()
const pendingExits = new Map<string, PendingExit>()
const queuedVerdicts = new Map<string, ExitPlanOutcome>()
const SESSION_UPDATE_METHODS = new Set(['session/update', 'x.ai/session/update', '_x.ai/session/update'])

let proc: ChildProcessWithoutNullStreams | null = null
let ready: Promise<void> | null = null
let nextId = 1
const pending = new Map<number, Pending>()
const liveSessions = new Set<string>()
const inbound: JsonRpc[] = []
let flushScheduled = false

type TurnWait = {
  done: boolean
  waiters: Array<() => void>
}

const turnWaits = new Map<string, TurnWait>()

function beginTurn(sessionId: string): void {
  const existing = turnWaits.get(sessionId)
  if (existing) {
    existing.done = false
    return
  }
  turnWaits.set(sessionId, { done: false, waiters: [] })
}

function markTurnDone(sessionId: string): void {
  const state = turnWaits.get(sessionId) ?? { done: false, waiters: [] }
  state.done = true
  turnWaits.set(sessionId, state)
  const waiters = state.waiters.splice(0)
  for (const waiter of waiters) waiter()
}

function waitForTurnEnd(sessionId: string, timeoutMs = 500): Promise<void> {
  const state = turnWaits.get(sessionId)
  if (state?.done) return Promise.resolve()
  return new Promise((resolve) => {
    const next = turnWaits.get(sessionId) ?? { done: false, waiters: [] }
    const finish = (): void => {
      clearTimeout(timer)
      next.waiters = next.waiters.filter((waiter) => waiter !== finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    next.waiters.push(finish)
    turnWaits.set(sessionId, next)
  })
}

function enqueue(message: JsonRpc): void {
  // Batch a stdout burst so agent_message_chunk is applied before session/prompt resolves.
  inbound.push(message)
  if (flushScheduled) return
  flushScheduled = true
  setImmediate(flushInbound)
}

function flushInbound(): void {
  flushScheduled = false
  const batch = inbound.splice(0)
  for (const message of batch) handleMessage(message)
  if (inbound.length > 0) {
    flushScheduled = true
    setImmediate(flushInbound)
  }
}

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

async function settlePermission(message: JsonRpc): Promise<void> {
  const params = (message.params ?? {}) as PermissionParams
  const sessionId = params.sessionId || fallbackSessionId()
  const options = params.options ?? []
  const mode = modeForSession(sessionId)
  const decision = decidePermission(mode, params)
  const requestId = message.id === undefined ? null : String(message.id)

  if (decision === 'deny') noteDeniedPermission(sessionId, params)
  const result =
    decision === 'ask' && requestId
      ? await askPermission(requestId, sessionId, params)
      : outcomeFor(options, decision === 'deny' ? 'deny' : 'allow')

  if (message.id === undefined) return
  send({ jsonrpc: '2.0', id: message.id, result })
}

function sessionIdFrom(params: unknown): string {
  const record = params && typeof params === 'object' && !Array.isArray(params) ? (params as { sessionId?: unknown }) : null
  return typeof record?.sessionId === 'string' && record.sessionId ? record.sessionId : fallbackSessionId()
}

function stringField(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function rememberModes(sessionId: string, result: unknown): void {
  if (!sessionId) return
  const rec = (result ?? {}) as {
    modes?: { currentModeId?: string; availableModes?: SessionMode[] }
  }
  const available = rec.modes?.availableModes
  if (!available?.length) return
  acpSessionModes.set(sessionId, {
    current: rec.modes?.currentModeId ?? '',
    available
  })
}

export function acpModeIdFor(sessionId: string, want: 'plan' | 'default'): string | null {
  const available = acpSessionModes.get(sessionId)?.available ?? []
  if (available.length === 0) return null
  if (want === 'plan') {
    return available.find((mode) => /plan|architect/i.test(`${mode.id} ${mode.name}`))?.id ?? null
  }
  const rest = available.filter((mode) => !/plan|architect/i.test(`${mode.id} ${mode.name}`))
  for (const id of ['default', 'agent', 'code', 'ask', 'normal']) {
    const hit = rest.find((mode) => mode.id.toLowerCase() === id)
    if (hit) return hit.id
  }
  return rest[0]?.id ?? null
}

export function onExitPlanPrompt(
  listener: (input: { chatId: string; sessionId: string; markdown: string }) => void
): () => void {
  EXIT_PLAN_LISTENERS.add(listener)
  return () => {
    EXIT_PLAN_LISTENERS.delete(listener)
  }
}

function pendingChatId(item: PendingExit): string | null {
  return item.chatId || chatIdForSession(item.sessionId)
}

export function hasPendingExitPlan(chatId: string): boolean {
  for (const item of pendingExits.values()) {
    if (pendingChatId(item) === chatId) return true
  }
  return false
}

export function queueExitPlanVerdict(chatId: string, outcome: ExitPlanOutcome): void {
  queuedVerdicts.set(chatId, outcome)
}

export function takeQueuedExitPlanVerdict(chatId: string): ExitPlanOutcome | null {
  const outcome = queuedVerdicts.get(chatId) ?? null
  if (outcome) queuedVerdicts.delete(chatId)
  return outcome
}

export function resolveExitPlan(chatId: string, outcome: ExitPlanOutcome): boolean {
  let found = false
  for (const [key, item] of [...pendingExits.entries()]) {
    if (pendingChatId(item) !== chatId) continue
    pendingExits.delete(key)
    queuedVerdicts.delete(chatId)
    item.resolve(outcome)
    found = true
  }
  return found
}

export function bindExitPlanSession(
  sessionId: string,
  chatId: string,
  options: { silent?: boolean } = {}
): void {
  if (!sessionId || !chatId) return
  for (const item of pendingExits.values()) {
    if (item.sessionId !== sessionId) continue
    if (item.chatId && item.chatId !== chatId) continue
    const alreadyBound = item.chatId === chatId
    item.chatId = chatId
    if (options.silent || alreadyBound) continue
    for (const listener of EXIT_PLAN_LISTENERS) {
      listener({ chatId, sessionId, markdown: item.markdown })
    }
  }
}

export async function waitForExitPlan(chatId: string, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (hasPendingExitPlan(chatId)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return hasPendingExitPlan(chatId)
}

function exitPlanResult(outcome: ExitPlanOutcome): Record<string, unknown> {
  return {
    outcome,
    comments: [],
    additional_feedback: '',
    additionalFeedback: ''
  }
}

function planMarkdownFromParams(params: ExitPlanParams, sessionId: string): string {
  const nested = typeof params.plan === 'object' && params.plan ? params.plan : null
  const fromParams = stringField(
    params.planContent,
    params.plan_content,
    params.markdown,
    params.content,
    typeof params.plan === 'string' ? params.plan : '',
    nested?.markdown,
    nested?.content
  )
  if (fromParams) return fromParams
  return readGrokPlan(sessionId)?.markdown ?? ''
}

export function isExitPlanMethod(method?: string): boolean {
  return (
    method === 'x.ai/exit_plan_mode' ||
    method === '_x.ai/exit_plan_mode' ||
    method === 'exit_plan_mode'
  )
}

async function settleExitPlan(message: JsonRpc): Promise<void> {
  const params = (message.params ?? {}) as ExitPlanParams
  const sessionId = params.sessionId || sessionIdFrom(message.params) || fallbackSessionId()
  const chatId = chatIdForSession(sessionId) || ''
  if (message.id === undefined) return

  const markdown = planMarkdownFromParams(params, sessionId)
  const requestId = String(message.id)
  const queued = chatId ? takeQueuedExitPlanVerdict(chatId) : null
  if (queued) {
    send({ jsonrpc: '2.0', id: message.id, result: exitPlanResult(queued) })
    return
  }
  const outcome = await new Promise<ExitPlanOutcome>((resolve) => {
    pendingExits.set(requestId, {
      id: message.id as number | string,
      sessionId,
      chatId,
      markdown,
      resolve: (value) => {
        pendingExits.delete(requestId)
        resolve(value)
      }
    })
    if (chatId) {
      for (const listener of EXIT_PLAN_LISTENERS) listener({ chatId, sessionId, markdown })
    }
  })
  send({ jsonrpc: '2.0', id: message.id, result: exitPlanResult(outcome) })
}

async function settleUserQuestion(message: JsonRpc, kind: 'ext' | 'elicitation'): Promise<void> {
  if (message.id === undefined) return
  const questions = parseQuestions(message.params)
  if (!questions) {
    const skipped = skipOutcome()
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: kind === 'elicitation' ? elicitationResult(skipped, []) : skipped
    })
    return
  }
  const sessionId = sessionIdFrom(message.params)
  const outcome = await askUserQuestions(String(message.id), sessionId, questions, kind)
  const result = kind === 'elicitation' ? elicitationResult(outcome, questions) : outcome
  send({ jsonrpc: '2.0', id: message.id, result })
}

function handleIncomingRequest(message: JsonRpc): boolean {
  if (message.method && SESSION_UPDATE_METHODS.has(message.method)) {
    const params = message.params as SessionUpdate | undefined
    if (params?.sessionId) {
      if (params.update?.sessionUpdate === 'turn_completed') {
        markTurnDone(params.sessionId)
      }
      const modeId = params.update?.currentModeId || params.update?.modeId
      if (params.update?.sessionUpdate === 'current_mode_update' && modeId) {
        const current = acpSessionModes.get(params.sessionId)
        if (current) acpSessionModes.set(params.sessionId, { ...current, current: modeId })
      }
      for (const listener of UPDATE_LISTENERS) listener(params)
    }
    return true
  }

  if (message.method === 'session/request_permission') {
    void settlePermission(message)
    return true
  }

  if (isExitPlanMethod(message.method)) {
    void settleExitPlan(message)
    return true
  }

  if (isElicitationMethod(message.method)) {
    void settleUserQuestion(message, 'elicitation')
    return true
  }

  if (
    isUserQuestionMethod(message.method) ||
    (Boolean(message.method) && message.id !== undefined && looksLikeUserQuestion(message.params))
  ) {
    void settleUserQuestion(message, 'ext')
    return true
  }

  return false
}

function handleMessage(message: JsonRpc): void {
  if (handleIncomingRequest(message)) return

  if (message.id === undefined || typeof message.id !== 'number') {
    if (message.method && message.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` }
      })
    }
    return
  }
  const waiter = pending.get(message.id)
  if (!waiter) {
    if (message.method) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` }
      })
    }
    return
  }
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
      clientInfo: { name: 'Grok Build Workbench', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        elicitation: { form: {} }
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
    throw new Error('Run `grok login` once. Grok Build Workbench uses your Grok Build session.')
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
      enqueue(JSON.parse(trimmed) as JsonRpc)
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
    liveSessions.clear()
    inbound.length = 0
    flushScheduled = false
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Grok Build exited'))
    }
    pending.clear()
    for (const turn of turnWaits.values()) {
      const waiters = turn.waiters.splice(0)
      turn.done = true
      for (const waiter of waiters) waiter()
    }
    turnWaits.clear()
    for (const item of pendingExits.values()) item.resolve('abandoned')
    pendingExits.clear()
    cancelAllPermissions()
    cancelAllQuestions()
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
    const child = spawn(grokBinary(), ['agent', '--no-leader', 'stdio'], {
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

async function sessionConfig(
  cwd: string,
  extraRules?: string | null
): Promise<{
  cwd: string
  mcpServers: Awaited<ReturnType<typeof browserMcpServers>>
  _meta: { rules: string }
}> {
  const rules = extraRules?.trim()
    ? `${BROWSER_SESSION_RULE}\n\n${extraRules.trim()}`
    : BROWSER_SESSION_RULE
  return {
    cwd,
    mcpServers: await browserMcpServers(),
    _meta: { rules }
  }
}

export async function newSession(cwd: string, extraRules?: string | null): Promise<string> {
  await ensureAgent()
  const result = await request<{
    sessionId: string
    modes?: { currentModeId?: string; availableModes?: SessionMode[] }
  }>('session/new', await sessionConfig(cwd, extraRules), 30_000)
  rememberModes(result.sessionId, result)
  liveSessions.add(result.sessionId)
  return result.sessionId
}

export async function loadSession(
  sessionId: string,
  cwd: string,
  extraRules?: string | null
): Promise<void> {
  await ensureAgent()
  const result = await request<unknown>(
    'session/load',
    { sessionId, ...(await sessionConfig(cwd, extraRules)) },
    60_000
  )
  rememberModes(sessionId, result)
  liveSessions.add(sessionId)
}

export function hasLiveSession(sessionId: string): boolean {
  return proc !== null && liveSessions.has(sessionId)
}

function moneyVal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && 'val' in value) {
    const inner = (value as { val?: unknown }).val
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner
  }
  return null
}

function textVal(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function periodKind(value: unknown): UsagePeriodKind {
  const raw = typeof value === 'string' ? value.toUpperCase() : ''
  if (raw.includes('WEEKLY')) return 'weekly'
  if (raw.includes('MONTHLY')) return 'monthly'
  return 'unknown'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function fetchUsage(): Promise<UsageSnapshot> {
  await ensureAgent()
  const raw = asRecord(await request<unknown>('_x.ai/billing', {}, 20_000))
  const config = asRecord(raw.config ?? raw)
  const period = asRecord(config.currentPeriod)
  const used = moneyVal(config.creditUsagePercent)
  return {
    tier: textVal(raw.subscription_tier) ?? textVal(raw.subscriptionTier),
    usedPercent: used === null ? null : Math.min(100, Math.max(0, used)),
    period: periodKind(period.type ?? config.billingCycle),
    periodStart: textVal(period.start) ?? textVal(config.billingPeriodStart),
    periodEnd: textVal(period.end) ?? textVal(config.billingPeriodEnd),
    prepaidBalance: moneyVal(config.prepaidBalance),
    onDemandCap: moneyVal(config.onDemandCap),
    onDemandUsed: moneyVal(config.onDemandUsed),
    unifiedBilling: config.isUnifiedBillingUser === true
  }
}

export async function setAcpSessionMode(sessionId: string, modeId: string): Promise<boolean> {
  if (!sessionId || !modeId) return false
  try {
    await ensureAgent()
    await request('session/set_mode', { sessionId, modeId }, 15_000)
    const current = acpSessionModes.get(sessionId)
    if (current) acpSessionModes.set(sessionId, { ...current, current: modeId })
    return true
  } catch {
    return false
  }
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
  beginTurn(sessionId)
  await request(
    'session/prompt',
    {
      sessionId,
      prompt
    },
    15 * 60_000
  )
  await waitForTurnEnd(sessionId)
}

export function cancelSession(sessionId: string): void {
  if (!proc) return
  send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
}

export function abortMainAgent(): void {
  if (!proc) return
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer)
    waiter.reject(new Error('cancelled'))
  }
  pending.clear()
  for (const item of pendingExits.values()) item.resolve('abandoned')
  pendingExits.clear()
  cancelAllQuestions()
  try {
    proc.kill()
  } catch {
    // already gone
  }
  proc = null
  ready = null
  liveSessions.clear()
  inbound.length = 0
  flushScheduled = false
  for (const turn of turnWaits.values()) {
    const waiters = turn.waiters.splice(0)
    turn.done = true
    for (const waiter of waiters) waiter()
  }
  turnWaits.clear()
}

export function isAgentRunning(): boolean {
  return proc !== null
}

export async function promptIsolated(
  cwd: string,
  text: string,
  images: Array<{ mimeType: string; data: string }> = [],
  onText?: (chunk: string) => void,
  signal?: AbortSignal,
  options?: { timeoutMs?: number; rules?: string }
): Promise<string> {
  if (signal?.aborted) throw new Error('cancelled')
  const child = spawn(grokBinary(), ['agent', '--no-leader', 'stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  })
  let next = 1
  const waiters = new Map<number, Pending>()
  let assembled = ''

  const write = (payload: object): void => {
    if (!child.stdin.writable) throw new Error('Aside agent is not running')
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  const call = <T,>(method: string, params: unknown, timeoutMs: number): Promise<T> => {
    const id = next++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      waiters.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      write({ jsonrpc: '2.0', id, method, params })
    })
  }

  const onLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return
    let message: JsonRpc
    try {
      message = JSON.parse(trimmed) as JsonRpc
    } catch {
      return
    }
    if (message.method === 'session/update') {
      const params = message.params as SessionUpdate | undefined
      if (params?.update?.sessionUpdate === 'agent_message_chunk') {
        const chunk = contentText(params.update.content)
        if (chunk) {
          assembled += chunk
          onText?.(chunk)
        }
      }
      return
    }
    if (message.method === 'session/request_permission') {
      const params = (message.params ?? {}) as PermissionParams
      const tool = params.toolCall
      const deny = isPlanGateTool(params) || isMutatingTool(tool?.kind, tool?.title, tool?.name)
      if (message.id !== undefined) {
        write({
          jsonrpc: '2.0',
          id: message.id,
          result: outcomeFor(params.options ?? [], deny ? 'deny' : 'allow')
        })
      }
      return
    }
    if (isExitPlanMethod(message.method)) {
      if (message.id !== undefined) {
        write({ jsonrpc: '2.0', id: message.id, result: exitPlanResult('abandoned') })
      }
      return
    }
    if (
      isUserQuestionMethod(message.method) ||
      isElicitationMethod(message.method) ||
      looksLikeUserQuestion(message.params)
    ) {
      if (message.id !== undefined) {
        const questions = parseQuestions(message.params) ?? []
        const skipped = skipOutcome()
        write({
          jsonrpc: '2.0',
          id: message.id,
          result: isElicitationMethod(message.method)
            ? elicitationResult(skipped, questions)
            : skipped
        })
      }
      return
    }
    if (message.id === undefined || typeof message.id !== 'number') return
    const waiter = waiters.get(message.id)
    if (!waiter) return
    clearTimeout(waiter.timer)
    waiters.delete(message.id)
    if (message.error) {
      waiter.reject(new Error(message.error.message || JSON.stringify(message.error)))
      return
    }
    waiter.resolve(message.result)
  }

  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', onLine)
  child.stderr.on('data', () => undefined)

  const stop = (): void => {
    for (const waiter of waiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('cancelled'))
    }
    waiters.clear()
    rl.close()
    if (!child.killed) child.kill()
  }

  const onAbort = (): void => stop()
  signal?.addEventListener('abort', onAbort)

  try {
    const init = await call<{ authMethods?: Array<{ id: string }> }>(
      'initialize',
      {
        protocolVersion: 1,
        clientInfo: { name: 'Grok Build Workbench-aside', version: '0.1.0' },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          elicitation: { form: {} }
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
    if (!methodId) throw new Error('Run `grok login` once. Grok Build Workbench uses your Grok Build session.')
    await call('authenticate', { methodId, _meta: { headless: true } }, 30_000)
    const created = await call<{ sessionId: string }>(
      'session/new',
      {
        cwd,
        mcpServers: [],
        _meta: {
          rules:
            options?.rules ??
            'Read-only aside on the current main task. Use the provided context. You may read project files. Do not edit files or run mutating commands.'
        }
      },
      30_000
    )
    const prompt: Array<{ type: string; text?: string; mimeType?: string; data?: string }> = []
    if (text.trim()) prompt.push({ type: 'text', text })
    for (const image of images) {
      prompt.push({ type: 'image', mimeType: image.mimeType, data: image.data })
    }
    await call('session/prompt', { sessionId: created.sessionId, prompt }, options?.timeoutMs ?? 15 * 60_000)
    return assembled.trim()
  } finally {
    signal?.removeEventListener('abort', onAbort)
    stop()
  }
}
