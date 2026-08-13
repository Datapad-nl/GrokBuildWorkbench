import { homedir } from 'os'
import type { Attachment, Chat, Project } from '../shared/types'
import {
  cancelSession,
  contentText,
  ensureAgent,
  loadSession,
  newSession,
  onSessionUpdate,
  promptSession
} from './acp'
import { finishTurn, startTurn } from './activity'
import { id, now, titleFromPrompt } from './ids'
import { grokBuildSignedIn } from './sessions'
import { getApiKey, getChat, saveChat } from './store'

const inflight = new Map<string, { sessionId: string }>()
const drafts = new Map<string, string>()

onSessionUpdate((event) => {
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
  const active = inflight.get(chatId)
  if (!active) return false
  cancelSession(active.sessionId)
  return true
}

async function resolveSession(chat: Chat, project: Project | undefined): Promise<{ chat: Chat; sessionId: string }> {
  const cwd = project?.path || homedir()
  if (chat.grokSessionId) {
    try {
      await loadSession(chat.grokSessionId, cwd)
      return { chat, sessionId: chat.grokSessionId }
    } catch {
      // session may already be live in this agent; continue
      return { chat, sessionId: chat.grokSessionId }
    }
  }
  const sessionId = await newSession(cwd)
  chat.grokSessionId = sessionId
  const saved = await saveChat(chat)
  return { chat: saved, sessionId }
}

export async function appendUserMessage(
  chatId: string,
  content: string,
  attachments: Attachment[] = []
): Promise<Chat> {
  if (inflight.has(chatId)) {
    throw new Error('This chat is already generating')
  }
  const trimmed = content.trim()
  if (!trimmed && attachments.length === 0) throw new Error('Message is empty')

  const chat = await getChat(chatId)
  chat.messages.push({
    id: id(),
    role: 'user',
    content: trimmed,
    attachments: attachments.length > 0 ? attachments : undefined,
    createdAt: now()
  })
  if (chat.title === 'New chat') {
    chat.title = trimmed ? titleFromPrompt(trimmed) : 'Screenshot'
  }
  return saveChat(chat)
}

export async function streamAssistant(
  chat: Chat,
  project: Project | undefined,
  onDelta: (text: string) => void
): Promise<Chat> {
  if (inflight.has(chat.id)) {
    throw new Error('This chat is already generating')
  }
  if (!grokBuildSignedIn() && !(await getApiKey())) {
    throw new Error('Run `grok login` so Grok Build can pick up this chat.')
  }

  await ensureAgent()
  const resolved = await resolveSession(chat, project)
  const lastUser = [...resolved.chat.messages].reverse().find((message) => message.role === 'user')
  if (!lastUser) throw new Error('Message is empty')

  inflight.set(chat.id, { sessionId: resolved.sessionId })
  drafts.set(resolved.sessionId, '')
  deltaListeners.set(resolved.sessionId, onDelta)
  startTurn({
    chatId: resolved.chat.id,
    chatTitle: resolved.chat.title,
    sessionId: resolved.sessionId,
    prompt: lastUser.content || 'Screenshot'
  })

  try {
    await promptSession(resolved.sessionId, lastUser.content, lastUser.attachments ?? [])
    const assembled = drafts.get(resolved.sessionId)?.trim() || '(empty response)'
    const latest = await getChat(chat.id)
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
    const latest = await getChat(chat.id)
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
    inflight.delete(chat.id)
    drafts.delete(resolved.sessionId)
    deltaListeners.delete(resolved.sessionId)
  }
}
