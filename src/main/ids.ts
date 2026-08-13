import { randomUUID } from 'crypto'

export function id(): string {
  return randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}

export function titleFromPrompt(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return 'New chat'
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact
}
