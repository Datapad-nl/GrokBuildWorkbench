import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PROJECT_COLORS, resolveProjectColor } from '../../../shared/projectColor'
import type { Project } from '../../../shared/types'
import { useWorkspace, type RightPaneId } from '../workspace'
import { IndexStatus } from './OrientationCard'
import { ReorderGrip } from './ReorderGrip'

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

function ProjectColorButton({ project }: { project: Project }): React.JSX.Element {
  const { updateProject } = useWorkspace()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const color = resolveProjectColor(project)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  function placePopover(rect: DOMRect): void {
    const width = 168
    const height = 132
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    const top = rect.bottom + height + 8 > window.innerHeight ? rect.top - height - 6 : rect.bottom + 6
    setPos({ top, left: Math.max(8, left) })
  }

  useEffect(() => {
    if (!open) return

    function place(): void {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) placePopover(rect)
    }

    function onDown(event: MouseEvent): void {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    place()
    window.addEventListener('resize', place)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function setColor(next: string): Promise<void> {
    await updateProject({ id: project.id, color: next })
  }

  return (
    <>
      <button
        ref={buttonRef}
        data-testid="project-color"
        type="button"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-canvas active:scale-95"
        title="Change project color"
        aria-label={`Change color for ${project.name}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          placePopover(event.currentTarget.getBoundingClientRect())
          setOpen((current) => !current)
        }}
      >
        <span
          className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20"
          style={{ background: color }}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 w-[168px] rounded-lg border border-line bg-surface p-2 shadow-2xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="grid grid-cols-5 gap-1.5">
              {PROJECT_COLORS.map((swatch) => {
                const selected = swatch === color
                return (
                  <button
                    key={swatch}
                    type="button"
                    className={`h-6 w-6 rounded-full ring-1 transition hover:scale-105 active:scale-95 ${
                      selected ? 'ring-2 ring-ink' : 'ring-white/15 hover:ring-white/40'
                    }`}
                    style={{ background: swatch }}
                    title={swatch}
                    onClick={() => {
                      void setColor(swatch)
                      setOpen(false)
                    }}
                  />
                )
              })}
            </div>
            <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted">
              Custom
              <input
                type="color"
                value={color}
                className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent p-0"
                onChange={(event) => void setColor(event.target.value)}
              />
            </label>
          </div>,
          document.body
        )}
    </>
  )
}

function ActivityToggle(): React.JSX.Element {
  const { showActivity, setShowActivity, swapRightPanes } = useWorkspace()

  return (
    <div className="flex items-center">
      <ReorderGrip onSwap={swapRightPanes} label="Drag to swap with browser" />
      <button
        data-testid="open-activity"
        className={`flex h-8 min-w-0 flex-1 items-center justify-between rounded-md px-2 text-left text-[11px] hover:bg-raised hover:text-ink ${
          showActivity ? 'text-ink' : 'text-muted'
        }`}
        onClick={() => setShowActivity(!showActivity)}
      >
        <span>Thought process</span>
        <span>{showActivity ? 'Hide' : 'Show'}</span>
      </button>
    </div>
  )
}

function BrowserToggle(): React.JSX.Element {
  const { showBrowser, setShowBrowser, swapRightPanes } = useWorkspace()

  return (
    <div className="flex items-center">
      <ReorderGrip onSwap={swapRightPanes} label="Drag to swap with thought process" />
      <button
        data-testid="open-browser"
        className={`flex h-8 min-w-0 flex-1 items-center justify-between rounded-md px-2 text-left text-[11px] hover:bg-raised hover:text-ink ${
          showBrowser ? 'text-ink' : 'text-muted'
        }`}
        onClick={() => setShowBrowser(!showBrowser)}
      >
        <span>Browser</span>
        <span>{showBrowser ? 'Hide' : 'Show'}</span>
      </button>
    </div>
  )
}

function PaneToggles(): React.JSX.Element {
  const { rightPaneOrder } = useWorkspace()
  const panes: Record<RightPaneId, React.JSX.Element> = {
    browser: <BrowserToggle key="browser" />,
    activity: <ActivityToggle key="activity" />
  }
  return <>{rightPaneOrder.map((id) => panes[id])}</>
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
      <header className="drag flex h-titlebar shrink-0 items-center border-b border-line pl-traffic pr-2">
        <div className="no-drag flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight text-ink">GrokCode</div>
            <div className="mt-px font-mono text-[8px] uppercase tracking-[0.14em] text-muted">
              Desktop
            </div>
          </div>
          <button
            data-testid="new-project"
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted transition hover:bg-raised hover:text-ink active:translate-y-px"
            onClick={() => setShowNewProject(true)}
          >
            New project
          </button>
        </div>
      </header>

      <div className="no-drag min-h-0 flex-1 overflow-y-auto px-2 py-2">
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
              <div key={project.id} className="mb-0.5">
                <div
                  className={`flex h-8 items-center gap-1 rounded-md pr-0.5 ${
                    selected ? 'bg-active' : 'hover:bg-raised/70'
                  }`}
                >
                  <button
                    className="flex h-8 w-6 shrink-0 items-center justify-center rounded-sm text-ink/80 hover:bg-canvas hover:text-ink"
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
                  <ProjectColorButton project={project} />
                  <button
                    className="flex min-w-0 flex-1 items-center text-left"
                    onClick={() => {
                      selectProject(project.id)
                      expandProject(project.id)
                    }}
                  >
                    <span className="truncate text-[12px] font-medium text-ink">{project.name}</span>
                  </button>
                  <button
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px] text-muted hover:bg-canvas hover:text-ink"
                    title="New chat"
                    onClick={() => {
                      expandProject(project.id)
                      void createChat(project.id)
                    }}
                  >
                    +
                  </button>
                  <button
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px] text-muted hover:bg-canvas hover:text-danger"
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
                  <div className="mb-1 ml-7">
                    {project.path && (
                      <div className="truncate px-1.5 font-mono text-[9px] leading-4 text-muted">
                        {project.path}
                      </div>
                    )}
                    <div className="px-1.5">
                      <IndexStatus projectId={project.id} compact />
                    </div>
                    {projectChats.length === 0 ? (
                      <button
                        className="mt-0.5 flex h-7 w-full items-center rounded-md px-1.5 text-left text-[12px] text-muted hover:bg-canvas/80 hover:text-ink"
                        onClick={() => void createChat(project.id)}
                      >
                        New chat
                      </button>
                    ) : (
                      projectChats.map((chat) => {
                        const streaming = streams[chat.id]?.status === 'streaming'
                        const active = activeChatId === chat.id
                        const projectColor = resolveProjectColor(project)
                        return (
                          <div
                            key={chat.id}
                            className={`group mt-px flex h-7 items-center rounded-md ${
                              active ? 'bg-active text-ink' : 'text-muted hover:bg-canvas/80 hover:text-ink'
                            }`}
                          >
                            <button
                              className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left"
                              onClick={() => void openChat(chat.id)}
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${streaming ? 'streaming-dot' : ''}`}
                                style={{ background: projectColor, opacity: streaming ? 1 : 0.7 }}
                              />
                              <span className="truncate text-[12px] leading-5">{chat.title}</span>
                            </button>
                            <button
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px] text-muted opacity-0 group-hover:opacity-100 hover:text-danger"
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

      <div className="no-drag border-t border-line px-2 py-2">
        <PaneToggles />
        <button
          data-testid="open-settings"
          className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[11px] text-muted hover:bg-raised hover:text-ink"
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
