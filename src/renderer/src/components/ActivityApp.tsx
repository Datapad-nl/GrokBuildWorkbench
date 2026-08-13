import { useEffect, useMemo, useRef, useState } from 'react'
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

function detailExcerpt(text: string): { preview: string; expandable: boolean } {
  const normalized = text.replace(/\s+$/u, '')
  const lines = normalized.split('\n')
  if (lines.length > EXCERPT_LINES) {
    return { preview: lines.slice(0, EXCERPT_LINES).join('\n'), expandable: true }
  }
  if (normalized.length > EXCERPT_CHARS) {
    return { preview: normalized.slice(0, EXCERPT_CHARS).trimEnd(), expandable: true }
  }
  return { preview: normalized, expandable: false }
}

function EventDetail({
  text,
  kind,
  tool
}: {
  text: string
  kind: ActivityEvent['kind']
  tool: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { preview, expandable } = useMemo(() => detailExcerpt(text), [text])
  const shown = open || !expandable ? text : preview

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
          aria-expanded={expandable ? open : undefined}
          onKeyDown={(event) => {
            if (!expandable) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setOpen((value) => !value)
            }
          }}
        >
          {shown}
          {expandable && !open ? '…' : null}
        </pre>
        {expandable && !open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-sidebar to-transparent" />
        )}
      </div>
      {expandable && (
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
      {event.detail && <EventDetail text={event.detail} kind={event.kind} tool={tool} />}
      {event.diffs?.map((diff, index) => (
        <CodeDiff key={`${diff.path}:${index}`} diff={diff} />
      ))}
    </article>
  )
}

export function ActivityApp(): React.JSX.Element {
  const { showBrowser, setShowActivity, swapRightPanes } = useWorkspace()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [filter, setFilter] = useState<string | 'edits' | null>('edits')
  const [pinned, setPinned] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.grokcode.getActivity().then((snapshot: ActivitySnapshot) => {
      setEvents(snapshot.events)
    })
    return window.grokcode.onActivityEvent((feed) => {
      if (feed.type === 'reset') {
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

  useEffect(() => {
    if (pinned) return
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [events, pinned, filter])

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
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    setPinned(distance > 48)
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-ink">
      <header className="drag shrink-0">
        <div className="flex h-titlebar items-center justify-between gap-2 border-b border-line px-3">
          {showBrowser && (
            <ReorderGrip onSwap={swapRightPanes} label="Drag to swap with browser" />
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
            onClick={() => setFilter('edits')}
          >
            Edits{editCount > 0 ? ` ${editCount}` : ''}
          </button>
          <button
            className={`rounded-md px-2 py-1 text-[11px] ${
              filter === null ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
            onClick={() => setFilter(null)}
          >
            All
          </button>
          {chats.map(([chatId, title]) => (
            <button
              key={chatId}
              className={`max-w-[180px] truncate rounded-md px-2 py-1 text-[11px] ${
                filter === chatId ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
              }`}
              onClick={() => setFilter(chatId)}
            >
              {title}
            </button>
          ))}
        </div>
      </header>
      <div ref={scroller} className="select-text min-h-0 flex-1 overflow-y-auto" onScroll={onScroll}>
        {visible.length === 0 ? (
          <div className="px-3 pt-6 text-[13px] leading-6 text-muted">
            {filter === 'edits'
              ? 'File edits will show here as side-by-side diffs once Grok changes a file.'
              : 'Send a message in a chat. Thinking, tool calls, and the plan show up here as Grok works.'}
          </div>
        ) : (
          visible.map((event) => <EventRow key={event.id} event={event} />)
        )}
        <div ref={bottom} />
      </div>
    </div>
  )
}
