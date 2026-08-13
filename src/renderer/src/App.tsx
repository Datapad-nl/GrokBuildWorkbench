import { useEffect, useState } from 'react'
import { ActivityApp } from './components/ActivityApp'
import { BrowserPane } from './components/BrowserPane'
import { ChatPane } from './components/ChatPane'
import { NewProjectModal, SettingsModal } from './components/Modals'
import { Sidebar } from './components/Sidebar'
import { ThemeProvider } from './theme/ThemeProvider'
import { useWorkspace, WorkspaceProvider, type RightPaneId } from './workspace'

const ACTIVITY_WIDTH_KEY = 'grokcode.activityWidth'
const BROWSER_WIDTH_KEY = 'grokcode.browserWidth'
const DEFAULT_ACTIVITY_WIDTH = 360
const DEFAULT_BROWSER_WIDTH = 420
const MIN_ACTIVITY_WIDTH = 260
const MAX_ACTIVITY_WIDTH = 720
const MIN_BROWSER_WIDTH = 320
const MAX_BROWSER_WIDTH = 900
const COLLAPSE_ACTIVITY_WIDTH = 200
const COLLAPSE_BROWSER_WIDTH = 200

function readWidth(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(localStorage.getItem(key))
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function Shell(): React.JSX.Element {
  const { showActivity, showBrowser, rightPaneOrder } = useWorkspace()
  const [activityWidth, setActivityWidth] = useState(() =>
    readWidth(ACTIVITY_WIDTH_KEY, DEFAULT_ACTIVITY_WIDTH, MIN_ACTIVITY_WIDTH, MAX_ACTIVITY_WIDTH)
  )
  const [browserWidth, setBrowserWidth] = useState(() =>
    readWidth(BROWSER_WIDTH_KEY, DEFAULT_BROWSER_WIDTH, MIN_BROWSER_WIDTH, MAX_BROWSER_WIDTH)
  )
  const [dragging, setDragging] = useState<'activity' | 'browser' | null>(null)

  useEffect(() => {
    localStorage.setItem(ACTIVITY_WIDTH_KEY, String(activityWidth))
  }, [activityWidth])

  useEffect(() => {
    localStorage.setItem(BROWSER_WIDTH_KEY, String(browserWidth))
  }, [browserWidth])

  function startResize(
    event: React.PointerEvent<HTMLDivElement>,
    kind: 'activity' | 'browser'
  ): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = kind === 'activity' ? activityWidth : browserWidth
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    setDragging(kind)

    function onMove(move: PointerEvent): void {
      const next = startWidth - (move.clientX - startX)
      if (kind === 'activity') {
        setActivityWidth(Math.min(MAX_ACTIVITY_WIDTH, Math.max(MIN_ACTIVITY_WIDTH, next)))
      } else {
        setBrowserWidth(Math.min(MAX_BROWSER_WIDTH, Math.max(MIN_BROWSER_WIDTH, next)))
      }
    }

    function onUp(): void {
      setDragging(null)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }

    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const panes: Record<RightPaneId, React.JSX.Element> = {
    browser: (
      <aside
        key="browser"
        className={`relative overflow-hidden border-l border-line bg-canvas ${
          dragging === 'browser' ? '' : 'transition-[width] duration-200 ease-out'
        }`}
        style={{
          width: showBrowser ? browserWidth : 0,
          minWidth: showBrowser ? COLLAPSE_BROWSER_WIDTH : 0,
          flexShrink: showBrowser ? 1 : 0,
          borderLeftWidth: showBrowser ? 1 : 0
        }}
        aria-hidden={!showBrowser}
      >
        <div className="flex h-full flex-col" style={{ width: browserWidth }}>
          <BrowserPane />
        </div>
        {showBrowser && (
          <div
            className="no-drag absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/40"
            onPointerDown={(event) => startResize(event, 'browser')}
          />
        )}
      </aside>
    ),
    activity: (
      <aside
        key="activity"
        className={`relative overflow-hidden border-l border-line bg-sidebar ${
          dragging === 'activity' ? '' : 'transition-[width] duration-200 ease-out'
        }`}
        style={{
          width: showActivity ? activityWidth : 0,
          minWidth: showActivity ? COLLAPSE_ACTIVITY_WIDTH : 0,
          flexShrink: showActivity ? 1 : 0,
          borderLeftWidth: showActivity ? 1 : 0
        }}
        aria-hidden={!showActivity}
      >
        <div className="flex h-full flex-col" style={{ width: activityWidth }}>
          <ActivityApp />
        </div>
        {showActivity && (
          <div
            className="no-drag absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/40"
            onPointerDown={(event) => startResize(event, 'activity')}
          />
        )}
      </aside>
    )
  }

  return (
    <>
      <div className="flex h-full overflow-hidden bg-canvas text-ink">
        <Sidebar />
        <ChatPane />
        {rightPaneOrder.map((id) => panes[id])}
      </div>
      <NewProjectModal />
      <SettingsModal />
    </>
  )
}

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </ThemeProvider>
  )
}
