import { app } from 'electron'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, normalize } from 'path'
import { normalizeHexColor, pickProjectColor } from '../shared/projectColor'
import { DEFAULT_THEME_ID } from '../shared/theme'
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  normalizeReasoningEffort,
  normalizeVoiceSettings,
  type Chat,
  type ChatSummary,
  type Project,
  type PublicSettings,
  type ReasoningEffort,
  type UpdateProjectInput,
  type VoiceSettings
} from '../shared/types'
import { isUnsafeProjectPath, queueIndex } from './codegraph'
import { id, now } from './ids'
import { getGrokCliInfo } from './grokCli'
import {
  findGrokSessionDir,
  grokBuildSignedIn,
  listGrokSessions,
  readGrokHistory,
  readGrokPlan
} from './sessions'

type SettingsFile = {
  apiKey: string
  model: string
  effort: ReasoningEffort | ''
  themeId: string
  voice: VoiceSettings
}

type StoreData = {
  projects: Project[]
}

const chatLocks = new Map<string, Promise<unknown>>()

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chatLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  chatLocks.set(
    key,
    previous.then(() => gate)
  )
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

function dataDir(): string {
  return join(app.getPath('userData'), 'grokcode')
}

function projectsPath(): string {
  return join(dataDir(), 'projects.json')
}

function dismissedPathsFile(): string {
  return join(dataDir(), 'dismissed-paths.json')
}

function normalizeProjectPath(value: string): string {
  const normalized = normalize(value.trim())
  return normalized.replace(/[/\\]+$/, '') || normalized
}

function settingsPath(): string {
  return join(dataDir(), 'settings.json')
}

function chatsDir(): string {
  return join(dataDir(), 'chats')
}

function chatPath(chatId: string): string {
  return join(chatsDir(), `${chatId}.json`)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

export async function ensureStore(): Promise<void> {
  await mkdir(chatsDir(), { recursive: true })
  const existing = await readJson<StoreData | null>(projectsPath(), null)
  if (!existing) {
    await writeJson(projectsPath(), { projects: [] } satisfies StoreData)
  }
  const settings = await readJson<SettingsFile | null>(settingsPath(), null)
  if (!settings) {
    await writeJson(settingsPath(), {
      apiKey: '',
      model: DEFAULT_MODEL,
      effort: '',
      themeId: DEFAULT_THEME_ID,
      voice: DEFAULT_VOICE
    } satisfies SettingsFile)
  }
  await mkdir(join(dataDir(), 'themes'), { recursive: true })
}

function withProjectColors(projects: Project[]): { projects: Project[]; changed: boolean } {
  let changed = false
  const taken: string[] = []
  const next = projects.map((project) => {
    const existing = normalizeHexColor(project.color)
    if (existing) {
      taken.push(existing)
      if (existing === project.color) return project
      changed = true
      return { ...project, color: existing }
    }
    const color = pickProjectColor(taken)
    taken.push(color)
    changed = true
    return { ...project, color }
  })
  return { projects: next, changed }
}

async function loadProjects(): Promise<Project[]> {
  const data = await readJson<StoreData>(projectsPath(), { projects: [] })
  const { projects, changed } = withProjectColors(data.projects)
  if (changed) await saveProjects(projects)
  return projects
}

async function saveProjects(projects: Project[]): Promise<void> {
  await writeJson(projectsPath(), { projects } satisfies StoreData)
}

async function loadDismissedPaths(): Promise<Set<string>> {
  const paths = await readJson<string[]>(dismissedPathsFile(), [])
  return new Set(paths.filter((item) => typeof item === 'string').map(normalizeProjectPath))
}

async function saveDismissedPaths(paths: Set<string>): Promise<void> {
  await writeJson(dismissedPathsFile(), [...paths])
}

async function dismissProjectPath(path: string | null | undefined): Promise<void> {
  if (!path?.trim()) return
  const dismissed = await loadDismissedPaths()
  dismissed.add(normalizeProjectPath(path))
  await saveDismissedPaths(dismissed)
}

async function rememberProjectPath(path: string | null | undefined): Promise<void> {
  if (!path?.trim()) return
  const dismissed = await loadDismissedPaths()
  if (!dismissed.delete(normalizeProjectPath(path))) return
  await saveDismissedPaths(dismissed)
}

async function loadSettingsFile(): Promise<SettingsFile> {
  const file = await readJson<Partial<SettingsFile>>(settingsPath(), {})
  return {
    apiKey: file.apiKey ?? '',
    model: file.model || DEFAULT_MODEL,
    effort: normalizeReasoningEffort(file.effort) ?? '',
    themeId: file.themeId || DEFAULT_THEME_ID,
    voice: normalizeVoiceSettings(file.voice)
  }
}

export async function getThemeId(): Promise<string> {
  const file = await loadSettingsFile()
  return file.themeId || DEFAULT_THEME_ID
}

export async function setThemeId(themeId: string): Promise<void> {
  const current = await loadSettingsFile()
  await writeJson(settingsPath(), {
    ...current,
    themeId: themeId || DEFAULT_THEME_ID,
    voice: normalizeVoiceSettings(current.voice)
  } satisfies SettingsFile)
}

function maskKey(key: string): string {
  if (key.length < 8) return '••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const envKey = process.env.XAI_API_KEY?.trim() ?? ''
  const file = await loadSettingsFile()
  const stored = file.apiKey.trim()
  const signedIn = grokBuildSignedIn()
  const model = file.model || DEFAULT_MODEL
  const effort = file.effort || null
  const voice = file.voice
  const grokCli = await getGrokCliInfo()
  if (signedIn) {
    return {
      hasKey: true,
      keyPreview: 'Grok Build',
      model,
      effort,
      keySource: 'grok-build',
      grokBuildSignedIn: true,
      voice,
      grokCli
    }
  }
  if (envKey) {
    return {
      hasKey: true,
      keyPreview: maskKey(envKey),
      model,
      effort,
      keySource: 'env',
      grokBuildSignedIn: false,
      voice,
      grokCli
    }
  }
  if (stored) {
    return {
      hasKey: true,
      keyPreview: maskKey(stored),
      model,
      effort,
      keySource: 'settings',
      grokBuildSignedIn: false,
      voice,
      grokCli
    }
  }
  return {
    hasKey: false,
    keyPreview: null,
    model,
    effort,
    keySource: 'none',
    grokBuildSignedIn: false,
    voice,
    grokCli
  }
}

export async function getApiKey(): Promise<string | null> {
  const envKey = process.env.XAI_API_KEY?.trim()
  if (envKey) return envKey
  const file = await loadSettingsFile()
  return file.apiKey.trim() || null
}

export async function getModel(): Promise<string> {
  const file = await loadSettingsFile()
  return file.model || DEFAULT_MODEL
}

export async function getEffort(): Promise<ReasoningEffort | null> {
  const file = await loadSettingsFile()
  return file.effort || null
}

export async function updateSettings(input: {
  apiKey?: string
  model?: string
  effort?: string | null
  voice?: Partial<VoiceSettings>
}): Promise<PublicSettings> {
  const current = await loadSettingsFile()
  await writeJson(settingsPath(), {
    apiKey: input.apiKey !== undefined ? input.apiKey.trim() : current.apiKey,
    model: input.model?.trim() || current.model || DEFAULT_MODEL,
    effort:
      input.effort !== undefined ? (normalizeReasoningEffort(input.effort) ?? '') : current.effort,
    themeId: current.themeId || DEFAULT_THEME_ID,
    voice: normalizeVoiceSettings({ ...current.voice, ...input.voice })
  } satisfies SettingsFile)
  return getPublicSettings()
}

export async function listProjects(): Promise<Project[]> {
  const projects = await loadProjects()
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createProject(name: string, path: string | null, color?: string): Promise<Project> {
  if (path && isUnsafeProjectPath(path)) {
    throw new Error('Choose a project folder, not your home directory or a whole disk.')
  }
  await rememberProjectPath(path)
  const projects = await loadProjects()
  const timestamp = now()
  const project: Project = {
    id: id(),
    name: name.trim() || 'Untitled project',
    path,
    color: normalizeHexColor(color) ?? pickProjectColor(projects.map((item) => item.color)),
    createdAt: timestamp,
    updatedAt: timestamp
  }
  projects.unshift(project)
  await saveProjects(projects)
  queueIndex(project.id, project.path)
  return project
}

export async function updateProject(input: UpdateProjectInput): Promise<Project> {
  const projects = await loadProjects()
  const index = projects.findIndex((project) => project.id === input.id)
  if (index === -1) throw new Error('Project not found')
  const current = projects[index]
  const nextName = input.name !== undefined ? input.name.trim() || current.name : current.name
  const nextPath = input.path !== undefined ? input.path : current.path
  if (nextPath && isUnsafeProjectPath(nextPath)) {
    throw new Error('Choose a project folder, not your home directory or a whole disk.')
  }
  const nextColor =
    input.color !== undefined ? (normalizeHexColor(input.color) ?? current.color) : current.color
  const renamed = nextName !== current.name
  const moved = nextPath !== current.path
  const next: Project = {
    ...current,
    name: nextName,
    path: nextPath,
    color: nextColor,
    updatedAt: renamed || moved ? now() : current.updatedAt
  }
  projects[index] = next
  if (moved) {
    if (current.path) await dismissProjectPath(current.path)
    if (next.path) await rememberProjectPath(next.path)
  }
  await saveProjects(projects)
  if (next.path && next.path !== current.path) {
    queueIndex(next.id, next.path)
  }
  return next
}

export async function purgeUnsafeProjects(): Promise<void> {
  const projects = await loadProjects()
  const bad = projects.filter((project) => project.path && isUnsafeProjectPath(project.path))
  for (const project of bad) {
    await deleteProject(project.id)
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const projects = await loadProjects()
  const project = projects.find((item) => item.id === projectId)
  await dismissProjectPath(project?.path)
  await saveProjects(projects.filter((item) => item.id !== projectId))
  const chats = await listChats()
  await Promise.all(
    chats.filter((chat) => chat.projectId === projectId).map((chat) => deleteChat(chat.id))
  )
}

async function readChat(chatId: string): Promise<Chat | null> {
  return readJson<Chat | null>(chatPath(chatId), null)
}

export async function chatMediaRoots(chatId: string): Promise<string[]> {
  const chat = await readChat(chatId)
  if (!chat) return []
  const roots: string[] = []
  if (chat.worktreePath) roots.push(chat.worktreePath)
  const project = (await loadProjects()).find((item) => item.id === chat.projectId)
  if (project?.path) roots.push(project.path)
  if (chat.grokSessionId) {
    const dir = findGrokSessionDir(chat.grokSessionId)
    if (dir) roots.push(dir)
  }
  return roots
}

export async function getChat(chatId: string): Promise<Chat> {
  const chat = await readChat(chatId)
  if (!chat) throw new Error('Chat not found')
  if (chat.messages.length === 0 && chat.grokSessionId) {
    const project = (await loadProjects()).find((item) => item.id === chat.projectId)
    const cwd = chat.worktreePath || project?.path
    if (cwd) {
      chat.messages = readGrokHistory(chat.grokSessionId, cwd)
    }
  }
  if (chat.grokSessionId) {
    const disk = readGrokPlan(chat.grokSessionId)
    if (disk?.awaitingApproval) {
      const markdown = chat.plan?.markdown || disk.markdown
      const entries = chat.plan?.entries?.length ? chat.plan.entries : disk.plan.entries
      chat.plan = {
        title:
          chat.plan?.title && chat.plan.title !== 'Plan' && chat.plan.title !== 'No plan written yet'
            ? chat.plan.title
            : disk.plan.title,
        entries,
        markdown,
        awaitingApproval: chat.plan?.awaitingApproval === false ? false : true
      }
    } else if (chat.plan?.awaitingApproval && !disk?.awaitingApproval) {
      chat.plan = { ...chat.plan, awaitingApproval: false }
    }
  }
  return {
    ...chat,
    grokSessionId: chat.grokSessionId ?? null
  }
}

export async function listChats(): Promise<ChatSummary[]> {
  await mkdir(chatsDir(), { recursive: true })
  const files = await readdir(chatsDir())
  const chats: ChatSummary[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const chat = await readJson<Chat | null>(join(chatsDir(), file), null)
    if (!chat) continue
    chats.push({
      id: chat.id,
      projectId: chat.projectId,
      title: chat.title,
      grokSessionId: chat.grokSessionId ?? null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: chat.messages.length,
      worktreePath: chat.worktreePath ?? null,
      worktreeBranch: chat.worktreeBranch ?? null
    })
  }
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createChat(
  projectId: string,
  input?: { id?: string; title?: string; grokSessionId?: string | null; messages?: Chat['messages'] }
): Promise<Chat> {
  const projects = await loadProjects()
  if (!projects.some((project) => project.id === projectId)) {
    throw new Error('Project not found')
  }
  const timestamp = now()
  const chatId = input?.id ?? id()
  const chat: Chat = {
    id: chatId,
    projectId,
    title: input?.title ?? 'New chat',
    grokSessionId: input?.grokSessionId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: input?.messages ?? []
  }
  await writeJson(chatPath(chat.id), chat)
  await touchProject(projectId)
  return chat
}

export async function syncGrokSessions(): Promise<void> {
  const sessions = listGrokSessions()
  if (sessions.length === 0) return
  const projects = await loadProjects()
  const chats = await listChats()
  const known = new Set(chats.map((chat) => chat.grokSessionId).filter(Boolean))
  const dismissed = await loadDismissedPaths()

  for (const session of sessions) {
    if (known.has(session.id)) continue
    const cwd = normalizeProjectPath(session.cwd)
    if (isUnsafeProjectPath(cwd)) continue
    let project = projects.find((item) => item.path && normalizeProjectPath(item.path) === cwd)
    if (!project) {
      if (dismissed.has(cwd)) continue
      const name = session.cwd.split(/[/\\]/).filter(Boolean).at(-1) || 'Project'
      project = await createProject(name, session.cwd)
      projects.unshift(project)
    }
    await createChat(project.id, {
      id: session.id,
      title: session.title,
      grokSessionId: session.id
    })
    known.add(session.id)
  }
}

export async function saveChat(chat: Chat): Promise<Chat> {
  return withLock(chat.id, async () => {
    const next = { ...chat, updatedAt: now() }
    await writeJson(chatPath(chat.id), next)
    await touchProject(chat.projectId)
    return next
  })
}

export async function mutateChat(chatId: string, fn: (chat: Chat) => void): Promise<Chat> {
  return withLock(chatId, async () => {
    const chat = await readChat(chatId)
    if (!chat) throw new Error('Chat not found')
    fn(chat)
    const next = { ...chat, updatedAt: now() }
    await writeJson(chatPath(chatId), next)
    await touchProject(next.projectId)
    return next
  })
}

export async function deleteChat(chatId: string): Promise<void> {
  await withLock(chatId, async () => {
    await rm(chatPath(chatId), { force: true })
  })
}

export async function renameChat(chatId: string, title: string): Promise<Chat> {
  const chat = await getChat(chatId)
  chat.title = title.trim() || chat.title
  return saveChat(chat)
}

async function touchProject(projectId: string): Promise<void> {
  const projects = await loadProjects()
  const index = projects.findIndex((project) => project.id === projectId)
  if (index === -1) return
  projects[index] = { ...projects[index], updatedAt: now() }
  await saveProjects(projects)
}

export async function snapshot(): Promise<{ projects: Project[]; chats: ChatSummary[]; settings: PublicSettings }> {
  await syncGrokSessions()
  const [projects, chats, settings] = await Promise.all([listProjects(), listChats(), getPublicSettings()])
  return { projects, chats, settings }
}
