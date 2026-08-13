export type Project = {
  id: string
  name: string
  path: string | null
  color?: string
  createdAt: string
  updatedAt: string
}

export type Attachment = {
  id: string
  mimeType: string
  data: string
}

export type FileMention = {
  path: string
  kind: 'file' | 'folder'
}

export type FileHit = {
  path: string
  name: string
  kind: 'file' | 'folder'
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  mentions?: FileMention[]
  createdAt: string
}

export type PermissionMode = 'ask' | 'accept' | 'plan'

export type PlanEntry = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type ChatPlan = {
  title: string
  entries: PlanEntry[]
}

export type PermissionRequest = {
  requestId: string
  chatId: string
  title: string
  detail: string | null
  toolKind: string | null
}

export type Checkpoint = {
  id: string
  chatId: string
  messageId: string
  createdAt: string
  kind: 'git' | 'files'
  gitSha: string | null
  label: string
  files: string[]
}

export type Chat = {
  id: string
  projectId: string
  title: string
  grokSessionId: string | null
  createdAt: string
  updatedAt: string
  messages: Message[]
  mode?: PermissionMode
  plan?: ChatPlan | null
  checkpoints?: Checkpoint[]
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
  | { type: 'plan'; chatId: string; plan: ChatPlan }
  | { type: 'permission'; chatId: string; request: PermissionRequest }
  | { type: 'permission-clear'; chatId: string; requestId: string }
  | { type: 'chat'; chatId: string; chat: Chat }

export function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === 'ask' || value === 'accept' || value === 'plan') return value
  return 'accept'
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  if (mode === 'ask') return 'accept'
  if (mode === 'accept') return 'plan'
  return 'ask'
}

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
  color?: string
}

export type UpdateProjectInput = {
  id: string
  name?: string
  path?: string | null
  color?: string
}

export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserState = {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  visible: boolean
  error: string | null
}

export const DEFAULT_MODEL = 'grok-4.6'
