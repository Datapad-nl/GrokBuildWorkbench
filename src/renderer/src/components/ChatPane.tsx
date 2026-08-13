import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveProjectColor } from '../../../shared/projectColor'
import type {
  Attachment,
  ChatPlan,
  ChatSummary,
  Checkpoint,
  FileHit,
  FileMention,
  Message,
  PermissionMode,
  PermissionRequest,
  PlanEntry,
  Project,
  ProjectIndex
} from '../../../shared/types'
import {
  commandAt,
  completeSlash,
  filterSlashCommands,
  matchedSlashAlias,
  parseSlashLine,
  type SlashDef
} from '../../../shared/slash'
import { nextPermissionMode, normalizePermissionMode } from '../../../shared/types'
import { useWorkspace } from '../workspace'
import { Markdown } from './Markdown'
import { ProjectOrientation } from './OrientationCard'

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function planStillOpen(plan: ChatPlan | null | undefined): boolean {
  if (!plan || plan.entries.length === 0) return false
  return plan.entries.some((entry) => entry.status !== 'completed')
}

const DOCS_URL = 'https://docs.x.ai/build/overview'
const USAGE_URL = 'https://console.x.ai'

type SlashRun = {
  def: SlashDef
  args: string
  draft: { attachments: Attachment[]; mentions: FileMention[] }
  chatId: string
  projectId: string
  title: string
  sessionHint: string | null
  messages: Message[]
  createChat: (projectId: string) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>
  renameChat: (chatId: string, title: string) => Promise<void>
  sendMessage: (
    chatId: string,
    content: string,
    attachments?: Attachment[],
    mentions?: FileMention[]
  ) => Promise<void>
  setChatMode: (chatId: string, mode: PermissionMode) => Promise<void>
  saveSettings: (input: { model?: string }) => Promise<void>
  setShowSettings: (open: boolean) => void
  openRewind: () => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function conversationMarkdown(messages: Message[]): string {
  return messages
    .map((message) => {
      const who = message.role === 'user' ? 'You' : 'Grok'
      const extras = (message.mentions ?? []).map((item) => `@${item.path}`).join(' ')
      return `## ${who}\n\n${message.content}${extras ? `\n\n${extras}` : ''}`
    })
    .join('\n\n')
}

async function runSlash(input: SlashRun): Promise<string | null> {
  const { def, args } = input
  if (def.kind === 'unavailable') {
    return `/${def.id} is a Grok Build TUI command. Not available in GrokCode.`
  }
  if (def.kind === 'prompt') {
    const body = args ? `${def.prompt ?? ''} ${args}`.trim() : (def.prompt ?? '').trim()
    if (!body) return `Usage: /${def.id} <args>`
    await input.sendMessage(input.chatId, body, input.draft.attachments, input.draft.mentions)
    return null
  }
  switch (def.id) {
    case 'new':
      await input.createChat(input.projectId)
      return null
    case 'rewind':
      input.openRewind()
      return null
    case 'plan':
      await input.setChatMode(input.chatId, 'plan')
      if (args) {
        await input.sendMessage(input.chatId, args, input.draft.attachments, input.draft.mentions)
      }
      return args ? null : 'Plan mode on'
    case 'ask':
      await input.setChatMode(input.chatId, 'ask')
      return 'Ask mode on'
    case 'always-approve':
      await input.setChatMode(input.chatId, 'accept')
      return 'Auto-approve on'
    case 'copy': {
      const replies = input.messages.filter((message) => message.role === 'assistant')
      const offset = args && /^\d+$/.test(args) ? Number(args) : 1
      const reply = replies.at(-offset)
      if (!reply?.content) return 'No reply to copy'
      return (await copyText(reply.content)) ? 'Copied last reply' : 'Could not copy'
    }
    case 'export': {
      const text = conversationMarkdown(input.messages)
      if (!text.trim()) return 'Nothing to export'
      return (await copyText(text)) ? 'Copied conversation as Markdown' : 'Could not copy'
    }
    case 'rename':
      if (!args) return 'Usage: /rename <title>'
      await input.renameChat(input.chatId, args)
      return `Renamed to ${args}`
    case 'delete':
      if (!confirm(`Delete “${input.title}”?`)) return null
      await input.deleteChat(input.chatId)
      return null
    case 'model':
      if (!args) {
        input.setShowSettings(true)
        return 'Opened settings — set the model there, or /model <id>'
      }
      await input.saveSettings({ model: args })
      return `Model set to ${args}`
    case 'settings':
    case 'theme':
      input.setShowSettings(true)
      return null
    case 'docs':
      await window.grokcode.openExternal(args.toLowerCase() === 'web' || !args ? DOCS_URL : DOCS_URL)
      return 'Opened docs'
    case 'usage':
      await window.grokcode.openExternal(USAGE_URL)
      return 'Opened usage'
    case 'login':
      input.setShowSettings(true)
      return 'Run `grok login` in a terminal, then come back'
    case 'logout':
      return 'Run `grok logout` in a terminal'
    case 'quit':
      await window.grokcode.quitApp()
      return null
    case 'view-plan':
      return 'The plan card is in the thread when Grok writes one'
    case 'session-info':
      return [input.title, input.sessionHint].filter(Boolean).join(' · ') || 'Session'
    default:
      return `/${def.id} is not implemented`
  }
}

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
    deleteChat,
    renameChat,
    sendMessage,
    stopChat,
    setChatMode,
    approvePlan,
    resolvePermission,
    rewindChat,
    permissions,
    settings,
    saveSettings,
    setShowSettings,
    setShowNewProject
  } = useWorkspace()
  const [rewindOpen, setRewindOpen] = useState(false)
  const [rewindSelected, setRewindSelected] = useState<string | null>(null)
  const [rewindBusy, setRewindBusy] = useState(false)

  const activeChat = activeChatId ? chatsById[activeChatId] : null
  const activeProject = projects.find(
    (project) => project.id === (activeChat?.projectId ?? activeProjectId)
  )
  const stream = activeChatId ? streams[activeChatId] : undefined

  return (
    <section className="flex min-w-[320px] flex-1 flex-col bg-canvas">
      <TabBar
        openChatIds={openChatIds}
        activeChatId={activeChatId}
        chats={chats}
        projects={projects}
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
            plan={planStillOpen(activeChat.plan) ? (activeChat.plan ?? null) : null}
            checkpoints={activeChat.checkpoints ?? []}
            canApprove={
              normalizePermissionMode(activeChat.mode) === 'plan' && stream?.status !== 'streaming'
            }
            onApprove={() => void approvePlan(activeChat.id)}
            onRewind={(checkpointId) => {
              setRewindSelected(checkpointId)
              setRewindOpen(true)
            }}
          />
          <Composer
            key={activeChat.id}
            disabled={stream?.status === 'streaming'}
            streaming={stream?.status === 'streaming'}
            mode={normalizePermissionMode(activeChat.mode)}
            permission={permissions[activeChat.id] ?? null}
            history={activeChat.messages
              .filter((message) => message.role === 'user' && message.content.trim())
              .map((message) => message.content)}
            projectId={activeChat.projectId}
            chatId={activeChat.id}
            hasFolder={Boolean(activeProject?.path)}
            onSend={(text, attachments, mentions) =>
              void sendMessage(activeChat.id, text, attachments, mentions)
            }
            onSlash={(def, args, draft) =>
              runSlash({
                def,
                args,
                draft,
                chatId: activeChat.id,
                projectId: activeChat.projectId,
                title: activeChat.title,
                sessionHint: settings
                  ? `${settings.model} · ${settings.grokBuildSignedIn ? 'Grok Build' : settings.keySource}`
                  : null,
                messages: activeChat.messages,
                createChat,
                deleteChat,
                renameChat,
                sendMessage,
                setChatMode,
                saveSettings,
                setShowSettings,
                openRewind: () => {
                  const latest = activeChat.checkpoints?.at(-1)
                  setRewindSelected(latest?.id ?? null)
                  setRewindOpen(true)
                }
              })
            }
            onStop={() => void stopChat(activeChat.id)}
            onMode={(mode) => void setChatMode(activeChat.id, mode)}
            onPermission={(requestId, decision) => void resolvePermission(requestId, decision)}
            onRewindMenu={() => {
              const latest = activeChat.checkpoints?.at(-1)
              setRewindSelected(latest?.id ?? null)
              setRewindOpen(true)
            }}
          />
          {rewindOpen && (
            <RewindModal
              checkpoints={[...(activeChat.checkpoints ?? [])].reverse()}
              selectedId={rewindSelected}
              busy={rewindBusy}
              onSelect={setRewindSelected}
              onClose={() => {
                if (rewindBusy) return
                setRewindOpen(false)
              }}
              onRewind={() => {
                if (!rewindSelected || rewindBusy) return
                setRewindBusy(true)
                void rewindChat(activeChat.id, rewindSelected)
                  .then(() => setRewindOpen(false))
                  .finally(() => setRewindBusy(false))
              }}
            />
          )}
        </>
      )}
    </section>
  )
}

function TabBar({
  openChatIds,
  activeChatId,
  chats,
  projects,
  streams,
  onOpen,
  onClose,
  onNew
}: {
  openChatIds: string[]
  activeChatId: string | null
  chats: ChatSummary[]
  projects: Project[]
  streams: Record<string, { status: string }>
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  const tabs = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]))
    return new Map(
      chats.map((chat) => {
        const project = projectById.get(chat.projectId)
        return [
          chat.id,
          {
            title: chat.title,
            projectName: project?.name ?? 'Project',
            color: resolveProjectColor(project ?? { id: chat.projectId })
          }
        ]
      })
    )
  }, [chats, projects])

  return (
    <div className="drag flex h-titlebar shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {openChatIds.map((id) => {
          const active = id === activeChatId
          const streaming = streams[id]?.status === 'streaming'
          const tab = tabs.get(id)
          const color = tab?.color ?? '#8E8E86'
          return (
            <div
              key={id}
              title={tab ? `${tab.projectName} · ${tab.title}` : 'Chat'}
              className={`relative flex h-8 max-w-[220px] items-center gap-1 overflow-hidden rounded-md border pl-3 pr-1 ${
                active
                  ? 'border-line bg-canvas text-ink'
                  : 'border-transparent text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              <span
                aria-hidden
                className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
                style={{ background: color, opacity: active ? 1 : 0.72 }}
              />
              <button className="flex min-w-0 items-center gap-2" onClick={() => onOpen(id)}>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${streaming ? 'streaming-dot' : ''}`}
                  style={{ background: color }}
                />
                <span className="truncate text-[12.5px]">{tab?.title ?? 'Chat'}</span>
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
        className="no-drag rounded-md px-2 py-1 text-[12px] text-muted hover:bg-raised hover:text-ink"
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
    <div className="flex flex-1 flex-col items-center justify-center px-10">
      <div className="w-full max-w-[640px]">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">GrokCode</div>
        <h1 className="font-display mt-3 text-[28px] font-semibold tracking-tight text-ink">
          Open a project, then start as many chats as you need.
        </h1>
        <p className="mt-3 max-w-lg text-[14px] leading-6 text-muted">
          Each project holds its own conversations. Chats keep generating when you switch tabs.
        </p>
        {projectId && (
          <div className="mt-8">
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
    </div>
  )
}

function MessageList({
  chat,
  projectId,
  index,
  draft,
  error,
  plan,
  checkpoints,
  canApprove,
  onApprove,
  onRewind
}: {
  chat: { messages: Message[] }
  projectId: string
  index: ProjectIndex | undefined
  draft: string
  error: string | null
  plan: ChatPlan | null
  checkpoints: Checkpoint[]
  canApprove: boolean
  onApprove: () => void
  onRewind: (checkpointId: string) => void
}): React.JSX.Element {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages, draft])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
      {chat.messages.length === 0 && !draft && !(plan && plan.entries.length > 0) ? (
        <div className="mx-auto max-w-[720px] pt-10">
          <ProjectOrientation projectId={projectId} index={index} />
          <div className="mt-6 text-[14px] text-muted">
            Ask Grok about this project. Other chats can keep running in the background.
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-[720px] flex-col gap-8">
          {chat.messages.map((message) => {
            const checkpoint = checkpoints.find((item) => item.messageId === message.id)
            return (
            <article key={message.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  {message.role === 'user' ? 'You' : 'Grok'}
                </div>
                {checkpoint && (
                  <button
                    type="button"
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-ink"
                    onClick={() => onRewind(checkpoint.id)}
                  >
                    Rewind
                  </button>
                )}
              </div>
              {message.role === 'user' ? (
                <div className="whitespace-pre-wrap text-[14.5px] leading-7 text-ink/90">
                  {message.content}
                </div>
              ) : (
                <Markdown text={message.content} />
              )}
              {message.mentions && message.mentions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {message.mentions.map((mention) => (
                    <MentionChip key={mention.path} mention={mention} />
                  ))}
                </div>
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
            )
          })}
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
          {plan && plan.entries.length > 0 && (
            <PlanCard plan={plan} canApprove={canApprove} onApprove={onApprove} />
          )}
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

const MODE_LABEL: Record<PermissionMode, string> = {
  ask: 'Ask',
  accept: 'Auto',
  plan: 'Plan'
}

const MODE_HINT: Record<PermissionMode, string> = {
  ask: 'Enter to send · Esc Esc rewind · tools wait for Allow',
  accept: 'Enter to send · Esc Esc rewind · tools auto-approved',
  plan: 'Enter to send · Esc Esc rewind · read-only until you approve'
}

function PlanMark({ status }: { status: PlanEntry['status'] }): React.JSX.Element {
  if (status === 'completed') return <span className="text-accent">✓</span>
  if (status === 'in_progress') return <span className="text-accent">→</span>
  return <span className="text-muted">○</span>
}

function PlanCard({
  plan,
  canApprove,
  onApprove
}: {
  plan: ChatPlan
  canApprove: boolean
  onApprove: () => void
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Plan</div>
          <div className="mt-0.5 text-[14px] font-medium text-ink">{plan.title}</div>
        </div>
        {canApprove && (
          <button
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px"
            onClick={onApprove}
          >
            Approve & implement
          </button>
        )}
      </div>
      {plan.entries.length > 0 && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {plan.entries.map((entry, index) => (
            <li
              key={`${index}:${entry.content}`}
              className={`flex gap-2 text-[13px] leading-5 ${
                entry.status === 'completed' ? 'text-muted line-through' : 'text-ink/90'
              }`}
            >
              <span className="w-4 shrink-0 text-center font-mono text-[11px]">
                <PlanMark status={entry.status} />
              </span>
              <span>{entry.content}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PermissionBar({
  request,
  onDecision
}: {
  request: PermissionRequest
  onDecision: (decision: 'allow' | 'deny') => void
}): React.JSX.Element {
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Permission</div>
      <div className="mt-1 text-[13.5px] text-ink">{request.title}</div>
      {request.detail && (
        <div className="mt-1 line-clamp-2 font-mono text-[11.5px] text-muted">{request.detail}</div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
          onClick={() => onDecision('deny')}
        >
          Deny
        </button>
        <button
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px"
          onClick={() => onDecision('allow')}
        >
          Allow
        </button>
      </div>
    </div>
  )
}

function ModeToggle({
  mode,
  onMode
}: {
  mode: PermissionMode
  onMode: (mode: PermissionMode) => void
}): React.JSX.Element {
  return (
    <div className="flex rounded-md bg-canvas p-0.5">
      {(['ask', 'accept', 'plan'] as const).map((item) => (
        <button
          key={item}
          type="button"
          className={`rounded px-2 py-1 text-[11px] ${
            mode === item ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
          }`}
          onClick={() => onMode(item)}
        >
          {MODE_LABEL[item]}
        </button>
      ))}
    </div>
  )
}

function recentsKey(projectId: string): string {
  return `grokcode.mentions.${projectId}`
}

function loadRecents(projectId: string): FileMention[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentsKey(projectId)) ?? '') as FileMention[]
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.path === 'string')
      : []
  } catch {
    return []
  }
}

function saveRecent(projectId: string, mention: FileMention): void {
  const next = [mention, ...loadRecents(projectId).filter((item) => item.path !== mention.path)].slice(
    0,
    12
  )
  localStorage.setItem(recentsKey(projectId), JSON.stringify(next))
}

function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null
  const query = before.slice(at + 1)
  if (query.includes('\n')) return null
  return { start: at, query }
}

function SlashLabel({ id, query }: { id: string; query: string }): React.JSX.Element {
  const q = query.toLowerCase()
  if (q && id.startsWith(q)) {
    return (
      <>
        /<span className="text-accent">{id.slice(0, q.length)}</span>
        {id.slice(q.length)}
      </>
    )
  }
  return <>/{id}</>
}

function MentionChip({
  mention,
  onRemove
}: {
  mention: FileMention
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink">
      <span className="truncate">
        {mention.path}
        {mention.kind === 'folder' ? '/' : ''}
      </span>
      {onRemove && (
        <button
          type="button"
          className="text-muted hover:text-ink"
          onClick={onRemove}
          aria-label={`Remove ${mention.path}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

function Composer({
  disabled,
  streaming,
  mode,
  permission,
  projectId,
  chatId,
  hasFolder,
  history,
  onSend,
  onSlash,
  onStop,
  onMode,
  onPermission,
  onRewindMenu
}: {
  disabled: boolean
  streaming: boolean
  mode: PermissionMode
  permission: PermissionRequest | null
  projectId: string
  chatId: string
  hasFolder: boolean
  history: string[]
  onSend: (text: string, attachments: Attachment[], mentions: FileMention[]) => void
  onSlash: (def: SlashDef, args: string, draft: { attachments: Attachment[]; mentions: FileMention[] }) => Promise<string | null>
  onStop: () => void
  onMode: (mode: PermissionMode) => void
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void
  onRewindMenu: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [mentions, setMentions] = useState<FileMention[]>([])
  const [hits, setHits] = useState<FileHit[]>([])
  const [hitIndex, setHitIndex] = useState(0)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [command, setCommand] = useState<{ start: number; query: string } | null>(null)
  const [cmdIndex, setCmdIndex] = useState(0)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')
  const lastEscAt = useRef(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const selectedCmd = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const commands = command ? filterSlashCommands(command.query) : []

  useEffect(() => {
    selectedCmd.current?.scrollIntoView({ block: 'nearest' })
  }, [cmdIndex, command?.query])

  useEffect(() => {
    if (command || !mention || !hasFolder) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const found = await window.grokcode.searchFiles(projectId, mention.query, chatId)
        if (cancelled) return
        const recents = loadRecents(projectId)
        const q = mention.query.toLowerCase()
        const recentHits: FileHit[] = recents
          .filter((item) => !q || item.path.toLowerCase().includes(q) || item.path.toLowerCase().split('/').pop()?.startsWith(q))
          .map((item) => ({
            path: item.path,
            name: item.path.split('/').pop() || item.path,
            kind: item.kind
          }))
        const seen = new Set(recentHits.map((item) => item.path))
        const merged = [...recentHits, ...found.filter((item) => !seen.has(item.path))].slice(0, 30)
        setHits(merged)
        setHitIndex(0)
      })()
    }, 60)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [chatId, hasFolder, mention, projectId])

  function syncTrigger(text: string, caret: number): void {
    const nextCommand = commandAt(text, caret)
    if (nextCommand) {
      setCommand(nextCommand)
      setCmdIndex(0)
      setMention(null)
      return
    }
    setCommand(null)
    setMention(mentionAt(text, caret))
  }

  function fillCommand(def: SlashDef): void {
    const caret = ref.current?.selectionStart ?? value.length
    const at = command ?? commandAt(value, caret)
    const token = completeSlash(def)
    const start = at?.start ?? 0
    const next = at ? value.slice(0, start) + token + value.slice(caret) : token
    setValue(next)
    setHistoryIndex(null)
    if (def.needsArgs) {
      setCommand(null)
    } else {
      setCommand({ start, query: def.id })
      setCmdIndex(0)
    }
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function runPicked(def: SlashDef, args: string): Promise<void> {
    setCommand(null)
    setHistoryIndex(null)
    if (def.needsArgs && !args) {
      setValue(`/${def.id} `)
      requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        el.focus()
        const pos = el.value.length
        el.setSelectionRange(pos, pos)
      })
      return
    }
    setValue('')
    const notice = await onSlash(def, args, { attachments, mentions })
    if (def.kind === 'prompt' || def.id === 'new' || def.id === 'delete') {
      setAttachments([])
      setMentions([])
    }
    if (notice) setPasteError(notice)
  }

  function pickHit(hit: FileHit): void {
    const current = ref.current
    const caret = current?.selectionStart ?? value.length
    const at = mentionAt(value, caret)
    const nextText = at ? value.slice(0, at.start) + value.slice(caret) : value
    const next: FileMention = { path: hit.path, kind: hit.kind }
    setMentions((existing) =>
      existing.some((item) => item.path === next.path) ? existing : [...existing, next]
    )
    saveRecent(projectId, next)
    setValue(nextText)
    setMention(null)
    setHits([])
    setHistoryIndex(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const pos = at ? at.start : nextText.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

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
    const parsed = parseSlashLine(value)
    if (parsed?.def) {
      void runPicked(parsed.def, parsed.args)
      return
    }
    const text = value.trim()
    if ((!text && attachments.length === 0 && mentions.length === 0) || disabled) return
    onSend(text, attachments, mentions)
    setValue('')
    setAttachments([])
    setMentions([])
    setMention(null)
    setCommand(null)
    setHits([])
    setPasteError(null)
    setHistoryIndex(null)
    draftRef.current = ''
  }

  return (
    <div className="px-10 pb-7">
      <div className="mx-auto max-w-[720px]">
        {permission && (
          <PermissionBar
            request={permission}
            onDecision={(decision) => onPermission(permission.requestId, decision)}
          />
        )}
      <div
        className={`rounded-2xl border bg-surface px-4 py-3 focus-within:border-accent/50 ${
          mode === 'plan' ? 'border-accent/40' : 'border-line'
        }`}
      >
        {(attachments.length > 0 || mentions.length > 0) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {mentions.map((item) => (
              <MentionChip
                key={item.path}
                mention={item}
                onRemove={() =>
                  setMentions((current) => current.filter((mention) => mention.path !== item.path))
                }
              />
            ))}
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
        <div className="relative">
        {command && (
          <div
            data-testid="slash-menu"
            className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-canvas py-1 shadow-xl"
          >
            {commands.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-muted">No matching commands</div>
            ) : (
              commands.map((item, index) => {
                const alias = matchedSlashAlias(item, command.query)
                return (
                <button
                  key={item.id}
                  ref={index === cmdIndex ? selectedCmd : undefined}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${
                    index === cmdIndex ? 'bg-raised' : 'hover:bg-surface'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    void runPicked(item, '')
                  }}
                >
                  <span className="shrink-0 font-mono text-[12px] text-ink">
                    <SlashLabel id={item.id} query={command.query} />
                    {alias && <span className="ml-2 text-muted">{alias}</span>}
                  </span>
                  <span className="truncate text-[11px] text-muted">
                    {item.kind === 'unavailable' ? `TUI only · ${item.hint}` : item.hint}
                  </span>
                </button>
                )
              })
            )}
          </div>
        )}
        {mention && hasFolder && !command && (
          <div className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-canvas py-1 shadow-xl">
            {hits.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-muted">
                {mention.query ? 'No matching files' : 'Type to search files'}
              </div>
            ) : (
              hits.map((hit, index) => (
                <button
                  key={`${hit.kind}:${hit.path}`}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${
                    index === hitIndex ? 'bg-raised' : 'hover:bg-surface'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pickHit(hit)
                  }}
                >
                  <span className="min-w-0 truncate font-mono text-[12px] text-ink">{hit.path}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted">
                    {hit.kind === 'folder' ? 'folder' : 'file'}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        <textarea
          ref={ref}
          rows={3}
          value={value}
          disabled={disabled}
          placeholder={
            mode === 'plan'
              ? 'Plan with Grok…  @ files · reads only until you approve'
              : 'Ask Grok…  @ a file · / commands · ⌘V pastes a screenshot'
          }
          className="w-full resize-none bg-transparent text-[14.5px] leading-6 text-ink outline-none placeholder:text-muted disabled:opacity-60"
          onChange={(event) => {
            setValue(event.target.value)
            setHistoryIndex(null)
            syncTrigger(event.target.value, event.target.selectionStart)
          }}
          onClick={(event) => syncTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyUp={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              syncTrigger(event.currentTarget.value, event.currentTarget.selectionStart)
            }
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
            if (command && commands.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCmdIndex((current) => (current + 1) % commands.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCmdIndex((current) => (current - 1 + commands.length) % commands.length)
                return
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                fillCommand(commands[cmdIndex] ?? commands[0])
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                void runPicked(commands[cmdIndex] ?? commands[0], '')
                return
              }
            }
            if (mention && hits.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHitIndex((current) => (current + 1) % hits.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHitIndex((current) => (current - 1 + hits.length) % hits.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                pickHit(hits[hitIndex] ?? hits[0])
                return
              }
            }
            if (event.key === 'Backspace' && mentions.length > 0) {
              const el = event.currentTarget
              if (el.selectionStart === 0 && el.selectionEnd === 0) {
                event.preventDefault()
                setMentions((current) => current.slice(0, -1))
                return
              }
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              if (command) {
                setCommand(null)
                lastEscAt.current = 0
                return
              }
              if (mention) {
                setMention(null)
                setHits([])
                lastEscAt.current = 0
                return
              }
              if (streaming) {
                onStop()
                lastEscAt.current = 0
                return
              }
              const at = Date.now()
              if (at - lastEscAt.current < 700) {
                lastEscAt.current = 0
                onRewindMenu()
                return
              }
              lastEscAt.current = at
              return
            }
            if (event.key === 'Tab' && event.shiftKey) {
              event.preventDefault()
              onMode(nextPermissionMode(mode))
              return
            }
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
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ModeToggle mode={mode} onMode={onMode} />
            <div className="truncate font-mono text-[10px] text-muted">
              {pasteError ?? MODE_HINT[mode]}
            </div>
          </div>
          {streaming ? (
            <button
              className="shrink-0 rounded-md bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-line active:translate-y-px"
              onClick={onStop}
            >
              Stop
            </button>
          ) : (
            <button
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:opacity-40"
              disabled={!value.trim() && attachments.length === 0 && mentions.length === 0}
              onClick={submit}
            >
              Send
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

function rewindClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function RewindModal({
  checkpoints,
  selectedId,
  busy,
  onSelect,
  onClose,
  onRewind
}: {
  checkpoints: Checkpoint[]
  selectedId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onClose: () => void
  onRewind: () => void
}): React.JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-overlay"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="w-[440px] rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-[15px] font-semibold tracking-tight">Rewind</div>
        <p className="mt-1 text-[12.5px] text-muted">
          Restores files to that turn and drops later messages.
        </p>
        {checkpoints.length === 0 ? (
          <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-3 text-[12.5px] text-muted">
            No checkpoints yet. Send a message so Grok can snapshot the tree first.
          </div>
        ) : (
          <div className="mt-4 max-h-[320px] overflow-y-auto rounded-lg border border-line">
            {checkpoints.map((item) => {
              const active = item.id === selectedId
              const extra =
                item.files.length > 0
                  ? `${item.files.length} file${item.files.length === 1 ? '' : 's'}`
                  : item.kind === 'git'
                    ? 'Full tree'
                    : 'Chat only'
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-start justify-between gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 ${
                    active ? 'bg-raised' : 'hover:bg-canvas'
                  }`}
                  onClick={() => onSelect(item.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink">{item.label}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted">
                      {extra} · {item.kind === 'git' ? 'git' : 'files'}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-[10px] text-muted">
                    {rewindClock(item.createdAt)}
                  </div>
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-2 text-[12px] text-muted hover:text-ink"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px disabled:opacity-40"
            disabled={busy || !selectedId}
            onClick={onRewind}
          >
            {busy ? 'Rewinding…' : 'Rewind to here'}
          </button>
        </div>
      </div>
    </div>
  )
}
