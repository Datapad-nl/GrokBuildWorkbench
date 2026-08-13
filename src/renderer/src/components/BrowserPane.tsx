import { useEffect, useRef, useState } from 'react'
import type { BrowserState } from '../../../shared/types'
import { useWorkspace } from '../workspace'
import { ReorderGrip } from './ReorderGrip'

const empty: BrowserState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false,
  visible: false,
  error: null
}

export function BrowserPane(): React.JSX.Element {
  const {
    showBrowser,
    showActivity,
    showGit,
    showNewProject,
    showSettings,
    setShowBrowser,
    swapRightPanes
  } = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState>(empty)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const overlay = showBrowser && !showNewProject && !showSettings

  useEffect(() => {
    void window.grokcode.getBrowserState().then((next) => {
      setState(next)
      if (!editing) setDraft(next.url)
    })
    return window.grokcode.onBrowserState((next) => {
      setState(next)
      if (!editing) setDraft(next.url)
    })
  }, [editing])

  useEffect(() => {
    void window.grokcode.setBrowserVisible(overlay)
    return () => {
      void window.grokcode.setBrowserVisible(false)
    }
  }, [overlay])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !overlay) return

    let frame = 0
    let last = ''

    function report(): void {
      const rect = el!.getBoundingClientRect()
      const key = `${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}|${Math.round(rect.height)}`
      if (key === last) {
        frame = requestAnimationFrame(report)
        return
      }
      last = key
      void window.grokcode.setBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
      frame = requestAnimationFrame(report)
    }

    frame = requestAnimationFrame(report)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [overlay])

  async function go(input: string): Promise<void> {
    setEditing(false)
    const next = await window.grokcode.navigateBrowser(input)
    setState(next)
    setDraft(next.url)
  }

  async function clearLogins(): Promise<void> {
    if (!confirm('Forget saved logins and cookies in this browser?')) return
    const next = await window.grokcode.clearBrowserData()
    setState(next)
    setDraft('')
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-canvas">
      <div className="drag flex h-titlebar shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        <div className="no-drag flex min-w-0 flex-1 items-center gap-1">
          {(showActivity || showGit) && (
            <ReorderGrip onSwap={swapRightPanes} label="Reorder panes" />
          )}
          <IconButton
            label="Back"
            disabled={!state.canGoBack}
            onClick={() => void window.grokcode.browserBack()}
          >
            ‹
          </IconButton>
          <IconButton
            label="Forward"
            disabled={!state.canGoForward}
            onClick={() => void window.grokcode.browserForward()}
          >
            ›
          </IconButton>
          <IconButton
            label={state.loading ? 'Stop' : 'Reload'}
            onClick={() =>
              void (state.loading ? window.grokcode.stopBrowser() : window.grokcode.reloadBrowser())
            }
          >
            {state.loading ? '■' : '↻'}
          </IconButton>
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              void go(draft)
            }}
          >
            <input
              data-testid="browser-url"
              type="text"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="https://"
              value={draft}
              className="h-7 w-full rounded-md border border-line bg-canvas px-2 font-mono text-[11px] text-ink outline-none placeholder:text-muted focus:border-accent"
              onFocus={() => setEditing(true)}
              onChange={(event) => {
                setEditing(true)
                setDraft(event.target.value)
              }}
              onBlur={() => {
                setEditing(false)
                setDraft(state.url)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setEditing(false)
                  setDraft(state.url)
                  event.currentTarget.blur()
                }
              }}
            />
          </form>
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-1 text-[10px] text-muted hover:bg-raised hover:text-ink"
            title="Forget cookies and logins"
            onClick={() => void clearLogins()}
          >
            Clear
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-1 text-[10px] text-muted hover:bg-raised hover:text-ink"
            title="Hide browser"
            onClick={() => setShowBrowser(false)}
          >
            Hide
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" data-testid="browser-host" />
        {!state.url && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-[12px] text-muted">
            Enter a site to browse. Logins and cookies stay saved here.
          </div>
        )}
        {state.error && (
          <div className="absolute bottom-2 left-2 right-2 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-danger">
            {state.error}
          </div>
        )}
      </div>
    </section>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[14px] text-ink hover:bg-raised disabled:text-muted disabled:hover:bg-transparent"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
