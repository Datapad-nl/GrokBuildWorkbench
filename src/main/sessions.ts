import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Message } from '../shared/types'
import { id, now } from './ids'

export type GrokSession = {
  id: string
  cwd: string
  title: string
  createdAt: string
  updatedAt: string
}

function sessionsRoot(): string {
  return join(homedir(), '.grok', 'sessions')
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: string }).text ?? '')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function visibleUserText(raw: string): string | null {
  const query = raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/)
  if (query?.[1]) return query[1].trim()
  if (
    raw.includes('<system-reminder>') ||
    raw.includes('<user_info>') ||
    raw.includes('<work_policy>') ||
    raw.includes('<agent_skills')
  ) {
    return null
  }
  const trimmed = raw.trim()
  return trimmed || null
}

export function grokBuildSignedIn(): boolean {
  try {
    const auth = readFileSync(join(homedir(), '.grok', 'auth.json'), 'utf8')
    return auth.trim().length > 2
  } catch {
    return false
  }
}

export function listGrokSessions(): GrokSession[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  const found: GrokSession[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = join(root, entry.name)
    for (const child of readdirSync(folder, { withFileTypes: true })) {
      if (!child.isDirectory()) continue
      const summaryPath = join(folder, child.name, 'summary.json')
      if (!existsSync(summaryPath)) continue
      try {
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
          info?: { id?: string; cwd?: string }
          session_summary?: string
          generated_title?: string
          created_at?: string
          updated_at?: string
        }
        const sessionId = summary.info?.id ?? child.name
        const cwd = summary.info?.cwd
        if (!cwd) continue
        found.push({
          id: sessionId,
          cwd,
          title: summary.generated_title || summary.session_summary || 'Grok session',
          createdAt: summary.created_at ?? now(),
          updatedAt: summary.updated_at ?? now()
        })
      } catch {
        // skip corrupt summaries
      }
    }
  }
  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readGrokHistory(sessionId: string, cwd: string): Message[] {
  const encoded = encodeURIComponent(cwd)
  const path = join(sessionsRoot(), encoded, sessionId, 'chat_history.jsonl')
  if (!existsSync(path)) return []
  const messages: Message[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let row: { type?: string; content?: unknown }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type === 'user') {
      const text = visibleUserText(extractText(row.content))
      if (!text) continue
      messages.push({ id: id(), role: 'user', content: text, createdAt: now() })
    }
    if (row.type === 'assistant') {
      const text = extractText(row.content).trim()
      if (!text) continue
      messages.push({ id: id(), role: 'assistant', content: text, createdAt: now() })
    }
  }
  return messages
}
