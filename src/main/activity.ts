import { BrowserWindow } from 'electron'
import type {
  ActivityDiff,
  ActivityEvent,
  ActivityFeed,
  ActivitySnapshot,
  ActivityStatus
} from '../shared/types'
import { contentText, onSessionUpdate, type SessionUpdate } from './acp'
import { id, now } from './ids'

const MAX_EVENTS = 400

type BoundChat = {
  id: string
  title: string
}

let started = false
const events: ActivityEvent[] = []
const sessions = new Map<string, BoundChat>()
const listeners = new Set<(feed: ActivityFeed) => void>()

export function bindSession(sessionId: string, chat: BoundChat): void {
  sessions.set(sessionId, chat)
}

export function lookupSession(sessionId: string): BoundChat | null {
  return sessions.get(sessionId) ?? null
}

export function onActivityFeed(listener: (feed: ActivityFeed) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function broadcast(feed: ActivityFeed): void {
  for (const listener of listeners) listener(feed)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('activity:event', feed)
  }
}

const pendingBroadcasts = new Map<string, ActivityEvent>()
let broadcastTimer: ReturnType<typeof setTimeout> | null = null

function flushBroadcasts(): void {
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
  if (pendingBroadcasts.size === 0) return
  const batch = [...pendingBroadcasts.values()]
  pendingBroadcasts.clear()
  for (const event of batch) broadcast({ type: 'upsert', event })
}

function publish(event: ActivityEvent): void {
  const batch = (event.kind === 'thought' || event.kind === 'write') && event.status === 'running'
  if (batch) {
    pendingBroadcasts.set(event.id, event)
    if (!broadcastTimer) broadcastTimer = setTimeout(flushBroadcasts, 80)
    return
  }
  flushBroadcasts()
  broadcast({ type: 'upsert', event })
}

function joinText(previous: string | null, next: string | null): string | null {
  if (!previous) return next
  if (!next) return previous
  return previous + next
}

function emitActivity(
  input: Omit<ActivityEvent, 'id' | 'at'> & { id?: string; at?: string }
): ActivityEvent {
  const incoming: ActivityEvent = {
    id: input.id ?? id(),
    at: input.at ?? now(),
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    sessionId: input.sessionId,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    status: input.status,
    toolKind: input.toolKind,
    diffs: input.diffs,
    coalesceKey: input.coalesceKey
  }

  if (incoming.coalesceKey) {
    const index = events.findIndex((event) => event.coalesceKey === incoming.coalesceKey)
    if (index >= 0) {
      const previous = events[index]
      const merged: ActivityEvent = {
        ...previous,
        ...incoming,
        id: previous.id,
        at: previous.at,
        title: preferTitle(incoming.title, previous.title),
        toolKind: incoming.toolKind || previous.toolKind,
        status: incoming.status ?? previous.status,
        detail: mergeDetail(previous, incoming),
        diffs:
          incoming.diffs && incoming.diffs.length > 0 ? incoming.diffs : previous.diffs
      }
      events[index] = merged
      publish(merged)
      return merged
    }
  }

  events.push(incoming)
  if (events.length > MAX_EVENTS) events.shift()
  publish(incoming)
  return incoming
}

function boundFields(sessionId: string | null): Pick<ActivityEvent, 'chatId' | 'chatTitle'> {
  if (!sessionId) return { chatId: null, chatTitle: null }
  const bound = lookupSession(sessionId)
  return { chatId: bound?.id ?? null, chatTitle: bound?.title ?? null }
}

export function emitNotice(input: {
  chatId: string
  chatTitle: string
  title: string
  detail: string
}): void {
  emitActivity({
    kind: 'write',
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    sessionId: null,
    title: input.title,
    detail: input.detail,
    status: 'done'
  })
}

export function startTurn(input: {
  chatId: string
  chatTitle: string
  sessionId: string
  prompt: string
}): void {
  bindSession(input.sessionId, { id: input.chatId, title: input.chatTitle })
  emitActivity({
    kind: 'turn',
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    sessionId: input.sessionId,
    title: input.chatTitle,
    detail: input.prompt,
    status: 'running',
    coalesceKey: `turn:${input.chatId}`
  })
}

export function emitPermissionActivity(input: {
  chatId: string
  sessionId: string | null
  title: string
  detail: string | null
  status: ActivityStatus
  requestId: string
}): void {
  const bound = input.sessionId ? boundFields(input.sessionId) : { chatId: input.chatId, chatTitle: null }
  emitActivity({
    kind: 'permission',
    chatId: input.chatId,
    chatTitle: bound.chatTitle,
    sessionId: input.sessionId,
    title: input.title,
    detail: input.detail,
    status: input.status,
    coalesceKey: `permission:${input.requestId}`
  })
}

export function finishTurn(chatId: string, status: Exclude<ActivityStatus, 'running'>, error?: string): void {
  const current = events.find((event) => event.coalesceKey === `turn:${chatId}`)
  emitActivity({
    kind: 'turn',
    chatId,
    chatTitle: current?.chatTitle ?? null,
    sessionId: current?.sessionId ?? null,
    title: current?.title ?? 'Turn',
    detail: error ?? current?.detail ?? null,
    status,
    coalesceKey: `turn:${chatId}`
  })

  for (const event of events) {
    if (event.chatId !== chatId || event.status !== 'running' || event.kind === 'turn') continue
    emitActivity({
      ...event,
      status: status === 'error' && event.kind !== 'thought' ? 'error' : 'done'
    })
  }
}

export function getActivitySnapshot(): ActivitySnapshot {
  return { events: [...events] }
}

export function clearActivity(): ActivitySnapshot {
  flushBroadcasts()
  events.length = 0
  broadcast({ type: 'reset', events: [] })
  return getActivitySnapshot()
}

const WEAK_LABELS = new Set([
  'tool',
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
  'call'
])

const SKIP_KEYS = /^(data|blob|image|token|apikey|api_key|password|secret|authorization|sessionid)$/i
const INPUT_KEYS = [
  'command',
  'cmd',
  'script',
  'code',
  'query',
  'pattern',
  'glob',
  'url',
  'uri',
  'path',
  'file',
  'file_path',
  'target_file',
  'filename',
  'prompt',
  'text',
  'description'
]
const OUTPUT_KEYS = ['stdout', 'stderr', 'output', 'result', 'text', 'content', 'message', 'error']

function clip(text: string, max = 2400): string {
  const lines = text.replace(/\s+$/u, '').split('\n')
  const limited = lines.length > 48 ? `${lines.slice(0, 48).join('\n')}\n… ${lines.length - 48} more lines` : text
  if (limited.length <= max) return limited
  return `${limited.slice(0, max).trimEnd()}…`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function isWeakLabel(value: string | null | undefined): boolean {
  if (!value) return true
  return WEAK_LABELS.has(value.trim().toLowerCase())
}

function preferTitle(incoming: string, previous: string): string {
  if (isWeakLabel(incoming)) return previous || incoming
  return incoming
}

function mergeDetail(previous: ActivityEvent, incoming: ActivityEvent): string | null {
  if (incoming.kind === 'thought' && incoming.id !== previous.id) {
    return joinText(previous.detail, incoming.detail)
  }
  if (incoming.kind !== 'tool') return incoming.detail ?? previous.detail
  const prev = previous.detail
  const next = incoming.detail
  if (!next) return prev
  if (!prev) return next
  if (isWeakLabel(next)) return prev
  if (isWeakLabel(prev)) return next
  if (next.includes(prev)) return next
  if (prev.includes(next)) return prev
  return `${prev}\n\n${next}`
}

function toolStatus(value: string | undefined): ActivityStatus | null {
  const status = (value ?? '').toLowerCase()
  if (status === 'failed' || status === 'error') return 'error'
  if (status === 'completed' || status === 'done' || status === 'cancelled') return 'done'
  if (status === 'pending' || status === 'in_progress' || status === 'running') return 'running'
  return value ? 'running' : null
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts.at(-1) || path
}

function prettyObject(value: unknown, depth = 0): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value
      .slice(0, 12)
      .map((item) => prettyObject(item, depth + 1))
      .filter((item): item is string => Boolean(item))
    return parts.length > 0 ? parts.join('\n') : null
  }
  const record = asRecord(value)
  if (!record) return null
  const nested =
    asRecord(record.arguments) ?? asRecord(record.input) ?? asRecord(record.params) ?? asRecord(record.args)
  if (nested && depth < 3) {
    const fromNested = prettyObject(nested, depth + 1)
    if (fromNested) return fromNested
  }
  const lines: string[] = []
  for (const [key, item] of Object.entries(record)) {
    if (SKIP_KEYS.test(key)) continue
    if (item == null) continue
    if (typeof item === 'string') {
      if (!item.trim()) continue
      lines.push(item.includes('\n') ? `${key}:\n${item}` : `${key}: ${item}`)
      continue
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      lines.push(`${key}: ${item}`)
      continue
    }
    const nestedText = prettyObject(item, depth + 1)
    if (nestedText) lines.push(item && typeof item === 'object' ? `${key}:\n${nestedText}` : `${key}: ${nestedText}`)
  }
  return lines.length > 0 ? lines.join('\n') : null
}

function pickPreferred(value: unknown, keys: string[], depth = 0): string | null {
  if (typeof value === 'string') return value.trim() ? value : null
  const record = asRecord(value)
  if (!record || depth > 3) return null
  const hit = firstString(record, keys)
  if (hit) return hit
  for (const nested of [record.arguments, record.input, record.params, record.args]) {
    const found = pickPreferred(nested, keys, depth + 1)
    if (found) return found
  }
  return null
}

function summarizeBlob(value: unknown, preferredKeys: string[]): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() ? value : null
  const preferred = pickPreferred(value, preferredKeys)
  const rest = prettyObject(value)
  if (preferred && rest && rest !== preferred && !rest.includes(preferred)) return `${preferred}\n${rest}`
  return preferred ?? rest
}

function toolContentText(content: unknown): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.map(toolContentText).filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('\n') : null
  }
  const record = asRecord(content)
  if (!record) return null
  if (record.type === 'diff') {
    const path = typeof record.path === 'string' ? record.path : 'file'
    return path
  }
  if (record.type === 'terminal' && typeof record.terminalId === 'string') {
    return `terminal ${record.terminalId}`
  }
  return contentText(record)
}

function clipDiff(text: string, maxLines = 240): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return `${lines.slice(0, maxLines).join('\n')}\n… ${lines.length - maxLines} more lines`
}

function collectContentDiffs(content: unknown, diffs: ActivityDiff[]): void {
  if (!content) return
  if (Array.isArray(content)) {
    for (const item of content) collectContentDiffs(item, diffs)
    return
  }
  const record = asRecord(content)
  if (!record) return
  if (record.type === 'diff') {
    diffs.push({
      path: typeof record.path === 'string' ? record.path : '',
      oldText: clipDiff(typeof record.oldText === 'string' ? record.oldText : ''),
      newText: clipDiff(typeof record.newText === 'string' ? record.newText : '')
    })
  }
  if (record.content !== undefined) collectContentDiffs(record.content, diffs)
}

function extractDiffs(update: SessionUpdate['update']): ActivityDiff[] {
  const diffs: ActivityDiff[] = []
  collectContentDiffs(update.content, diffs)
  const oldText = pickPreferred(update.rawInput, ['oldText', 'old_string', 'old_str', 'before'])
  const newText = pickPreferred(update.rawInput, ['newText', 'new_string', 'new_str', 'after'])
  const path =
    pickPreferred(update.rawInput, ['path', 'file', 'file_path', 'target_file', 'filename']) ??
    diffs[0]?.path ??
    ''
  if (oldText !== null && newText !== null && (oldText.length > 0 || newText.length > 0)) {
    const already = diffs.some((diff) => diff.oldText === oldText && diff.newText === newText)
    if (!already) diffs.push({ path, oldText: clipDiff(oldText), newText: clipDiff(newText) })
  }
  return diffs
}

function summarizeTool(update: SessionUpdate['update']): {
  title: string
  detail: string | null
  toolKind: string | null
  diffs: ActivityDiff[]
} {
  const toolKind = update.kind?.trim() || null
  const diffs = extractDiffs(update)
  const paths = (update.locations ?? []).map((location) => location.path).filter((path): path is string => Boolean(path))
  const input = diffs.length > 0 ? null : summarizeBlob(update.rawInput, INPUT_KEYS)
  const output =
    diffs.length > 0 ? null : (toolContentText(update.content) ?? summarizeBlob(update.rawOutput, OUTPUT_KEYS))
  const chunks = [
    input,
    paths.length > 0 ? paths.join('\n') : null,
    diffs.length > 0 ? null : output
  ].filter((chunk): chunk is string => Boolean(chunk))
  const unique: string[] = []
  for (const chunk of chunks) {
    if (unique.includes(chunk)) continue
    unique.push(chunk)
  }
  const detail = unique.length > 0 ? clip(unique.join('\n\n')) : null

  const inputLine = input?.split('\n').find((line) => line.trim())?.trim()
  const title =
    (!isWeakLabel(update.title) && update.title) ||
    (diffs[0]?.path ? fileName(diffs[0].path) : null) ||
    (inputLine ? clip(inputLine, 96) : null) ||
    (paths[0] ? fileName(paths[0]) : null) ||
    update.name ||
    (toolKind ? toolKind.replace(/_/g, ' ') : null) ||
    'Tool'

  return { title, detail, toolKind, diffs }
}

function planDetail(update: SessionUpdate['update']): string | null {
  const entries = update.entries
  if (!entries || entries.length === 0) return update.title ?? null
  return entries
    .map((entry) => {
      const mark = entry.status === 'completed' ? 'done' : entry.status === 'in_progress' ? 'now' : 'todo'
      return `${mark}  ${entry.content ?? ''}`.trim()
    })
    .join('\n')
}

function handleSessionUpdate(event: SessionUpdate): void {
  const sessionId = event.sessionId
  const update = event.update ?? {}
  const kind = update.sessionUpdate ?? ''
  const bound = boundFields(sessionId)

  if (kind === 'agent_thought_chunk') {
    const text = contentText(update.content)
    if (!text) return
    emitActivity({
      kind: 'thought',
      sessionId,
      ...bound,
      title: 'Thinking',
      detail: text,
      status: 'running',
      coalesceKey: `thought:${sessionId}`
    })
    return
  }

  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const toolCallId = update.toolCallId || update.title || 'tool'
    const summary = summarizeTool(update)
    emitActivity({
      kind: 'tool',
      sessionId,
      ...bound,
      title: summary.title,
      detail: summary.detail,
      toolKind: summary.toolKind,
      diffs: summary.diffs,
      status: toolStatus(update.status),
      coalesceKey: `tool:${sessionId}:${toolCallId}`
    })
    return
  }

  if (kind === 'plan') {
    emitActivity({
      kind: 'plan',
      sessionId,
      ...bound,
      title: update.title || 'Plan',
      detail: planDetail(update),
      status: 'running',
      coalesceKey: `plan:${sessionId}`
    })
    return
  }

  if (kind === 'agent_message_chunk') {
    emitActivity({
      kind: 'write',
      sessionId,
      ...bound,
      title: 'Writing reply',
      detail: null,
      status: 'running',
      coalesceKey: `write:${sessionId}`
    })
  }
}

export function startActivityBridge(): void {
  if (started) return
  started = true
  onSessionUpdate(handleSessionUpdate)
}
