import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEvent, ActivitySnapshot } from '../../../shared/types'
import { useWorkspace } from '../workspace'
import { CodeDiff } from './CodeDiff'
import { ReorderGrip } from './ReorderGrip'

function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function kindLabel(event: ActivityEvent): string {
  if (event.kind === 'tool') return event.toolKind?.replace(/_/g, ' ') || 'Tool'
  if (event.kind === 'thought') return 'Thinking'
  if (event.kind === 'write') return 'Reply'
  if (event.kind === 'plan') return 'Plan'
  if (event.kind === 'permission') return 'Permission'
  if (event.kind === 'error') return 'Error'
  return 'Turn'
}

const EXCERPT_LINES = 6
const EXCERPT_CHARS = 320

function detailExcerpt(
  text: string,
  fromEnd: boolean
): { preview: string; expandable: boolean } {
  const normalized = text.replace(/\s+$/u, '')
  const lines = normalized.split('\n')
  if (lines.length > EXCERPT_LINES) {
    const slice = fromEnd ? lines.slice(-EXCERPT_LINES) : lines.slice(0, EXCERPT_LINES)
    return { preview: slice.join('\n'), expandable: true }
  }
  if (normalized.length > EXCERPT_CHARS) {
    const preview = fromEnd
      ? normalized.slice(-EXCERPT_CHARS).trimStart()
      : normalized.slice(0, EXCERPT_CHARS).trimEnd()
    return { preview, expandable: true }
  }
  return { preview: normalized, expandable: false }
}

function EventDetail({
  text,
  kind,
  tool,
  live
}: {
  text: string
  kind: ActivityEvent['kind']
  tool: boolean
  live: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const fromEnd = kind === 'thought'
  const { preview, expandable } = useMemo(() => detailExcerpt(text, fromEnd), [text, fromEnd])
  const expanded = open || live || !expandable
  const shown = expanded ? text : preview

  function toggle(): void {
    if (!expandable) return
    if (window.getSelection()?.toString()) return
    setOpen((value) => !value)
  }

  return (
    <div className="mt-1.5">
      <div className="relative">
        <pre
          className={`whitespace-pre-wrap break-words leading-5 ${
            kind === 'thought'
              ? 'font-sans text-[12.5px] text-ink/85'
              : tool
                ? 'font-mono text-[11.5px] text-ink/75'
                : 'font-sans text-[12.5px] text-muted'
          } ${expandable ? 'cursor-pointer' : ''}`}
          onClick={toggle}
          role={expandable ? 'button' : undefined}
          tabIndex={expandable ? 0 : undefined}
          aria-expanded={expandable ? expanded : undefined}
          onKeyDown={(event) => {
            if (!expandable) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setOpen((value) => !value)
            }
          }}
        >
          {expandable && !expanded && fromEnd ? '…' : null}
          {shown}
          {expandable && !expanded && !fromEnd ? '…' : null}
        </pre>
        {expandable && !expanded && (
          <div
            className={`pointer-events-none absolute inset-x-0 h-7 ${
              fromEnd
                ? 'top-0 bg-gradient-to-b from-sidebar to-transparent'
                : 'bottom-0 bg-gradient-to-t from-sidebar to-transparent'
            }`}
          />
        )}
      </div>
      {expandable && !live && (
        <button
          type="button"
          className="mt-1 text-[11px] text-muted hover:text-ink active:translate-y-px"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function EventRow({ event }: { event: ActivityEvent }): React.JSX.Element {
  const running = event.status === 'running'
  const failed = event.status === 'error'
  const tool = event.kind === 'tool'
  return (
    <article className="border-b border-line/80 px-3 py-3">
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
            failed ? 'text-danger' : running ? 'text-accent' : 'text-muted'
          }`}
        >
          {kindLabel(event)}
        </span>
        {running && <span className="streaming-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        <span className="ml-auto shrink-0 font-mono text-[9px] text-muted">{clock(event.at)}</span>
      </div>
      {event.kind !== 'thought' && (
        <div className="mt-1 text-[13px] font-medium leading-5 text-ink">{event.title}</div>
      )}
      {event.detail && (
        <EventDetail text={event.detail} kind={event.kind} tool={tool} live={running} />
      )}
      {event.diffs?.map((diff, index) => (
        <CodeDiff key={`${diff.path}:${index}`} diff={diff} />
      ))}
    </article>
  )
}

export function ActivityApp(): React.JSX.Element {
  const { showBrowser, showGit, showKnowledge, setShowActivity, swapRightPanes } = useWorkspace()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [filter, setFilter] = useState<string | 'edits' | null>('edits')
  const [pinned, setPinned] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(false)
  const ignoreScrollRef = useRef(false)
  const lastScrollTop = useRef(0)

  function stickToBottom(): void {
    const node = scroller.current
    if (!node || pinnedRef.current) return
    ignoreScrollRef.current = true
    node.scrollTop = node.scrollHeight
    lastScrollTop.current = node.scrollTop
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ignoreScrollRef.current = false
      })
    })
  }

  useEffect(() => {
    void window.grokcode.getActivity().then((snapshot: ActivitySnapshot) => {
      setEvents(snapshot.events)
    })
    return window.grokcode.onActivityEvent((feed) => {
      if (feed.type === 'reset') {
        pinnedRef.current = false
        setPinned(false)
        setEvents(feed.events)
        return
      }
      setEvents((current) => {
        const index = current.findIndex((event) => event.id === feed.event.id)
        if (index >= 0) {
          const next = current.slice()
          next[index] = feed.event
          return next
        }
        return [...current, feed.event]
      })
    })
  }, [])

  useLayoutEffect(() => {
    stickToBottom()
  }, [events, pinned, filter])

  useEffect(() => {
    const node = content.current
    if (!node) return
    const observer = new ResizeObserver(() => stickToBottom())
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const chats = useMemo(() => {
    const seen = new Map<string, string>()
    for (const event of events) {
      if (!event.chatId) continue
      seen.set(event.chatId, event.chatTitle || 'Chat')
    }
    return [...seen.entries()]
  }, [events])

  const visible = useMemo(() => {
    if (filter === 'edits') return events.filter((event) => (event.diffs?.length ?? 0) > 0)
    if (filter) return events.filter((event) => event.chatId === filter)
    return events
  }, [events, filter])

  const editCount = useMemo(
    () => events.filter((event) => (event.diffs?.length ?? 0) > 0).length,
    [events]
  )

  const generating = visible.some((event) => event.status === 'running')

  function onScroll(): void {
    const node = scroller.current
    if (!node) return
    const top = node.scrollTop
    const nearBottom = node.scrollHeight - top - node.clientHeight <= 80
    if (nearBottom) {
      if (pinnedRef.current) {
        pinnedRef.current = false
        setPinned(false)
      }
    } else if (!ignoreScrollRef.current && top < lastScrollTop.current - 1) {
      if (!pinnedRef.current) {
        pinnedRef.current = true
        setPinned(true)
      }
    }
    lastScrollTop.current = top
  }

  function jumpToLatest(): void {
    pinnedRef.current = false
    setPinned(false)
    stickToBottom()
  }

  function applyFilter(next: string | 'edits' | null): void {
    pinnedRef.current = false
    setPinned(false)
    setFilter(next)
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-ink">
      <header className="drag shrink-0">
        <div className="flex h-titlebar items-center justify-between gap-2 border-b border-line px-3">
          {(showBrowser || showGit || showKnowledge) && (
            <ReorderGrip onSwap={swapRightPanes} label="Reorder panes" />
          )}
          <div className="no-drag min-w-0 flex-1">
            <h1 className="text-[13px] font-semibold tracking-tight">Thought process</h1>
            <p className="mt-px text-[11px] text-muted">
              {generating ? 'Grok is working' : visible.length === 0 ? 'Waiting for a chat' : 'Idle'}
            </p>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            <button
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-raised hover:text-ink active:translate-y-px"
              onClick={() => void window.grokcode.clearActivity()}
            >
              Clear
            </button>
            <button
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-raised hover:text-ink active:translate-y-px"
              onClick={() => setShowActivity(false)}
            >
              Hide
            </button>
          </div>
        </div>
        <div className="no-drag flex flex-wrap gap-1 px-3 py-2">
          <button
            className={`rounded-md px-2 py-1 text-[11px] ${
              filter === 'edits' ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
            onClick={() => applyFilter('edits')}
          >
            Edits{editCount > 0 ? ` ${editCount}` : ''}
          </button>
          <button
            className={`rounded-md px-2 py-1 text-[11px] ${
              filter === null ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
            onClick={() => applyFilter(null)}
          >
            All
          </button>
          {chats.map(([chatId, title]) => (
            <button
              key={chatId}
              className={`max-w-[180px] truncate rounded-md px-2 py-1 text-[11px] ${
                filter === chatId ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
              }`}
              onClick={() => applyFilter(chatId)}
            >
              {title}
            </button>
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="select-text h-full overflow-y-auto [overflow-anchor:none]"
          onScroll={onScroll}
        >
          <div ref={content}>
            {visible.length === 0 ? (
              <div className="px-3 pt-6 text-[13px] leading-6 text-muted">
                {filter === 'edits'
                  ? 'File edits will show here as side-by-side diffs once Grok changes a file.'
                  : 'Send a message in a chat. Thinking, tool calls, and the plan show up here as Grok works.'}
              </div>
            ) : (
              visible.map((event) => <EventRow key={event.id} event={event} />)
            )}
          </div>
        </div>
        {pinned && visible.length > 0 && (
          <button
            type="button"
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-raised px-3 py-1 text-[11px] text-ink shadow-lg hover:bg-surface active:translate-y-px"
            onClick={jumpToLatest}
          >
            Latest
          </button>
        )}
      </div>
    </div>
  )
}
