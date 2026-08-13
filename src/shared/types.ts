export type Project = {
  id: string
  name: string
  path: string | null
  createdAt: string
  updatedAt: string
}

export type Attachment = {
  id: string
  mimeType: string
  data: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  createdAt: string
}

export type Chat = {
  id: string
  projectId: string
  title: string
  grokSessionId: string | null
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export type ChatSummary = Omit<Chat, 'messages'> & {
  messageCount: number
}

export type PublicSettings = {
  hasKey: boolean
  keyPreview: string | null
  model: string
  keySource: 'grok-build' | 'env' | 'settings' | 'none'
  grokBuildSignedIn: boolean
}

export type IndexState =
  | 'no-folder'
  | 'missing-cli'
  | 'installing'
  | 'not-indexed'
  | 'indexing'
  | 'indexed'
  | 'error'

export type ProjectIndex = {
  projectId: string
  state: IndexState
  error: string | null
  fileCount: number | null
  nodeCount: number | null
  languages: string[]
}

export type OrientationCard = {
  projectId: string
  name: string
  path: string | null
  stack: string | null
  summary: string | null
  rulesFile: string | null
  tree: string | null
  fileCount: number | null
  nodeCount: number | null
  languages: string[]
  state: IndexState
  error: string | null
}

export type IndexEvent = {
  type: 'status'
  projectId: string
  index: ProjectIndex
}

export type WorkspaceSnapshot = {
  projects: Project[]
  chats: ChatSummary[]
  settings: PublicSettings
  indexes: Record<string, ProjectIndex>
}

export type ChatEvent =
  | { type: 'delta'; chatId: string; text: string }
  | { type: 'done'; chatId: string; chat: Chat }
  | { type: 'error'; chatId: string; error: string }

export type ActivityKind = 'turn' | 'thought' | 'tool' | 'write' | 'plan' | 'permission' | 'error'

export type ActivityStatus = 'running' | 'done' | 'error'

export type ActivityDiff = {
  path: string
  oldText: string
  newText: string
}

export type ActivityEvent = {
  id: string
  at: string
  chatId: string | null
  chatTitle: string | null
  sessionId: string | null
  kind: ActivityKind
  title: string
  detail: string | null
  status: ActivityStatus | null
  toolKind?: string | null
  diffs?: ActivityDiff[]
  coalesceKey?: string
}

export type ActivityFeed =
  | { type: 'upsert'; event: ActivityEvent }
  | { type: 'reset'; events: ActivityEvent[] }

export type ActivitySnapshot = {
  events: ActivityEvent[]
}

export type CreateProjectInput = {
  name: string
  path?: string | null
}

export type UpdateProjectInput = {
  id: string
  name?: string
  path?: string | null
}

export const DEFAULT_MODEL = 'grok-4.6'
