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
  kind?: 'btw' | 'steer'
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
  markdown?: string
  awaitingApproval?: boolean
}

export type PlanVerdict = 'approve' | 'revise' | 'abandon'

export type PermissionRequest = {
  requestId: string
  chatId: string
  title: string
  detail: string | null
  toolKind: string | null
}

export type UserQuestionOption = {
  label: string
  description: string | null
  preview: string | null
}

export type UserQuestion = {
  question: string
  header: string | null
  multiSelect: boolean
  options: UserQuestionOption[]
}

export type UserQuestionRequest = {
  requestId: string
  chatId: string
  questions: UserQuestion[]
  title?: string | null
}

export type ProjectIntakeStatus = 'completed' | 'skipped'

export type ProjectIntakeAnswer = {
  question: string
  values: string[]
  source?: string | null
}

export type ProjectIntakeRound = {
  title: string
  answers: ProjectIntakeAnswer[]
}

export type ProjectIntake = {
  projectId: string
  status: ProjectIntakeStatus
  updatedAt: string
  rounds: ProjectIntakeRound[]
}

export type UserQuestionAnswer = string[]

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
  worktreePath?: string | null
  worktreeBranch?: string | null
}

export type ChatSummary = Omit<Chat, 'messages'> & {
  messageCount: number
}

export type VoiceSettings = {
  enabled: boolean
  speakReplies: boolean
  autoSend: boolean
  handsFree: boolean
  conversation: boolean
  voiceURI: string
  micDeviceId: string
  rate: number
}

export const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  speakReplies: true,
  autoSend: true,
  handsFree: false,
  conversation: false,
  voiceURI: 'M1',
  micDeviceId: '',
  rate: 1
}

const NEURAL_VOICE = /^(F|M)[1-5]$/

export type VoiceModelStatus = {
  ready: boolean
  downloading: boolean
  error: string | null
  file: string | null
  loadedBytes: number
  totalBytes: number
}

export type GrokChannel = 'stable' | 'alpha' | 'unknown'

export type GrokCliInfo = {
  path: string
  version: string | null
  channel: GrokChannel
  models: string[]
}

export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== 'string') return null
  const id = value.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (id === 'low' || id === 'medium' || id === 'high' || id === 'xhigh') return id
  if (id === 'extrahigh') return 'xhigh'
  return null
}

export function reasoningEffortLabel(effort: ReasoningEffort): string {
  if (effort === 'xhigh') return 'Extra high'
  return effort.slice(0, 1).toUpperCase() + effort.slice(1)
}

export type PublicSettings = {
  hasKey: boolean
  keyPreview: string | null
  model: string
  effort: ReasoningEffort | null
  keySource: 'grok-build' | 'env' | 'settings' | 'none'
  grokBuildSignedIn: boolean
  voice: VoiceSettings
  grokCli: GrokCliInfo
}

export function formatGrokCli(cli: GrokCliInfo): string {
  if (!cli.version) return 'CLI missing'
  const version = cli.version.replace(/^v/i, '')
  if (cli.channel === 'unknown') return `v${version}`
  return `v${version} ${cli.channel}`
}

export type UsagePeriodKind = 'weekly' | 'monthly' | 'unknown'

export type UsageSnapshot = {
  tier: string | null
  usedPercent: number | null
  period: UsagePeriodKind
  periodStart: string | null
  periodEnd: string | null
  prepaidBalance: number | null
  onDemandCap: number | null
  onDemandUsed: number | null
  unifiedBilling: boolean
}

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<VoiceSettings>) : {}
  const rate = typeof raw.rate === 'number' && Number.isFinite(raw.rate) ? raw.rate : DEFAULT_VOICE.rate
  return {
    enabled: Boolean(raw.enabled),
    speakReplies: raw.speakReplies !== false,
    autoSend: raw.autoSend !== false,
    handsFree: Boolean(raw.handsFree),
    conversation: Boolean(raw.conversation),
    voiceURI: typeof raw.voiceURI === 'string' && NEURAL_VOICE.test(raw.voiceURI) ? raw.voiceURI : DEFAULT_VOICE.voiceURI,
    micDeviceId: typeof raw.micDeviceId === 'string' ? raw.micDeviceId : '',
    rate: Math.min(2, Math.max(0.7, rate))
  }
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
  | { type: 'question'; chatId: string; request: UserQuestionRequest }
  | { type: 'question-clear'; chatId: string; requestId: string }
  | { type: 'chat'; chatId: string; chat: Chat }
  | { type: 'aside-delta'; chatId: string; messageId: string; text: string }
  | { type: 'aside-done'; chatId: string; chat: Chat }

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

export type BrowserAnnotationHit = {
  url: string
  title: string
  selector: string
  tag: string
  text: string
  html: string
  rect: { x: number; y: number; width: number; height: number }
  screenshotData: string
}

export const DEFAULT_MODEL = 'grok-4.6'

export type GitChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict'

export type GitFile = {
  path: string
  oldPath: string | null
  staged: GitChangeKind | null
  unstaged: GitChangeKind | null
}

export type GitGraphNode = {
  sha: string
  shortSha: string
  subject: string
  author: string
  date: string
  refs: string[]
  parents: string[]
  lane: number
  openLanes: number[]
  isHead: boolean
}

export type GitReason = 'ok' | 'no-folder' | 'not-a-repo' | 'error'

export type GitSnapshot = {
  projectId: string | null
  chatId: string | null
  path: string | null
  available: boolean
  reason: GitReason
  error: string | null
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  dirtyCount: number
  files: GitFile[]
  graph: GitGraphNode[]
}

export type GitSummary = {
  projectId: string
  available: boolean
  branch: string | null
  dirtyCount: number
}

export type GitDiffResult = {
  path: string
  oldText: string
  newText: string
  staged: boolean
}

export type GitActionResult = {
  ok: boolean
  error: string | null
  snapshot: GitSnapshot
}

export type KnowledgeReason = 'ok' | 'no-folder' | 'error'

export type KnowledgeNodeKind = 'home' | 'generated' | 'note'

export type KnowledgeNode = {
  id: string
  title: string
  kind: KnowledgeNodeKind
  path: string
  tags: string[]
}

export type KnowledgeEdge = {
  from: string
  to: string
}

export type KnowledgeSnapshot = {
  projectId: string | null
  path: string | null
  available: boolean
  reason: KnowledgeReason
  error: string | null
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

export type KnowledgeNote = {
  path: string
  title: string
  body: string
}
