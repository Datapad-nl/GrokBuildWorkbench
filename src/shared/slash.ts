export type SlashKind = 'local' | 'prompt' | 'unavailable'

export type SlashDef = {
  id: string
  aliases?: string[]
  hint: string
  kind: SlashKind
  prompt?: string
  needsArgs?: boolean
}

export type ParsedSlash = {
  id: string
  args: string
  def: SlashDef
}

export const SLASH_COMMANDS: SlashDef[] = [
  { id: 'new', aliases: ['clear', 'clean'], hint: 'New chat in this project', kind: 'local' },
  { id: 'rewind', aliases: ['undo'], hint: 'Rewind files and later messages', kind: 'local' },
  { id: 'plan', hint: 'Switch to plan mode', kind: 'local' },
  { id: 'ask', hint: 'Switch to ask mode', kind: 'local' },
  {
    id: 'always-approve',
    aliases: ['auto'],
    hint: 'Switch to auto-approve tools',
    kind: 'local'
  },
  { id: 'commit', hint: 'Commit the current changes', kind: 'prompt', prompt:
      'Commit the current changes. Inspect the git status and diff, write a clear commit message, and create the commit. Do not push.' },
  { id: 'review', hint: 'Review the current changes', kind: 'prompt', prompt:
      'Review the current uncommitted changes. Point out bugs, regressions, and missing tests. Do not edit files unless I ask.' },
  { id: 'compact', hint: 'Compress conversation history', kind: 'prompt', prompt:
      'Compact this conversation. Keep decisions, file paths, and unfinished work. Drop recovered dead ends.' },
  { id: 'copy', hint: 'Copy the latest reply', kind: 'local' },
  { id: 'export', hint: 'Copy the conversation as Markdown', kind: 'local' },
  { id: 'rename', aliases: ['title'], hint: 'Rename this chat', kind: 'local', needsArgs: true },
  { id: 'delete', hint: 'Delete this chat', kind: 'local' },
  { id: 'model', aliases: ['m'], hint: 'Set the model', kind: 'local', needsArgs: true },
  { id: 'settings', aliases: ['config', 'preferences', 'prefs'], hint: 'Open settings', kind: 'local' },
  { id: 'theme', aliases: ['t'], hint: 'Open appearance settings', kind: 'local' },
  { id: 'docs', aliases: ['howto', 'guides'], hint: 'Open Grok Build docs', kind: 'local' },
  { id: 'usage', aliases: ['cost'], hint: 'Show usage / billing', kind: 'local' },
  { id: 'login', hint: 'Sign-in help', kind: 'local' },
  { id: 'logout', hint: 'Sign-out help', kind: 'local' },
  { id: 'quit', aliases: ['exit'], hint: 'Quit Grok Build Workbench', kind: 'local' },
  {
    id: 'transcribe',
    aliases: ['yt', 'youtube'],
    hint: 'Transcribe a YouTube video',
    kind: 'prompt',
    needsArgs: true,
    prompt:
      'Transcribe this YouTube video with the transcribe_youtube tool. Return a readable transcript. URL or video id:'
  },
  { id: 'imagine', hint: 'Generate an image', kind: 'prompt', needsArgs: true, prompt: 'Generate an image:' },
  { id: 'imagine-video', hint: 'Generate a video', kind: 'prompt', needsArgs: true, prompt: 'Generate a video:' },
  { id: 'remember', hint: 'Save a note to memory', kind: 'prompt', needsArgs: true, prompt: 'Remember this for later:' },
  { id: 'loop', hint: 'Run a prompt on an interval', kind: 'prompt', needsArgs: true, prompt:
      'Set up a recurring task with the scheduler. Interval and prompt:' },
  { id: 'goal', hint: 'Set or manage an autonomous goal', kind: 'prompt', prompt: 'Manage this goal:' },
  { id: 'deep-research', hint: 'Start a research workflow', kind: 'prompt', needsArgs: true, prompt:
      'Start a deep-research workflow:' },
  { id: 'workflow', hint: 'Launch or control a workflow', kind: 'prompt', needsArgs: true, prompt:
      'Run or manage this workflow:' },
  { id: 'workflows', hint: 'List workflow runs', kind: 'prompt', prompt:
      'List active and recent workflow runs and their status.' },
  { id: 'btw', hint: 'Ask a side question without steering the task', kind: 'prompt', needsArgs: true, prompt:
      'Side question — answer this without dropping the main task:' },
  { id: 'feedback', hint: 'Send feedback', kind: 'prompt', prompt: 'User feedback about Grok Build Workbench / Grok Build:' },
  { id: 'doctor', hint: 'Diagnose this session', kind: 'prompt', prompt:
      'Diagnose this Grok Build Workbench / Grok Build session: auth, model, folder, and anything that looks broken. Suggest fixes. Do not edit files.' },
  { id: 'memory', aliases: ['mem'], hint: 'Browse or toggle memory', kind: 'prompt', prompt:
      'Show or manage cross-session memory for this project.' },
  { id: 'flush', hint: 'Save this session into memory now', kind: 'prompt', prompt:
      'Flush the important facts from this session into memory now.' },
  { id: 'dream', hint: 'Consolidate memory', kind: 'prompt', prompt:
      'Run memory consolidation. Merge session notes into organized topics.' },
  { id: 'view-plan', aliases: ['show-plan', 'plan-view'], hint: 'Show the current plan', kind: 'local' },
  { id: 'session-info', aliases: ['status', 'info'], hint: 'Show session details', kind: 'local' },
  { id: 'context', hint: 'Show context-window use', kind: 'unavailable' },
  { id: 'resume', hint: 'Reload a previous session', kind: 'unavailable' },
  { id: 'dashboard', aliases: ['agents-dashboard', 'sessions'], hint: 'Agent dashboard', kind: 'unavailable' },
  { id: 'fork', hint: 'Branch this session', kind: 'unavailable' },
  { id: 'edit-prompt', hint: 'Edit the draft in $EDITOR', kind: 'unavailable' },
  { id: 'home', aliases: ['welcome'], hint: 'Return to the welcome screen', kind: 'unavailable' },
  { id: 'effort', hint: 'Set reasoning effort', kind: 'unavailable' },
  { id: 'multiline', aliases: ['ml'], hint: 'Toggle multiline Enter', kind: 'unavailable' },
  { id: 'history', hint: 'Search prompt history', kind: 'unavailable' },
  { id: 'compact-mode', hint: 'Toggle compact display', kind: 'unavailable' },
  { id: 'vim-mode', hint: 'Toggle vim scrollback keys', kind: 'unavailable' },
  { id: 'minimal', hint: 'Switch to minimal TUI', kind: 'unavailable' },
  { id: 'fullscreen', aliases: ['full'], hint: 'Switch to fullscreen TUI', kind: 'unavailable' },
  { id: 'hooks', hint: 'Manage hooks', kind: 'unavailable' },
  { id: 'plugins', hint: 'Manage plugins', kind: 'unavailable' },
  { id: 'marketplace', hint: 'Open the plugin marketplace', kind: 'unavailable' },
  { id: 'skills', hint: 'Manage skills', kind: 'unavailable' },
  { id: 'mcps', hint: 'Manage MCP servers', kind: 'unavailable' },
  { id: 'tutorial', aliases: ['tour', 'onboarding'], hint: 'Open the onboarding tutorial', kind: 'unavailable' },
  { id: 'import-claude', hint: 'Import ~/.claude settings', kind: 'unavailable' },
  { id: 'config-agents', aliases: ['agents'], hint: 'Manage agent definitions', kind: 'unavailable' },
  { id: 'personas', hint: 'Manage personas', kind: 'unavailable' },
  { id: 'privacy', hint: 'Coding data and training', kind: 'unavailable' },
  { id: 'timestamps', hint: 'Toggle message timestamps', kind: 'unavailable' },
  { id: 'release-notes', aliases: ['changelog'], hint: 'View release notes', kind: 'unavailable' }
]

const BY_NAME = new Map<string, SlashDef>()
for (const def of SLASH_COMMANDS) {
  BY_NAME.set(def.id, def)
  for (const alias of def.aliases ?? []) BY_NAME.set(alias, def)
}

export function slashByName(name: string): SlashDef | null {
  return BY_NAME.get(name.toLowerCase()) ?? null
}

export function parseSlashLine(text: string): { raw: string; name: string; args: string; def: SlashDef | null } | null {
  const line = text.trim()
  if (!line.startsWith('/')) return null
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(line)
  if (!match) return null
  const name = match[1].toLowerCase()
  const args = (match[2] ?? '').trim()
  return { raw: line, name, args, def: slashByName(name) }
}

export function commandAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const lineStart = before.lastIndexOf('\n') + 1
  const line = before.slice(lineStart)
  const match = /^\/([^\s]*)$/.exec(line)
  if (!match) return null
  return { start: lineStart, query: match[1] }
}

function isSubsequence(hay: string, needle: string): boolean {
  let i = 0
  for (let h = 0; h < hay.length && i < needle.length; h++) {
    if (hay[h] === needle[i]) i++
  }
  return i === needle.length
}

function slashScore(item: SlashDef, q: string): number {
  if (!q) return item.kind === 'unavailable' ? 100 : 0
  const aliases = item.aliases ?? []
  let score = -1
  if (item.id === q) score = 0
  else if (item.id.startsWith(q)) score = 1
  else if (aliases.some((alias) => alias === q)) score = 2
  else if (aliases.some((alias) => alias.startsWith(q))) score = 3
  else if (item.id.includes(q)) score = 4
  else if (aliases.some((alias) => alias.includes(q))) score = 5
  else if (q.length >= 2 && isSubsequence(item.id, q)) score = 6
  else if (q.length >= 2 && aliases.some((alias) => isSubsequence(alias, q))) score = 7
  else if (item.hint.toLowerCase().includes(q)) score = 8
  if (score < 0) return -1
  return item.kind === 'unavailable' ? score + 20 : score
}

export function filterSlashCommands(query: string): SlashDef[] {
  const q = query.toLowerCase()
  const ranked = SLASH_COMMANDS.map((item, index) => ({
    item,
    index,
    score: slashScore(item, q)
  })).filter((row) => row.score >= 0)
  ranked.sort((a, b) => a.score - b.score || a.index - b.index)
  return ranked.map((row) => row.item)
}

export function matchedSlashAlias(item: SlashDef, query: string): string | null {
  const q = query.toLowerCase()
  if (!q || item.id === q || item.id.startsWith(q) || item.id.includes(q)) return null
  return (item.aliases ?? []).find((alias) => alias === q || alias.startsWith(q) || alias.includes(q)) ?? null
}

export function completeSlash(def: SlashDef): string {
  return def.needsArgs ? `/${def.id} ` : `/${def.id}`
}
