import { useState } from 'react'
import { useWorkspace } from '../workspace'
import { ThemeEditor } from './ThemeEditor'

export function NewProjectModal(): React.JSX.Element | null {
  const { showNewProject, setShowNewProject, createProject, pickFolder } = useWorkspace()
  const [name, setName] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!showNewProject) return null

  async function chooseFolder(): Promise<void> {
    const next = await pickFolder()
    if (!next) return
    setPath(next)
    if (!name.trim()) {
      const parts = next.split(/[/\\]/)
      setName(parts.at(-1) || '')
    }
  }

  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await createProject(name, path)
      setName('')
      setPath(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-overlay">
      <div className="w-[420px] rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="text-[15px] font-semibold tracking-tight">New project</div>
        <p className="mt-1 text-[12.5px] text-muted">
          A project groups chats. Attach a local folder now, or leave it empty.
        </p>
        <label className="mt-4 block text-[12px] text-muted">Name</label>
        <input
          autoFocus
          data-testid="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent/60"
          placeholder="Campaign Canvas"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
        <label className="mt-4 block text-[12px] text-muted">Folder</label>
        <div className="mt-1 flex gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[12px] text-muted">
            {path ?? 'Optional'}
          </div>
          <button
            className="rounded-lg border border-line px-3 py-2 text-[12px] hover:bg-raised"
            onClick={() => void chooseFolder()}
          >
            Browse
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-2 text-[12px] text-muted hover:text-ink"
            onClick={() => setShowNewProject(false)}
          >
            Cancel
          </button>
          <button
            data-testid="create-project"
            className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px disabled:opacity-40"
            disabled={busy || (!name.trim() && !path)}
            onClick={() => void submit()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

const SUPPORT_URL = 'https://buymeacoffee.com/datapad'

function CoffeeIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9h13v6.2A4.8 4.8 0 0 1 12.2 20H8.8A4.8 4.8 0 0 1 4 15.2V9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M17 10.2h1.4a2.8 2.8 0 1 1 0 5.6H17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M4 21.2h12.2M8 4.4c.25.9.25 1.8 0 2.7M11.2 4.4c.25.9.25 1.8 0 2.7M14.4 4.4c.25.9.25 1.8 0 2.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SettingsModal(): React.JSX.Element | null {
  const { showSettings, setShowSettings, settings, saveSettings } = useWorkspace()
  const [tab, setTab] = useState<'general' | 'appearance'>('general')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.model ?? 'grok-4.6')
  const [saved, setSaved] = useState(false)

  if (!showSettings || !settings) return null

  async function submit(): Promise<void> {
    await saveSettings({
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      model
    })
    setApiKey('')
    setSaved(true)
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-overlay">
      <div
        className={`flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xl ${
          tab === 'appearance' ? 'h-[86vh] w-[880px]' : 'w-[460px]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Settings</div>
          </div>
          <div className="flex rounded-md bg-canvas p-0.5">
            <button
              className={`rounded px-2.5 py-1 text-[11px] ${
                tab === 'general' ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setTab('general')}
            >
              General
            </button>
            <button
              data-testid="settings-appearance"
              className={`rounded px-2.5 py-1 text-[11px] ${
                tab === 'appearance' ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setTab('appearance')}
            >
              Appearance
            </button>
          </div>
        </div>

        {tab === 'general' ? (
          <>
            <p className="mt-1 text-[12.5px] leading-5 text-muted">
              Chats run through Grok Build on your machine. Sign in once with `grok login`
              (SuperGrok). Existing Grok Build sessions for a folder show up in that project.
            </p>
            <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-muted">
              {settings.grokBuildSignedIn
                ? 'Grok Build is signed in. New chats continue as real Grok sessions.'
                : settings.hasKey
                  ? `Fallback API key (${settings.keySource}): ${settings.keyPreview}`
                  : 'Not signed in. Run grok login in a terminal.'}
            </div>
            <label className="mt-4 block text-[12px] text-muted">API key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setSaved(false)
              }}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] outline-none focus:border-accent/60"
              placeholder="xai-…"
            />
            <label className="mt-4 block text-[12px] text-muted">Model</label>
            <input
              value={model}
              onChange={(event) => {
                setModel(event.target.value)
                setSaved(false)
              }}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] outline-none focus:border-accent/60"
            />
            <div className="mt-5 rounded-lg border border-line bg-canvas px-3 py-3">
              <div className="text-[12px] font-medium text-ink">Support</div>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                GrokCode is free. If it helps your work, you can buy me a coffee.
              </p>
              <button
                type="button"
                data-testid="settings-support"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12px] font-medium text-ink hover:bg-surface active:translate-y-px"
                onClick={() => {
                  void window.grokcode.openExternal(SUPPORT_URL)
                }}
              >
                <CoffeeIcon />
                Buy me a coffee
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-2 text-[12px] text-muted hover:text-ink"
                onClick={() => setShowSettings(false)}
              >
                Close
              </button>
              <button
                className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px"
                onClick={() => void submit()}
              >
                {saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 shrink-0 text-[12.5px] leading-5 text-muted">
              Switch a built-in look, or edit every surface, typeface, and radius. Save as a theme
              file you can load later.
            </p>
            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
              <ThemeEditor />
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-lg px-3 py-2 text-[12px] text-muted hover:text-ink"
                onClick={() => setShowSettings(false)}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
