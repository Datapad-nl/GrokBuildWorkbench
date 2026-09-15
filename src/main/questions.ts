import type { UserQuestion, UserQuestionAnswer, UserQuestionRequest } from '../shared/types'
import { chatIdForSession, fallbackSessionId } from './permissions'

export type QuestionOutcome =
  | { type: 'Accepted'; partial_answers: Array<string | string[]> }
  | { type: 'SkipInterview' }

type PendingAsk = {
  request: UserQuestionRequest
  sessionId: string
  kind: 'ext' | 'elicitation'
  resolve: (outcome: QuestionOutcome) => void
}

const pending = new Map<string, PendingAsk>()
const promptListeners = new Set<(request: UserQuestionRequest) => void>()
const settleListeners = new Set<(request: UserQuestionRequest) => void>()

export function onUserQuestionPrompt(listener: (request: UserQuestionRequest) => void): () => void {
  promptListeners.add(listener)
  return () => {
    promptListeners.delete(listener)
  }
}

export function onUserQuestionSettled(listener: (request: UserQuestionRequest) => void): () => void {
  settleListeners.add(listener)
  return () => {
    settleListeners.delete(listener)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseOptions(value: unknown): UserQuestion['options'] {
  if (!Array.isArray(value)) return []
  const options: UserQuestion['options'] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      options.push({ label: item.trim(), description: null, preview: null })
      continue
    }
    const record = asRecord(item)
    if (!record) continue
    const label = asString(record.label) ?? asString(record.name) ?? asString(record.title)
    if (!label) continue
    options.push({
      label,
      description: asString(record.description),
      preview: asString(record.preview)
    })
  }
  return options
}

function parseQuestion(value: unknown): UserQuestion | null {
  const record = asRecord(value)
  if (!record) return null
  const question =
    asString(record.question) ?? asString(record.header) ?? asString(record.title) ?? asString(record.message)
  if (!question) return null
  const options = parseOptions(record.options ?? record.choices)
  const multiSelect = record.multiSelect === true || record.multi_select === true
  return {
    question,
    header: asString(record.header),
    multiSelect,
    options
  }
}

function parseElicitationQuestions(schema: unknown): UserQuestion[] {
  const record = asRecord(schema)
  const properties = asRecord(record?.properties)
  if (!properties) return []
  const questions: UserQuestion[] = []
  for (const [key, spec] of Object.entries(properties)) {
    const field = asRecord(spec)
    if (!field) continue
    const items = asRecord(field.items)
    const enums = Array.isArray(field.enum)
      ? field.enum
      : Array.isArray(items?.enum)
        ? items.enum
        : []
    const options = parseOptions(enums)
    const question = asString(field.title) ?? asString(field.description) ?? key
    questions.push({
      question,
      header: asString(field.title),
      multiSelect: field.type === 'array',
      options
    })
  }
  return questions
}

export function parseQuestions(params: unknown): UserQuestion[] | null {
  const record = asRecord(params)
  if (!record) return null
  const toolCall = asRecord(record.toolCall)
  const nested =
    record.questions ??
    asRecord(record.rawInput)?.questions ??
    asRecord(record.input)?.questions ??
    asRecord(record.params)?.questions ??
    asRecord(toolCall?.rawInput)?.questions
  if (Array.isArray(nested)) {
    const questions = nested.map(parseQuestion).filter((item): item is UserQuestion => Boolean(item))
    return questions.length > 0 ? questions : null
  }
  const fromSchema = parseElicitationQuestions(record.requestedSchema ?? record.schema)
  return fromSchema.length > 0 ? fromSchema : null
}

export function isUserQuestionMethod(method: string | undefined): boolean {
  if (!method) return false
  const name = method.toLowerCase()
  return (
    name === 'x.ai/ask_user_question' ||
    name === 'ask_user_question' ||
    name.endsWith('/ask_user_question')
  )
}

export function isElicitationMethod(method: string | undefined): boolean {
  return method === 'elicitation/create'
}

export function looksLikeUserQuestion(params: unknown): boolean {
  return parseQuestions(params) !== null
}

export function skipOutcome(): QuestionOutcome {
  return { type: 'SkipInterview' }
}

export function elicitationResult(
  outcome: QuestionOutcome,
  questions: UserQuestion[]
): { action: 'accept' | 'cancel'; content?: Record<string, string | string[]> } {
  if (outcome.type !== 'Accepted') return { action: 'cancel' }
  const content: Record<string, string | string[]> = {}
  for (let index = 0; index < questions.length; index += 1) {
    content[`q${index}`] = outcome.partial_answers[index] ?? ''
  }
  return { action: 'accept', content }
}

export function askUserQuestions(
  requestId: string,
  sessionId: string,
  questions: UserQuestion[],
  kind: PendingAsk['kind'] = 'ext',
  options?: { chatId?: string; title?: string | null }
): Promise<QuestionOutcome> {
  const chatId = options?.chatId || chatIdForSession(sessionId || fallbackSessionId())
  if (!chatId) return Promise.resolve(skipOutcome())

  const request: UserQuestionRequest = {
    requestId,
    chatId,
    questions,
    title: options?.title ?? null
  }

  return new Promise((resolve) => {
    pending.set(requestId, {
      request,
      sessionId,
      kind,
      resolve: (outcome) => {
        pending.delete(requestId)
        resolve(outcome)
        for (const listener of settleListeners) listener(request)
      }
    })
    for (const listener of promptListeners) listener(request)
  })
}

export function resolveUserQuestion(
  requestId: string,
  decision: { type: 'skip' } | { type: 'submit'; answers: UserQuestionAnswer[] }
): boolean {
  const item = pending.get(requestId)
  if (!item) return false
  if (decision.type === 'skip') {
    item.resolve(skipOutcome())
    return true
  }
  const answers = item.request.questions.map((itemQuestion, index) => {
    const picked = decision.answers[index] ?? []
    if (itemQuestion.multiSelect) return picked
    return picked[0] ?? ''
  })
  item.resolve({ type: 'Accepted', partial_answers: answers })
  return true
}

function cancelMatching(predicate: (item: PendingAsk) => boolean): void {
  for (const item of [...pending.values()]) {
    if (!predicate(item)) continue
    item.resolve(skipOutcome())
  }
}

export function cancelSessionQuestions(sessionId: string): void {
  cancelMatching((item) => item.sessionId === sessionId)
}

export function cancelChatQuestions(chatId: string): void {
  cancelMatching((item) => item.request.chatId === chatId)
}

export function cancelAllQuestions(): void {
  cancelMatching(() => true)
}
