import { useEffect, useState } from 'react'
import { ActivityApp } from './components/ActivityApp'
import { ChatPane } from './components/ChatPane'
import { NewProjectModal, SettingsModal } from './components/Modals'
import { Sidebar } from './components/Sidebar'
import { ThemeProvider } from './theme/ThemeProvider'
import { useWorkspace, WorkspaceProvider } from './workspace'

const WIDTH_KEY = 'grokcode.activityWidth'
const DEFAULT_WIDTH = 360
const MIN_WIDTH = 260
const MAX_WIDTH = 720

function readActivityWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  if (!Number.isFinite(raw)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw))
}

function Shell(): React.JSX.Element {
  const { showActivity } = useWorkspace()
  const [width, setWidth] = useState(readActivityWidth)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width))
  }, [width])

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    setDragging(true)

    function onMove(move: PointerEvent): void {
      const next = startWidth - (move.clientX - startX)
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)))
    }

    function onUp(): void {
      setDragging(false)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }

    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <div className="flex h-full overflow-hidden bg-canvas text-ink">
        <Sidebar />
        <ChatPane />
        <aside
          className={`relative shrink-0 overflow-hidden border-l border-line bg-sidebar ${
            dragging ? '' : 'transition-[width] duration-200 ease-out'
          }`}
          style={{ width: showActivity ? width : 0, borderLeftWidth: showActivity ? 1 : 0 }}
          aria-hidden={!showActivity}
        >
          <div className="flex h-full flex-col" style={{ width }}>
            <ActivityApp />
          </div>
          {showActivity && (
            <div
              className="no-drag absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/40"
              onPointerDown={startResize}
            />
          )}
        </aside>
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
