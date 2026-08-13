import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../workspace'
import { IndexStatus } from './OrientationCard'

const WIDTH_KEY = 'grokcode.sidebarWidth'
const COLLAPSED_KEY = 'grokcode.collapsedProjects'
const DEFAULT_WIDTH = 268
const MIN_WIDTH = 180
const MAX_WIDTH = 520

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  if (!Number.isFinite(raw)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw))
}

function readCollapsed(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function ActivityToggle(): React.JSX.Element {
  const { showActivity, setShowActivity } = useWorkspace()

  return (
    <button
      data-testid="open-activity"
      className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[10px] hover:bg-raised hover:text-ink ${
        showActivity ? 'text-ink' : 'text-muted'
      }`}
      onClick={() => setShowActivity(!showActivity)}
    >
      <span>Thought process</span>
      <span>{showActivity ? 'Hide' : 'Show'}</span>
    </button>
  )
}

export function Sidebar(): React.JSX.Element {
  const {
    projects,
    chats,
    activeProjectId,
    activeChatId,
    streams,
    settings,
    selectProject,
    openChat,
    createChat,
    deleteChat,
    deleteProject,
    setShowNewProject,
    setShowSettings
  } = useWorkspace()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)
  const [width, setWidth] = useState(readWidth)

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width))
  }, [width])

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed))
  }, [collapsed])

  function toggleProject(projectId: string): void {
    setCollapsed((current) => ({ ...current, [projectId]: !current[projectId] }))
  }

  function expandProject(projectId: string): void {
    setCollapsed((current) => {
      if (!current[projectId]) return current
      return { ...current, [projectId]: false }
    })
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    function onMove(move: PointerEvent): void {
      const next = startWidth + (move.clientX - startX)
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)))
    }

    function onUp(): void {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }

    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const chatsByProject = useMemo(() => {
    const grouped: Record<string, typeof chats> = {}
    for (const chat of chats) {
      grouped[chat.projectId] ??= []
      grouped[chat.projectId].push(chat)
    }
    return grouped
  }, [chats])

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-sidebar"
      style={{ width }}
    >
      <div className="drag h-[52px] shrink-0" />
      <div className="no-drag flex items-center justify-between px-3 pb-3">
        <div>
          <div className="text-[11px] font-semibold tracking-tight text-ink">GrokCode</div>
          <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-muted">
            Desktop
          </div>
        </div>
        <button
          data-testid="new-project"
          className="rounded-md px-2 py-1 text-[10px] text-muted transition hover:bg-raised hover:text-ink active:translate-y-px"
          onClick={() => setShowNewProject(true)}
        >
          New project
        </button>
      </div>

      <div className="no-drag min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {projects.length === 0 ? (
          <button
            className="w-full rounded-lg border border-dashed border-line px-3 py-6 text-left text-[11px] text-muted transition hover:border-accent/40 hover:text-ink"
            onClick={() => setShowNewProject(true)}
          >
            Add a project to start chatting.
          </button>
        ) : (
          projects.map((project) => {
            const open = !collapsed[project.id]
            const projectChats = chatsByProject[project.id] ?? []
            const selected = activeProjectId === project.id
            return (
              <div key={project.id} className="mb-1">
                <div
                  className={`flex items-center gap-1 rounded-md px-1.5 py-1 ${
                    selected ? 'bg-active' : 'hover:bg-raised/70'
                  }`}
                >
                  <button
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink/80 hover:bg-canvas hover:text-ink"
                    aria-expanded={open}
                    title={open ? 'Collapse project' : 'Expand project'}
                    onClick={() => toggleProject(project.id)}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                      className={`transition-transform ${open ? 'rotate-90' : ''}`}
                    >
                      <path
                        d="M4.25 2.25L8.5 6L4.25 9.75"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    className="flex min-w-0 flex-1 items-center text-left"
                    onClick={() => {
                      selectProject(project.id)
                      expandProject(project.id)
                    }}
                  >
                    <span className="truncate text-[10px] font-medium text-ink">{project.name}</span>
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-canvas hover:text-ink"
                    title="New chat"
                    onClick={() => {
                      expandProject(project.id)
                      void createChat(project.id)
                    }}
                  >
                    +
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-canvas hover:text-danger"
                    title="Delete project"
                    onClick={() => {
                      if (confirm(`Delete ${project.name} and its chats?`)) {
                        void deleteProject(project.id)
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
                {open && (
                  <div className="ml-4 mt-0.5">
                    {project.path && (
                      <div className="mb-1 truncate px-2 font-mono text-[8px] text-muted">
                        {project.path}
                      </div>
                    )}
                    <div className="mb-1 px-2">
                      <IndexStatus projectId={project.id} compact />
                    </div>
                    {projectChats.length === 0 ? (
                      <button
                        className="w-full rounded px-2 py-0.5 text-left text-[11px] text-muted hover:text-ink"
                        onClick={() => void createChat(project.id)}
                      >
                        New chat
                      </button>
                    ) : (
                      projectChats.map((chat) => {
                        const streaming = streams[chat.id]?.status === 'streaming'
                        const active = activeChatId === chat.id
                        return (
                          <div key={chat.id} className="group flex items-center">
                            <button
                              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-0.5 text-left ${
                                active
                                  ? 'bg-active text-ink'
                                  : 'text-muted hover:bg-canvas/80 hover:text-ink'
                              }`}
                              onClick={() => void openChat(chat.id)}
                            >
                              {streaming ? (
                                <span className="streaming-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                              ) : (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                              )}
                              <span className="truncate text-[11px] leading-5">{chat.title}</span>
                            </button>
                            <button
                              className="hidden rounded px-1.5 text-[10px] text-muted group-hover:block hover:text-danger"
                              onClick={() => {
                                if (confirm('Delete this chat?')) void deleteChat(chat.id)
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="no-drag border-t border-line px-3 py-3">
        <ActivityToggle />
        <button
          data-testid="open-settings"
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[10px] text-muted hover:bg-raised hover:text-ink"
          onClick={() => setShowSettings(true)}
        >
          <span>Settings</span>
          <span className="font-mono text-[9px]">
            {settings?.grokBuildSignedIn
              ? 'Grok Build'
              : settings?.hasKey
                ? settings.model
                : 'Sign in'}
          </span>
        </button>
      </div>
      <div
        className="no-drag absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/40"
        onPointerDown={startResize}
      />
    </aside>
  )
}
