import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, Message, ProjectIndex } from '../../../shared/types'
import { useWorkspace } from '../workspace'
import { Markdown } from './Markdown'
import { ProjectOrientation } from './OrientationCard'

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function ChatPane(): React.JSX.Element {
  const {
    projects,
    chats,
    indexes,
    openChatIds,
    activeChatId,
    activeProjectId,
    chatsById,
    streams,
    openChat,
    closeTab,
    createChat,
    sendMessage,
    stopChat,
    setShowNewProject
  } = useWorkspace()

  const activeChat = activeChatId ? chatsById[activeChatId] : null
  const activeProject = projects.find(
    (project) => project.id === (activeChat?.projectId ?? activeProjectId)
  )
  const stream = activeChatId ? streams[activeChatId] : undefined

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <TabBar
        openChatIds={openChatIds}
        activeChatId={activeChatId}
        chats={chats}
        streams={streams}
        onOpen={(id) => void openChat(id)}
        onClose={closeTab}
        onNew={() => {
          if (activeProject) void createChat(activeProject.id)
          else setShowNewProject(true)
        }}
      />
      {!activeChat ? (
        <EmptyState
          projectId={activeProject?.id ?? null}
          index={activeProject ? indexes[activeProject.id] : undefined}
          onNewProject={() => setShowNewProject(true)}
        />
      ) : (
        <>
          <MessageList
            chat={activeChat}
            projectId={activeChat.projectId}
            index={indexes[activeChat.projectId]}
            draft={stream?.status === 'streaming' ? stream.draft : ''}
            error={stream?.error ?? null}
          />
          <Composer
            key={activeChat.id}
            disabled={stream?.status === 'streaming'}
            streaming={stream?.status === 'streaming'}
            history={activeChat.messages
              .filter((message) => message.role === 'user' && message.content.trim())
              .map((message) => message.content)}
            onSend={(text, attachments) => void sendMessage(activeChat.id, text, attachments)}
            onStop={() => void stopChat(activeChat.id)}
          />
        </>
      )}
    </section>
  )
}

function TabBar({
  openChatIds,
  activeChatId,
  chats,
  streams,
  onOpen,
  onClose,
  onNew
}: {
  openChatIds: string[]
  activeChatId: string | null
  chats: { id: string; title: string }[]
  streams: Record<string, { status: string }>
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  const titles = useMemo(() => {
    const map = new Map(chats.map((chat) => [chat.id, chat.title]))
    return map
  }, [chats])

  return (
    <div className="drag flex h-[52px] shrink-0 items-end gap-1 border-b border-line bg-surface px-3">
      <div className="no-drag flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {openChatIds.map((id) => {
          const active = id === activeChatId
          const streaming = streams[id]?.status === 'streaming'
          return (
            <div
              key={id}
              className={`flex max-w-[220px] items-center gap-1 rounded-t-md border border-b-0 px-2 py-1.5 ${
                active
                  ? 'border-line bg-canvas text-ink'
                  : 'border-transparent text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              <button className="flex min-w-0 items-center gap-2" onClick={() => onOpen(id)}>
                {streaming && <span className="streaming-dot h-1.5 w-1.5 rounded-full bg-accent" />}
                <span className="truncate text-[12.5px]">{titles.get(id) ?? 'Chat'}</span>
              </button>
              <button
                className="rounded px-1 text-[11px] text-muted hover:text-ink"
                onClick={() => onClose(id)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button
        className="no-drag mb-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-raised hover:text-ink"
        onClick={onNew}
      >
        New chat
      </button>
    </div>
  )
}

function EmptyState({
  projectId,
  index,
  onNewProject
}: {
  projectId: string | null
  index: ProjectIndex | undefined
  onNewProject: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-start justify-center px-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">GrokCode</div>
      <h1 className="font-display mt-3 max-w-xl text-[28px] font-semibold tracking-tight text-ink">
        Open a project, then start as many chats as you need.
      </h1>
      <p className="mt-3 max-w-lg text-[14px] leading-6 text-muted">
        Each project holds its own conversations. Chats keep generating when you switch tabs.
      </p>
      {projectId && (
        <div className="mt-8 w-full max-w-[720px]">
          <ProjectOrientation projectId={projectId} index={index} />
        </div>
      )}
      <button
        data-testid="empty-new-project"
        className="mt-8 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink transition hover:brightness-110 active:translate-y-px"
        onClick={onNewProject}
      >
        New project
      </button>
    </div>
  )
}

function MessageList({
  chat,
  projectId,
  index,
  draft,
  error
}: {
  chat: { messages: Message[] }
  projectId: string
  index: ProjectIndex | undefined
  draft: string
  error: string | null
}): React.JSX.Element {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages, draft])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
      {chat.messages.length === 0 && !draft ? (
        <div className="mx-auto max-w-[720px] pt-10">
          <ProjectOrientation projectId={projectId} index={index} />
          <div className="mt-6 text-[14px] text-muted">
            Ask Grok about this project. Other chats can keep running in the background.
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-[720px] flex-col gap-8">
          {chat.messages.map((message) => (
            <article key={message.id}>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {message.role === 'user' ? 'You' : 'Grok'}
              </div>
              {message.role === 'user' ? (
                <div className="whitespace-pre-wrap text-[14.5px] leading-7 text-ink/90">
                  {message.content}
                </div>
              ) : (
                <Markdown text={message.content} />
              )}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <img
                      key={attachment.id}
                      src={`data:${attachment.mimeType};base64,${attachment.data}`}
                      alt="Screenshot"
                      className="max-h-64 max-w-full rounded-lg border border-line"
                    />
                  ))}
                </div>
              )}
            </article>
          ))}
          {draft && (
            <article>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                Grok
              </div>
              <Markdown text={draft} />
              <span className="cursor" />
            </article>
          )}
          {error && <div className="text-[13px] text-danger">{error}</div>}
        </div>
      )}
      <div ref={bottom} />
    </div>
  )
}

async function fileToAttachment(file: Blob, mimeType: string): Promise<Attachment | null> {
  if (file.size > MAX_IMAGE_BYTES) return null
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    id: crypto.randomUUID(),
    mimeType,
    data: btoa(binary)
  }
}

async function attachmentsFromClipboard(event: React.ClipboardEvent): Promise<Attachment[]> {
  const next: Attachment[] = []
  const items = [...event.clipboardData.items]
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const attachment = await fileToAttachment(file, item.type || 'image/png')
    if (attachment) next.push(attachment)
  }
  return next
}

function caretOnFirstLine(el: HTMLTextAreaElement): boolean {
  return !el.value.slice(0, el.selectionStart).includes('\n')
}

function caretOnLastLine(el: HTMLTextAreaElement): boolean {
  return !el.value.slice(el.selectionStart).includes('\n')
}

function Composer({
  disabled,
  streaming,
  history,
  onSend,
  onStop
}: {
  disabled: boolean
  streaming: boolean
  history: string[]
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  function recall(nextIndex: number): void {
    if (history.length === 0) return
    if (historyIndex === null) draftRef.current = value
    if (nextIndex < 0) nextIndex = 0
    if (nextIndex >= history.length) {
      setHistoryIndex(null)
      setValue(draftRef.current)
      return
    }
    setHistoryIndex(nextIndex)
    setValue(history[nextIndex])
  }

  async function addImages(incoming: Attachment[]): Promise<void> {
    if (incoming.length === 0) return
    setAttachments((current) => {
      const room = MAX_IMAGES - current.length
      if (room <= 0) {
        setPasteError(`Up to ${MAX_IMAGES} images per message`)
        return current
      }
      setPasteError(null)
      return [...current, ...incoming.slice(0, room)]
    })
  }

  function submit(): void {
    const text = value.trim()
    if ((!text && attachments.length === 0) || disabled) return
    onSend(text, attachments)
    setValue('')
    setAttachments([])
    setPasteError(null)
    setHistoryIndex(null)
    draftRef.current = ''
  }

  return (
    <div className="px-10 pb-7">
      <div className="mx-auto max-w-[720px] rounded-2xl border border-line bg-surface px-4 py-3 focus-within:border-accent/50">
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="relative">
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt=""
                  className="h-16 w-16 rounded-md border border-line object-cover"
                />
                <button
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-raised text-[10px] text-muted hover:text-ink"
                  onClick={() =>
                    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={3}
          value={value}
          disabled={disabled}
          placeholder="Ask Grok…  Paste a screenshot with ⌘V"
          className="w-full resize-none bg-transparent text-[14.5px] leading-6 text-ink outline-none placeholder:text-muted disabled:opacity-60"
          onChange={(event) => {
            setValue(event.target.value)
            setHistoryIndex(null)
          }}
          onPaste={(event) => {
            const hasImage = [...event.clipboardData.items].some((item) =>
              item.type.startsWith('image/')
            )
            if (!hasImage) return
            event.preventDefault()
            void attachmentsFromClipboard(event).then((incoming) => {
              void addImages(incoming)
            })
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
              return
            }
            if (event.altKey || event.metaKey || event.ctrlKey) return
            const el = ref.current
            if (!el || history.length === 0) return
            if (event.key === 'ArrowUp' && (historyIndex !== null || caretOnFirstLine(el))) {
              event.preventDefault()
              recall(historyIndex === null ? history.length - 1 : historyIndex - 1)
              return
            }
            if (event.key === 'ArrowDown' && historyIndex !== null && caretOnLastLine(el)) {
              event.preventDefault()
              recall(historyIndex + 1)
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted">
            {pasteError ?? 'Enter to send · ↑ previous · ⌘V pastes a screenshot'}
          </div>
          {streaming ? (
            <button
              className="rounded-md bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-line active:translate-y-px"
              onClick={onStop}
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:opacity-40"
              disabled={!value.trim() && attachments.length === 0}
              onClick={submit}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
