import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  Attachment,
  Chat,
  ChatEvent,
  ChatSummary,
  FileMention,
  GitSummary,
  IndexEvent,
  OrientationCard,
  PermissionMode,
  PermissionRequest,
  Project,
  ProjectIndex,
  PublicSettings,
  UpdateProjectInput,
  WorkspaceSnapshot
} from '../../shared/types'
import { normalizePermissionMode } from '../../shared/types'

type StreamState = {
  status: 'idle' | 'streaming' | 'error'
  draft: string
  error: string | null
}

type WorkspaceContextValue = {
  ready: boolean
  projects: Project[]
  chats: ChatSummary[]
  settings: PublicSettings | null
  indexes: Record<string, ProjectIndex>
  openChatIds: string[]
  activeChatId: string | null
  activeProjectId: string | null
  chatsById: Record<string, Chat>
  streams: Record<string, StreamState>
  showNewProject: boolean
  showSettings: boolean
  showActivity: boolean
  showBrowser: boolean
  showGit: boolean
  gitSummaries: Record<string, GitSummary>
  rightPaneOrder: RightPaneId[]
  setShowNewProject: (open: boolean) => void
  setShowSettings: (open: boolean) => void
  setShowActivity: (open: boolean) => void
  setShowBrowser: (open: boolean) => void
  setShowGit: (open: boolean) => void
  swapRightPanes: () => void
  selectProject: (projectId: string) => void
  openChat: (chatId: string) => Promise<void>
  closeTab: (chatId: string) => void
  createProject: (name: string, path: string | null) => Promise<void>
  updateProject: (input: UpdateProjectInput) => Promise<void>
  pickFolder: () => Promise<string | null>
  deleteProject: (projectId: string) => Promise<void>
  indexProject: (projectId: string) => Promise<void>
  getOrientation: (projectId: string) => Promise<OrientationCard>
  createChat: (projectId: string) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>
  renameChat: (chatId: string, title: string) => Promise<void>
  sendMessage: (
    chatId: string,
    content: string,
    attachments?: Attachment[],
    mentions?: FileMention[]
  ) => Promise<void>
  stopChat: (chatId: string) => Promise<void>
  setChatMode: (chatId: string, mode: PermissionMode) => Promise<void>
  approvePlan: (chatId: string) => Promise<void>
  resolvePermission: (requestId: string, decision: 'allow' | 'deny') => Promise<void>
  rewindChat: (chatId: string, checkpointId: string) => Promise<void>
  permissions: Record<string, PermissionRequest>
  saveSettings: (input: { apiKey?: string; model?: string }) => Promise<void>
  refresh: () => Promise<WorkspaceSnapshot>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const emptyStream: StreamState = { status: 'idle', draft: '', error: null }

export type RightPaneId = 'git' | 'browser' | 'activity'

const SESSION_KEY = 'grokcode.session'
const PANE_ORDER_KEY = 'grokcode.rightPaneOrder'
const DEFAULT_PANE_ORDER: RightPaneId[] = ['git', 'browser', 'activity']

function isPaneId(value: string): value is RightPaneId {
  return value === 'git' || value === 'browser' || value === 'activity'
}

function readPaneOrder(): RightPaneId[] {
  try {
    const raw = localStorage.getItem(PANE_ORDER_KEY)
    if (!raw) return DEFAULT_PANE_ORDER
    const parsed = raw.split(',').filter(isPaneId)
    const missing = DEFAULT_PANE_ORDER.filter((id) => !parsed.includes(id))
    return parsed.length > 0 ? [...parsed, ...missing] : DEFAULT_PANE_ORDER
  } catch {
    return DEFAULT_PANE_ORDER
  }
}

type UiSession = {
  openChatIds: string[]
  activeChatId: string | null
  activeProjectId: string | null
}

function readSession(): UiSession {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '') as Partial<UiSession>
    return {
      openChatIds: Array.isArray(parsed.openChatIds)
        ? parsed.openChatIds.filter((id): id is string => typeof id === 'string')
        : [],
      activeChatId: typeof parsed.activeChatId === 'string' ? parsed.activeChatId : null,
      activeProjectId: typeof parsed.activeProjectId === 'string' ? parsed.activeProjectId : null
    }
  } catch {
    return { openChatIds: [], activeChatId: null, activeProjectId: null }
  }
}

function applySnapshot(
  snapshot: WorkspaceSnapshot,
  setProjects: (projects: Project[]) => void,
  setChats: (chats: ChatSummary[]) => void,
  setSettings: (settings: PublicSettings) => void,
  setIndexes: (indexes: Record<string, ProjectIndex>) => void
): void {
  setProjects(snapshot.projects)
  setChats(snapshot.chats)
  setSettings(snapshot.settings)
  setIndexes(snapshot.indexes ?? {})
}

export function WorkspaceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [indexes, setIndexes] = useState<Record<string, ProjectIndex>>({})
  const [openChatIds, setOpenChatIds] = useState<string[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [chatsById, setChatsById] = useState<Record<string, Chat>>({})
  const [streams, setStreams] = useState<Record<string, StreamState>>({})
  const sending = useRef(new Set<string>())
  const [permissions, setPermissions] = useState<Record<string, PermissionRequest>>({})
  const [showNewProject, setShowNewProject] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showActivity, setShowActivityState] = useState(() => {
    return localStorage.getItem('grokcode.showActivity') === '1'
  })
  const setShowActivity = useCallback((open: boolean) => {
    setShowActivityState(open)
    localStorage.setItem('grokcode.showActivity', open ? '1' : '0')
  }, [])
  const [showBrowser, setShowBrowserState] = useState(() => {
    return localStorage.getItem('grokcode.showBrowser') === '1'
  })
  const setShowBrowser = useCallback((open: boolean) => {
    setShowBrowserState(open)
    localStorage.setItem('grokcode.showBrowser', open ? '1' : '0')
  }, [])
  const [showGit, setShowGitState] = useState(() => {
    return localStorage.getItem('grokcode.showGit') === '1'
  })
  const setShowGit = useCallback((open: boolean) => {
    setShowGitState(open)
    localStorage.setItem('grokcode.showGit', open ? '1' : '0')
  }, [])
  const [gitSummaries, setGitSummaries] = useState<Record<string, GitSummary>>({})
  const [rightPaneOrder, setRightPaneOrder] = useState<RightPaneId[]>(readPaneOrder)
  const swapRightPanes = useCallback(() => {
    setRightPaneOrder((current) => {
      const next = [...current.slice(1), current[0]]
      localStorage.setItem(PANE_ORDER_KEY, next.join(','))
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    const snapshot = (await window.grokcode.getWorkspace()) as WorkspaceSnapshot
    applySnapshot(snapshot, setProjects, setChats, setSettings, setIndexes)
    return snapshot
  }, [])

  useEffect(
    () => window.grokcode.onBrowserRequestShow?.(() => setShowBrowser(true)),
    [setShowBrowser]
  )

  useEffect(() => {
    void window.grokcode.getGitSummaries().then(setGitSummaries)
    return window.grokcode.onGitSummaries(setGitSummaries)
  }, [])

  useEffect(() => {
    void (async () => {
      const snapshot = await refresh()
      const session = readSession()
      const projectIds = new Set(snapshot.projects.map((project) => project.id))
      const chatById = new Map(snapshot.chats.map((chat) => [chat.id, chat] as const))
      const open = session.openChatIds.filter((id) => chatById.has(id))
      const activeChat =
        (session.activeChatId && open.includes(session.activeChatId) && session.activeChatId) ||
        open.at(-1) ||
        null
      const restoredChat = activeChat ? chatById.get(activeChat) : undefined
      const activeProject =
        (session.activeProjectId && projectIds.has(session.activeProjectId) && session.activeProjectId) ||
        restoredChat?.projectId ||
        snapshot.projects[0]?.id ||
        null

      if (open.length > 0) {
        const loaded = await Promise.all(open.map((id) => window.grokcode.getChat(id)))
        setChatsById((current) => {
          const next = { ...current }
          for (const chat of loaded) next[chat.id] = chat
          return next
        })
        setOpenChatIds(open)
        setActiveChatId(activeChat)
      }
      setActiveProjectId(activeProject)
      setReady(true)
    })()
  }, [refresh])

  useEffect(() => {
    if (!ready) return
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        openChatIds,
        activeChatId,
        activeProjectId
      } satisfies UiSession)
    )
  }, [ready, openChatIds, activeChatId, activeProjectId])

  useEffect(() => {
    return window.grokcode.onIndexEvent((event: IndexEvent) => {
      setIndexes((current) => ({ ...current, [event.projectId]: event.index }))
    })
  }, [])

  useEffect(() => {
    return window.grokcode.onChatEvent((event: ChatEvent) => {
      if (event.type === 'delta') {
        setStreams((current) => {
          const prev = current[event.chatId] ?? emptyStream
          return {
            ...current,
            [event.chatId]: {
              status: 'streaming',
              draft: prev.draft + event.text,
              error: null
            }
          }
        })
        return
      }
      if (event.type === 'done') {
        setChatsById((current) => ({ ...current, [event.chatId]: event.chat }))
        setStreams((current) => ({
          ...current,
          [event.chatId]: emptyStream
        }))
        void refresh()
        return
      }
      if (event.type === 'plan') {
        setChatsById((current) => {
          const chat = current[event.chatId]
          if (!chat) return current
          return { ...current, [event.chatId]: { ...chat, plan: event.plan } }
        })
        return
      }
      if (event.type === 'permission') {
        setPermissions((current) => ({ ...current, [event.chatId]: event.request }))
        return
      }
      if (event.type === 'permission-clear') {
        setPermissions((current) => {
          const existing = current[event.chatId]
          if (!existing || existing.requestId !== event.requestId) return current
          const next = { ...current }
          delete next[event.chatId]
          return next
        })
        return
      }
      if (event.type === 'chat') {
        setChatsById((current) => ({ ...current, [event.chatId]: event.chat }))
        setChats((current) =>
          current.map((item) =>
            item.id === event.chatId
              ? {
                  ...item,
                  worktreePath: event.chat.worktreePath ?? null,
                  worktreeBranch: event.chat.worktreeBranch ?? null
                }
              : item
          )
        )
        setStreams((current) => {
          if (!current[event.chatId] || current[event.chatId].status !== 'streaming') {
            return { ...current, [event.chatId]: emptyStream }
          }
          return current
        })
        return
      }
      setStreams((current) => ({
        ...current,
        [event.chatId]: {
          status: 'error',
          draft: current[event.chatId]?.draft ?? '',
          error: event.error
        }
      }))
    })
  }, [refresh])

  const openChat = useCallback(async (chatId: string) => {
    const chat = chatsById[chatId] ?? (await window.grokcode.getChat(chatId))
    setChatsById((current) => ({ ...current, [chatId]: chat }))
    setActiveChatId(chatId)
    setActiveProjectId(chat.projectId)
    setOpenChatIds((current) => (current.includes(chatId) ? current : [...current, chatId]))
  }, [chatsById])

  const closeTab = useCallback((chatId: string) => {
    setOpenChatIds((current) => {
      const next = current.filter((id) => id !== chatId)
      setActiveChatId((active) => {
        if (active !== chatId) return active
        return next.at(-1) ?? null
      })
      return next
    })
  }, [])

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
  }, [])

  const createProject = useCallback(
    async (name: string, path: string | null) => {
      const { project, chat } = await window.grokcode.createProject({ name, path })
      await refresh()
      setActiveProjectId(project.id)
      setChatsById((current) => ({ ...current, [chat.id]: chat }))
      setOpenChatIds((current) => [...current, chat.id])
      setActiveChatId(chat.id)
      setShowNewProject(false)
    },
    [refresh]
  )

  const updateProject = useCallback(async (input: UpdateProjectInput) => {
    const project = await window.grokcode.updateProject(input)
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)))
  }, [])

  const pickFolder = useCallback(async () => {
    return window.grokcode.pickFolder()
  }, [])

  const indexProject = useCallback(async (projectId: string) => {
    await window.grokcode.indexProject(projectId)
  }, [])

  const getOrientation = useCallback(async (projectId: string) => {
    return window.grokcode.getOrientation(projectId)
  }, [])

  const deleteProject = useCallback(
    async (projectId: string) => {
      const removed = chats.filter((chat) => chat.projectId === projectId).map((chat) => chat.id)
      await window.grokcode.deleteProject(projectId)
      setOpenChatIds((current) => current.filter((id) => !removed.includes(id)))
      setChatsById((current) => {
        const next = { ...current }
        for (const id of removed) delete next[id]
        return next
      })
      const snapshot = await refresh()
      const nextProject = snapshot.projects[0]?.id ?? null
      setActiveProjectId(nextProject)
      setActiveChatId((active) => (active && removed.includes(active) ? null : active))
    },
    [chats, refresh]
  )

  const createChat = useCallback(
    async (projectId: string) => {
      const chat = await window.grokcode.createChat(projectId)
      await refresh()
      setChatsById((current) => ({ ...current, [chat.id]: chat }))
      setOpenChatIds((current) => [...current, chat.id])
      setActiveChatId(chat.id)
      setActiveProjectId(projectId)
    },
    [refresh]
  )

  const deleteChat = useCallback(
    async (chatId: string) => {
      await window.grokcode.deleteChat(chatId)
      closeTab(chatId)
      setChatsById((current) => {
        const next = { ...current }
        delete next[chatId]
        return next
      })
      await refresh()
    },
    [closeTab, refresh]
  )

  const renameChat = useCallback(async (chatId: string, title: string) => {
    const chat = await window.grokcode.renameChat(chatId, title)
    setChatsById((current) => ({ ...current, [chatId]: chat }))
    setChats((current) => current.map((item) => (item.id === chatId ? { ...item, title: chat.title } : item)))
  }, [])

  const sendMessage = useCallback(
    async (chatId: string, content: string, attachments?: Attachment[], mentions?: FileMention[]) => {
      if (sending.current.has(chatId)) return
      sending.current.add(chatId)
      setStreams((current) => ({
        ...current,
        [chatId]: { status: 'streaming', draft: '', error: null }
      }))
      try {
        const chat = await window.grokcode.sendMessage(chatId, content, attachments, mentions)
        setChatsById((current) => ({ ...current, [chatId]: chat }))
        await refresh()
      } catch (error) {
        const raw = error instanceof Error ? error.message : 'Could not send'
        const message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
        setStreams((current) => ({
          ...current,
          [chatId]: { status: 'error', draft: '', error: message }
        }))
      } finally {
        sending.current.delete(chatId)
      }
    },
    [refresh]
  )

  const stopChat = useCallback(async (chatId: string) => {
    await window.grokcode.stopChat(chatId)
    setPermissions((current) => {
      if (!current[chatId]) return current
      const next = { ...current }
      delete next[chatId]
      return next
    })
  }, [])

  const setChatMode = useCallback(async (chatId: string, mode: PermissionMode) => {
    const next = normalizePermissionMode(mode)
    const chat = await window.grokcode.setChatMode(chatId, next)
    setChatsById((current) => ({ ...current, [chatId]: chat }))
    setChats((current) =>
      current.map((item) => (item.id === chatId ? { ...item, mode: chat.mode } : item))
    )
  }, [])

  const approvePlan = useCallback(
    async (chatId: string) => {
      if (sending.current.has(chatId)) return
      await stopChat(chatId)
      await setChatMode(chatId, 'accept')
      await sendMessage(chatId, 'Implement the approved plan. Start now.')
    },
    [sendMessage, setChatMode, stopChat]
  )

  const resolvePermission = useCallback(async (requestId: string, decision: 'allow' | 'deny') => {
    await window.grokcode.resolvePermission(requestId, decision)
  }, [])

  const rewindChat = useCallback(async (chatId: string, checkpointId: string) => {
    const chat = await window.grokcode.rewindChat(chatId, checkpointId)
    setChatsById((current) => ({ ...current, [chatId]: chat }))
    setStreams((current) => ({ ...current, [chatId]: emptyStream }))
    setPermissions((current) => {
      if (!current[chatId]) return current
      const next = { ...current }
      delete next[chatId]
      return next
    })
    await refresh()
  }, [refresh])

  const saveSettings = useCallback(async (input: { apiKey?: string; model?: string }) => {
    const next = await window.grokcode.setSettings(input)
    setSettings(next)
  }, [])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ready,
      projects,
      chats,
      settings,
      indexes,
      openChatIds,
      activeChatId,
      activeProjectId,
      chatsById,
      streams,
      showNewProject,
      showSettings,
      showActivity,
      showBrowser,
      showGit,
      gitSummaries,
      rightPaneOrder,
      setShowNewProject,
      setShowSettings,
      setShowActivity,
      setShowBrowser,
      setShowGit,
      swapRightPanes,
      selectProject,
      openChat,
      closeTab,
      createProject,
      updateProject,
      pickFolder,
      deleteProject,
      indexProject,
      getOrientation,
      createChat,
      deleteChat,
      renameChat,
      sendMessage,
      stopChat,
      setChatMode,
      approvePlan,
      resolvePermission,
      rewindChat,
      permissions,
      saveSettings,
      refresh
    }),
    [
      ready,
      projects,
      chats,
      settings,
      indexes,
      openChatIds,
      activeChatId,
      activeProjectId,
      chatsById,
      streams,
      showNewProject,
      showSettings,
      showActivity,
      showBrowser,
      showGit,
      gitSummaries,
      rightPaneOrder,
      setShowActivity,
      setShowBrowser,
      setShowGit,
      swapRightPanes,
      selectProject,
      openChat,
      closeTab,
      createProject,
      updateProject,
      pickFolder,
      deleteProject,
      indexProject,
      getOrientation,
      createChat,
      deleteChat,
      renameChat,
      sendMessage,
      stopChat,
      setChatMode,
      approvePlan,
      resolvePermission,
      rewindChat,
      permissions,
      saveSettings,
      refresh
    ]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}
