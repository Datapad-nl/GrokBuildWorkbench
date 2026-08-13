import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type {
  Attachment,
  Chat,
  ChatEvent,
  ChatSummary,
  IndexEvent,
  OrientationCard,
  Project,
  ProjectIndex,
  PublicSettings,
  WorkspaceSnapshot
} from '../../shared/types'

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
  setShowNewProject: (open: boolean) => void
  setShowSettings: (open: boolean) => void
  setShowActivity: (open: boolean) => void
  selectProject: (projectId: string) => void
  openChat: (chatId: string) => Promise<void>
  closeTab: (chatId: string) => void
  createProject: (name: string, path: string | null) => Promise<void>
  pickFolder: () => Promise<string | null>
  deleteProject: (projectId: string) => Promise<void>
  indexProject: (projectId: string) => Promise<void>
  getOrientation: (projectId: string) => Promise<OrientationCard>
  createChat: (projectId: string) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>
  sendMessage: (chatId: string, content: string, attachments?: Attachment[]) => Promise<void>
  stopChat: (chatId: string) => Promise<void>
  saveSettings: (input: { apiKey?: string; model?: string }) => Promise<void>
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const emptyStream: StreamState = { status: 'idle', draft: '', error: null }

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
  const [showNewProject, setShowNewProject] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showActivity, setShowActivityState] = useState(() => {
    return localStorage.getItem('grokcode.showActivity') === '1'
  })
  const setShowActivity = useCallback((open: boolean) => {
    setShowActivityState(open)
    localStorage.setItem('grokcode.showActivity', open ? '1' : '0')
  }, [])

  const refresh = useCallback(async () => {
    const snapshot = await window.grokcode.getWorkspace()
    applySnapshot(snapshot, setProjects, setChats, setSettings, setIndexes)
    return snapshot
  }, [])

  useEffect(() => {
    void refresh().then((snapshot) => {
      setActiveProjectId((current) => current ?? snapshot.projects[0]?.id ?? null)
      setReady(true)
    })
  }, [refresh])

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

  const sendMessage = useCallback(
    async (chatId: string, content: string, attachments?: Attachment[]) => {
      setStreams((current) => ({
        ...current,
        [chatId]: { status: 'streaming', draft: '', error: null }
      }))
      try {
        const chat = await window.grokcode.sendMessage(chatId, content, attachments)
        setChatsById((current) => ({ ...current, [chatId]: chat }))
        await refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not send'
        setStreams((current) => ({
          ...current,
          [chatId]: { status: 'error', draft: '', error: message }
        }))
      }
    },
    [refresh]
  )

  const stopChat = useCallback(async (chatId: string) => {
    await window.grokcode.stopChat(chatId)
  }, [])

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
      setShowNewProject,
      setShowSettings,
      setShowActivity,
      selectProject,
      openChat,
      closeTab,
      createProject,
      pickFolder,
      deleteProject,
      indexProject,
      getOrientation,
      createChat,
      deleteChat,
      sendMessage,
      stopChat,
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
      setShowActivity,
      selectProject,
      openChat,
      closeTab,
      createProject,
      pickFolder,
      deleteProject,
      indexProject,
      getOrientation,
      createChat,
      deleteChat,
      sendMessage,
      stopChat,
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
