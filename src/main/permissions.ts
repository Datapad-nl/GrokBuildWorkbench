import type { PermissionMode, PermissionRequest } from '../shared/types'
import { normalizePermissionMode } from '../shared/types'

export type PermissionOption = {
  optionId: string
  kind?: string
  name?: string
}

export type PermissionParams = {
  sessionId?: string
  options?: PermissionOption[]
  toolCall?: {
    title?: string
    kind?: string
    name?: string
    rawInput?: unknown
    locations?: Array<{ path?: string }>
  }
}

export type PermissionOutcome =
  | { outcome: { outcome: 'selected'; optionId: string } }
  | { outcome: { outcome: 'cancelled' } }

type PendingAsk = {
  request: PermissionRequest
  sessionId: string
  options: PermissionOption[]
  resolve: (outcome: PermissionOutcome) => void
}

const sessionModes = new Map<string, PermissionMode>()
const sessionChats = new Map<string, string>()
const pending = new Map<string, PendingAsk>()
const promptListeners = new Set<(request: PermissionRequest) => void>()
const settleListeners = new Set<(request: PermissionRequest) => void>()
const denyListeners = new Set<(request: PermissionRequest) => void>()

const DENY_KIND = new Set(['edit', 'delete', 'move', 'execute', 'write'])
const DENY_NAME = /\b(write|edit|delete|remove|replace|apply_patch|search_replace|run_terminal|bash|shell|spawn|exec)\b/i

export function bindPermissionSession(sessionId: string, chatId: string, mode: PermissionMode): void {
  sessionChats.set(sessionId, chatId)
  sessionModes.set(sessionId, normalizePermissionMode(mode))
}

export function setSessionMode(sessionId: string, mode: PermissionMode): void {
  sessionModes.set(sessionId, normalizePermissionMode(mode))
}

export function modeForSession(sessionId: string): PermissionMode {
  return sessionModes.get(sessionId) ?? 'accept'
}

export function chatIdForSession(sessionId: string): string | null {
  return sessionChats.get(sessionId) ?? null
}

export function fallbackSessionId(): string {
  if (sessionModes.size === 1) return [...sessionModes.keys()][0]
  return ''
}

export function onPermissionPrompt(listener: (request: PermissionRequest) => void): () => void {
  promptListeners.add(listener)
  return () => {
    promptListeners.delete(listener)
  }
}

export function onPermissionSettled(listener: (request: PermissionRequest) => void): () => void {
  settleListeners.add(listener)
  return () => {
    settleListeners.delete(listener)
  }
}

export function onPermissionDenied(listener: (request: PermissionRequest) => void): () => void {
  denyListeners.add(listener)
  return () => {
    denyListeners.delete(listener)
  }
}

export function noteDeniedPermission(sessionId: string, params: PermissionParams): void {
  const chatId = chatIdForSession(sessionId)
  if (!chatId) return
  const request: PermissionRequest = {
    requestId: `deny:${sessionId}:${Date.now()}`,
    chatId,
    title: `Blocked: ${requestTitle(params)}`,
    detail: requestDetail(params),
    toolKind: params.toolCall?.kind ?? params.toolCall?.name ?? null
  }
  for (const listener of denyListeners) listener(request)
}

export function isMutatingTool(kind?: string, title?: string, name?: string): boolean {
  const toolKind = (kind ?? '').toLowerCase()
  if (DENY_KIND.has(toolKind)) return true
  if (toolKind === 'read' || toolKind === 'search' || toolKind === 'think' || toolKind === 'fetch') {
    return false
  }
  return DENY_NAME.test(`${title ?? ''} ${name ?? ''}`)
}

export function pickOption(
  options: PermissionOption[],
  want: 'allow' | 'deny'
): PermissionOption | null {
  const match = options.find((option) => {
    const kind = (option.kind ?? '').toLowerCase()
    if (want === 'allow') return kind.startsWith('allow')
    return kind.startsWith('reject') || kind.startsWith('deny')
  })
  if (match) return match
  return want === 'allow' ? (options[0] ?? null) : null
}

export function outcomeFor(options: PermissionOption[], want: 'allow' | 'deny'): PermissionOutcome {
  const option = pickOption(options, want)
  if (!option) return { outcome: { outcome: 'cancelled' } }
  return { outcome: { outcome: 'selected', optionId: option.optionId } }
}

function requestTitle(params: PermissionParams): string {
  const tool = params.toolCall
  return tool?.title?.trim() || tool?.name?.trim() || tool?.kind?.trim() || 'Tool'
}

function requestDetail(params: PermissionParams): string | null {
  const paths = (params.toolCall?.locations ?? [])
    .map((location) => location.path)
    .filter((path): path is string => Boolean(path))
  if (paths.length > 0) return paths.join('\n')
  const input = params.toolCall?.rawInput
  if (typeof input === 'string' && input.trim()) return input.trim().slice(0, 240)
  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input).slice(0, 240)
    } catch {
      return null
    }
  }
  return null
}

export function decidePermission(mode: PermissionMode, params: PermissionParams): 'allow' | 'deny' | 'ask' {
  if (mode === 'accept') return 'allow'
  if (mode === 'ask') return 'ask'
  const tool = params.toolCall
  return isMutatingTool(tool?.kind, tool?.title, tool?.name) ? 'deny' : 'allow'
}

export function askPermission(
  requestId: string,
  sessionId: string,
  params: PermissionParams
): Promise<PermissionOutcome> {
  const chatId = chatIdForSession(sessionId)
  if (!chatId) return Promise.resolve(outcomeFor(params.options ?? [], 'allow'))

  const request: PermissionRequest = {
    requestId,
    chatId,
    title: requestTitle(params),
    detail: requestDetail(params),
    toolKind: params.toolCall?.kind ?? params.toolCall?.name ?? null
  }

  return new Promise((resolve) => {
    pending.set(requestId, {
      request,
      sessionId,
      options: params.options ?? [],
      resolve: (outcome) => {
        pending.delete(requestId)
        resolve(outcome)
        for (const listener of settleListeners) listener(request)
      }
    })
    for (const listener of promptListeners) listener(request)
  })
}

export function resolvePermission(requestId: string, decision: 'allow' | 'deny'): boolean {
  const item = pending.get(requestId)
  if (!item) return false
  item.resolve(outcomeFor(item.options, decision))
  return true
}

export function cancelSessionPermissions(sessionId: string): void {
  for (const item of [...pending.values()]) {
    if (item.sessionId === sessionId) item.resolve({ outcome: { outcome: 'cancelled' } })
  }
}

export function cancelChatPermissions(chatId: string): void {
  for (const item of [...pending.values()]) {
    if (item.request.chatId === chatId) item.resolve({ outcome: { outcome: 'cancelled' } })
  }
}

export function cancelAllPermissions(): void {
  for (const item of [...pending.values()]) {
    item.resolve({ outcome: { outcome: 'cancelled' } })
  }
}
