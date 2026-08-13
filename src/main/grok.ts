import { homedir } from 'os'
import type {
  Attachment,
  Chat,
  ChatEvent,
  ChatPlan,
  FileMention,
  PermissionMode,
  PlanEntry,
  Project
} from '../shared/types'
import { normalizePermissionMode } from '../shared/types'
import {
  cancelSession,
  contentText,
  ensureAgent,
  loadSession,
  newSession,
  onSessionUpdate,
  promptSession,
  type SessionUpdate
} from './acp'
import { emitNotice, finishTurn, startTurn } from './activity'
import { finishCheckpoint, snapshotTouched, startCheckpoint, rewindTo } from './checkpoints'
import { id, now, titleFromPrompt } from './ids'
import {
  bindPermissionSession,
  cancelChatPermissions,
  cancelSessionPermissions,
  setSessionMode
} from './permissions'
import { grokBuildSignedIn } from './sessions'
import { chatWorkingDir, isolateChatIfNeeded } from './git'
import { getApiKey, getChat, listChats, saveChat } from './store'

const PLAN_MODE_INSTRUCTION = [
  'You are in plan mode.',
  'Explore the codebase and write a concrete implementation plan.',
  'Do not edit files, apply patches, or run mutating commands.',
  'Read, search, and inspect only.',
  'Use the plan tool to list ordered steps.',
  'Wait for the user to approve before implementing.'
].join(' ')

const inflight = new Map<string, { sessionId: string; gen: number }>()
let nextGen = 1
const drafts = new Map<string, string>()
const livePlans = new Map<string, ChatPlan>()
const sessionChats = new Map<string, string>()
const liveListeners = new Set<(event: ChatEvent) => void>()

function emitLive(event: ChatEvent): void {
  for (const listener of liveListeners) listener(event)
}

export function onChatLive(listener: (event: ChatEvent) => void): () => void {
  liveListeners.add(listener)
  return () => {
    liveListeners.delete(listener)
  }
}

function planStatus(value?: string): PlanEntry['status'] {
  const status = (value ?? '').toLowerCase()
  if (status === 'completed' || status === 'done') return 'completed'
  if (status === 'in_progress' || status === 'in-progress' || status === 'now') return 'in_progress'
  return 'pending'
}

function planFromUpdate(update: SessionUpdate['update']): ChatPlan | null {
  const entries = (update.entries ?? [])
    .map((entry) => ({
      content: (entry.content ?? '').trim(),
      status: planStatus(entry.status)
    }))
    .filter((entry) => entry.content.length > 0)
  const title = update.title?.trim() || 'Plan'
  if (entries.length === 0 && title === 'Plan') return null
  return { title, entries }
}

onSessionUpdate((event) => {
  const chatId = sessionChats.get(event.sessionId)
  if (event.update.sessionUpdate === 'plan') {
    const plan = planFromUpdate(event.update)
    if (!plan || !chatId) return
    livePlans.set(chatId, plan)
    emitLive({ type: 'plan', chatId, plan })
    return
  }
  if (event.update.sessionUpdate === 'tool_call' || event.update.sessionUpdate === 'tool_call_update') {
    if (chatId) void snapshotTouched(chatId, event.update)
    return
  }
  if (event.update.sessionUpdate !== 'agent_message_chunk') return
  const text = contentText(event.update.content)
  if (!text) return
  const current = drafts.get(event.sessionId) ?? ''
  drafts.set(event.sessionId, current + text)
  deltaListeners.get(event.sessionId)?.(text)
})

const deltaListeners = new Map<string, (text: string) => void>()

export function isStreaming(chatId: string): boolean {
  return inflight.has(chatId)
}

export function stopStream(chatId: string): boolean {
  const current = inflight.get(chatId)
  cancelChatPermissions(chatId)
  if (!current) return false
  inflight.delete(chatId)
  cancelSessionPermissions(current.sessionId)
  cancelSession(current.sessionId)
  return true
}

function isCurrentTurn(chatId: string, gen: number): boolean {
  return inflight.get(chatId)?.gen === gen
}

function withLivePlan(chat: Chat): Chat {
  const plan = livePlans.get(chat.id)
  return plan ? { ...chat, plan } : chat
}

function promptForMentions(text: string, mentions?: FileMention[]): string {
  if (!mentions || mentions.length === 0) return text
  const list = mentions
    .map((item) => `- ${item.path}${item.kind === 'folder' ? '/' : ''}`)
    .join('\n')
  const block = `The user referenced these project paths. Read them before answering.\n${list}`
  return text.trim() ? `${block}\n\n${text}` : block
}

function promptForMode(mode: PermissionMode, text: string): string {
  if (mode !== 'plan') return text
  if (!text.trim()) return PLAN_MODE_INSTRUCTION
  return `${PLAN_MODE_INSTRUCTION}\n\n${text}`
}

export async function rewindChat(chatId: string, checkpointId: string, cwd: string | null): Promise<Chat> {
  if (isStreaming(chatId)) stopStream(chatId)
  const chat = await rewindTo(chatId, checkpointId, cwd)
  livePlans.delete(chatId)
  emitLive({ type: 'chat', chatId, chat })
  return chat
}

export async function setChatMode(chatId: string, mode: PermissionMode): Promise<Chat> {
  const chat = await getChat(chatId)
  chat.mode = normalizePermissionMode(mode)
  if (chat.grokSessionId) {
    setSessionMode(chat.grokSessionId, chat.mode)
    bindPermissionSession(chat.grokSessionId, chat.id, chat.mode)
  }
  return saveChat(chat)
}

async function resolveSession(chat: Chat, project: Project | undefined): Promise<{ chat: Chat; sessionId: string }> {
  const cwd = chatWorkingDir(chat, project?.path) || homedir()
  if (chat.grokSessionId) {
    try {
      await loadSession(chat.grokSessionId, cwd)
      bindPermissionSession(chat.grokSessionId, chat.id, normalizePermissionMode(chat.mode))
      return { chat, sessionId: chat.grokSessionId }
    } catch {
      bindPermissionSession(chat.grokSessionId, chat.id, normalizePermissionMode(chat.mode))
      return { chat, sessionId: chat.grokSessionId }
    }
  }
  const sessionId = await newSession(cwd)
  chat.grokSessionId = sessionId
  const saved = await saveChat(chat)
  bindPermissionSession(sessionId, saved.id, normalizePermissionMode(saved.mode))
  return { chat: saved, sessionId }
}

export async function appendUserMessage(
  chatId: string,
  content: string,
  attachments: Attachment[] = [],
  mentions: FileMention[] = []
): Promise<Chat> {
  if (inflight.has(chatId)) {
    throw new Error('This chat is already generating')
  }
  const trimmed = content.trim()
  if (!trimmed && attachments.length === 0 && mentions.length === 0) throw new Error('Message is empty')

  const chat = await getChat(chatId)
  chat.messages.push({
    id: id(),
    role: 'user',
    content: trimmed,
    attachments: attachments.length > 0 ? attachments : undefined,
    mentions: mentions.length > 0 ? mentions : undefined,
    createdAt: now()
  })
  if (chat.title === 'New chat') {
    chat.title = trimmed
      ? titleFromPrompt(trimmed)
      : mentions[0]?.path ?? (attachments.length > 0 ? 'Screenshot' : 'New chat')
  }
  return saveChat(chat)
}

export async function streamAssistant(
  chat: Chat,
  project: Project | undefined,
  onDelta: (text: string) => void
): Promise<Chat | null> {
  if (inflight.has(chat.id)) {
    throw new Error('This chat is already generating')
  }
  if (!grokBuildSignedIn() && !(await getApiKey())) {
    throw new Error('Run `grok login` so Grok Build can pick up this chat.')
  }

  await ensureAgent()
  const lastUser = [...chat.messages].reverse().find((message) => message.role === 'user')
  if (!lastUser) throw new Error('Message is empty')
  if (!chat.worktreePath && project?.path) {
    const siblings = (await listChats()).filter(
      (item) => item.projectId === chat.projectId && item.id !== chat.id
    )
    const isolated = await isolateChatIfNeeded(chat, project.path, lastUser.content, {
      streaming: siblings.some((item) => isStreaming(item.id)),
      worktrees: siblings.filter((item) => item.worktreePath).length,
      chats: siblings.length
    })
    if (isolated.reason) {
      chat = await saveChat(isolated.chat)
      emitLive({ type: 'chat', chatId: chat.id, chat })
      emitNotice({
        chatId: chat.id,
        chatTitle: chat.title,
        title: 'Isolated worktree',
        detail: `${isolated.reason}\n${chat.worktreeBranch ?? ''}`
      })
    }
  }
  const resolved = await resolveSession(chat, project)

  const gen = nextGen++
  inflight.set(chat.id, { sessionId: resolved.sessionId, gen })
  sessionChats.set(resolved.sessionId, chat.id)
  bindPermissionSession(
    resolved.sessionId,
    chat.id,
    normalizePermissionMode(resolved.chat.mode)
  )
  drafts.set(resolved.sessionId, '')
  deltaListeners.set(resolved.sessionId, onDelta)
  startTurn({
    chatId: resolved.chat.id,
    chatTitle: resolved.chat.title,
    sessionId: resolved.sessionId,
    prompt: lastUser.content || 'Screenshot'
  })

  try {
    await startCheckpoint({
      chat: resolved.chat,
      messageId: lastUser.id,
      label: lastUser.content || 'Screenshot',
      cwd: chatWorkingDir(resolved.chat, project?.path)
    })
    const withPoint = await getChat(chat.id)
    emitLive({ type: 'chat', chatId: chat.id, chat: withPoint })
  } catch {
    // turn still runs if checkpoint fails
  }

  try {
    const mode = normalizePermissionMode(resolved.chat.mode)
    await promptSession(
      resolved.sessionId,
      promptForMode(mode, promptForMentions(lastUser.content, lastUser.mentions)),
      lastUser.attachments ?? []
    )
    if (!isCurrentTurn(chat.id, gen)) return null
    const assembled = drafts.get(resolved.sessionId)?.trim() || '(empty response)'
    const latest = withLivePlan(await getChat(chat.id))
    latest.grokSessionId = resolved.sessionId
    latest.messages.push({
      id: id(),
      role: 'assistant',
      content: assembled,
      createdAt: now()
    })
    const saved = await saveChat(latest)
    finishTurn(chat.id, 'done')
    return saved
  } catch (error) {
    if (!isCurrentTurn(chat.id, gen)) return null
    const latest = withLivePlan(await getChat(chat.id))
    const assembled = drafts.get(resolved.sessionId)?.trim()
    if (assembled) {
      latest.messages.push({
        id: id(),
        role: 'assistant',
        content: assembled,
        createdAt: now()
      })
      const saved = await saveChat(latest)
      finishTurn(chat.id, 'done')
      return saved
    }
    if (error instanceof Error && /cancel/i.test(error.message)) {
      latest.messages.push({
        id: id(),
        role: 'assistant',
        content: '(stopped)',
        createdAt: now()
      })
      const saved = await saveChat(latest)
      finishTurn(chat.id, 'done')
      return saved
    }
    finishTurn(chat.id, 'error', error instanceof Error ? error.message : 'Grok request failed')
    throw error
  } finally {
    void finishCheckpoint(chat.id)
    if (isCurrentTurn(chat.id, gen)) inflight.delete(chat.id)
    drafts.delete(resolved.sessionId)
    deltaListeners.delete(resolved.sessionId)
  }
}
