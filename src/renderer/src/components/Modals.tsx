import { useEffect, useState } from 'react'
import { DEFAULT_VOICE, type UsageSnapshot, type VoiceModelStatus } from '../../../shared/types'
import { useVoice } from '../voice/VoiceProvider'
import { listMicInputs, listVoices, primeTtsOutput, speakText, type MicInput } from '../voice/engine'
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

function MicAccessRow(): React.JSX.Element {
  const [status, setStatus] = useState<'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'>(
    'not-determined'
  )
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      setStatus(await window.grokcode.getMicAccess())
    } catch {
      // preload from an older session
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const ok = status === 'granted'
  const blocked = status === 'denied' || status === 'restricted'

  async function requestAccess(): Promise<void> {
    setBusy(true)
    setNote(null)
    try {
      await window.grokcode.ensureMic().catch(() => false)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      await refresh()
      setStatus('granted')
      setNote('Microphone is on.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not access the microphone'
      setNote(message)
      await refresh()
      try {
        await window.grokcode.openMicSettings()
      } catch {
        setNote(`${message} Enable Grok Build Workbench in System Settings → Privacy & Security → Microphone.`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 text-[12px]">
      <div>
        <div className="font-medium text-ink">Microphone access</div>
        <p className="mt-0.5 text-[11px] leading-4 text-muted">
          {ok
            ? 'Allowed. Pick a device below.'
            : blocked
              ? 'Blocked in macOS. Enable Grok Build Workbench under Privacy & Security → Microphone.'
              : 'macOS only prompts from a click. Use the button — check behind this window if nothing appears.'}
        </p>
        {note && <p className="mt-1 text-[11px] leading-4 text-ink">{note}</p>}
      </div>
      <button
        type="button"
        disabled={busy}
        className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] hover:bg-raised disabled:opacity-60"
        onClick={() => {
          if (blocked) {
            void window.grokcode.openMicSettings()
            return
          }
          void requestAccess()
        }}
      >
        {busy ? 'Asking…' : blocked ? 'Open System Settings' : 'Request access'}
      </button>
    </div>
  )
}

function MicPicker({
  value,
  onChange
}: {
  value: string
  onChange: (deviceId: string) => void
}): React.JSX.Element {
  const [mics, setMics] = useState<MicInput[]>([])
  const [picked, setPicked] = useState(value)

  useEffect(() => {
    setPicked(value)
  }, [value])

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      await window.grokcode.ensureMic()
      const next = await listMicInputs()
      if (!cancelled) setMics(next)
    }
    void load()
    function onDevices(): void {
      void load()
    }
    navigator.mediaDevices.addEventListener('devicechange', onDevices)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', onDevices)
    }
  }, [])

  const known = mics.some((item) => item.deviceId === picked)

  return (
    <label className="block text-[12px] text-muted">
      Microphone
      <select
        className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] text-ink outline-none"
        value={picked}
        onChange={(event) => {
          const next = event.target.value
          setPicked(next)
          onChange(next)
        }}
      >
        <option value="">System default</option>
        {mics.map((item) => (
          <option key={item.deviceId} value={item.deviceId}>
            {item.label}
          </option>
        ))}
        {picked && !known && <option value={picked}>Selected microphone</option>}
      </select>
    </label>
  )
}

function voiceModelHint(voiceModel: VoiceModelStatus): string {
  if (voiceModel.downloading) return `Downloading speech model… ${voiceModel.file ?? ''}`
  if (voiceModel.ready) return 'Local speech model ready'
  if (voiceModel.error) return voiceModel.error
  return 'Will download local Whisper + TTS (~400MB) once, then stay offline'
}

function Toggle({
  on,
  onClick,
  label
}: {
  on: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-line'}`}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-accent-ink transition"
        style={{ left: on ? 18 : 2 }}
      />
    </button>
  )
}

export function SettingsModal(): React.JSX.Element | null {
  const { showSettings, setShowSettings, settings, saveSettings } = useWorkspace()
  const { model: voiceModel } = useVoice()
  const [tab, setTab] = useState<'general' | 'appearance'>('general')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.model ?? 'grok-4.6')
  const [saved, setSaved] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const voices = listVoices()
  const voice = settings?.voice ?? DEFAULT_VOICE

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
          tab === 'appearance' ? 'h-[86vh] w-[880px]' : 'max-h-[86vh] w-[460px] overflow-y-auto'
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
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium text-ink">Voice</div>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    Talk to Grok on this machine. Listening uses a local Whisper model. Replies use
                    your system voice. Audio never leaves the computer.
                  </p>
                </div>
                <Toggle
                  label="Enable voice"
                  on={voice.enabled}
                  onClick={() => {
                    const next = !voice.enabled
                    void saveSettings({ voice: { enabled: next } })
                    if (next) {
                      void window.grokcode.ensureMic()
                      void window.grokcode.ensureVoiceModel()
                    }
                  }}
                />
              </div>
              {voice.enabled && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <MicAccessRow />
                  <label className="flex items-center justify-between gap-3 text-[12px] text-ink">
                    <span>
                      Conversation mode
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                        Show the Conversation button in the chat. That button starts a live voice
                        loop: listen, send as you talk, speak replies, interrupt.
                      </span>
                    </span>
                    <Toggle
                      label="Conversation mode"
                      on={voice.conversation}
                      onClick={() => {
                        const next = !voice.conversation
                        void saveSettings({
                          voice: next
                            ? { conversation: true, speakReplies: true, autoSend: true }
                            : { conversation: false }
                        })
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-[12px] text-ink">
                    Speak replies
                    <Toggle
                      label="Speak replies"
                      on={voice.speakReplies}
                      onClick={() => void saveSettings({ voice: { speakReplies: !voice.speakReplies } })}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-[12px] text-ink">
                    Send after I stop talking
                    <Toggle
                      label="Send after I stop talking"
                      on={voice.autoSend}
                      onClick={() => void saveSettings({ voice: { autoSend: !voice.autoSend } })}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-[12px] text-ink">
                    Keep listening after replies
                    <Toggle
                      label="Keep listening after replies"
                      on={voice.handsFree}
                      onClick={() => void saveSettings({ voice: { handsFree: !voice.handsFree } })}
                    />
                  </label>
                  <MicPicker
                    value={voice.micDeviceId}
                    onChange={(deviceId) => void saveSettings({ voice: { micDeviceId: deviceId } })}
                  />
                  <label className="block text-[12px] text-muted">
                    Voice
                    <select
                      className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] text-ink outline-none"
                      value={voice.voiceURI}
                      onChange={(event) => void saveSettings({ voice: { voiceURI: event.target.value } })}
                    >
                      {voices.map((item) => (
                        <option key={item.voiceURI} value={item.voiceURI}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[12px] text-muted">
                    Speed
                    <input
                      type="range"
                      min={0.7}
                      max={2}
                      step={0.05}
                      value={voice.rate}
                      className="mt-1 w-full"
                      onChange={(event) =>
                        void saveSettings({ voice: { rate: Number(event.target.value) } })
                      }
                    />
                  </label>
                  {testError && (
                    <p className="text-[11px] leading-4 text-red-400">{testError}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] leading-4 text-muted">
                      {voiceModelHint(voiceModel)}
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] hover:bg-raised"
                      onClick={() => {
                        setTestError(null)
                        primeTtsOutput()
                        void speakText(
                          'Voice is on. Grok Build Workbench will listen and reply on this machine.',
                          voice
                        ).catch((err) => {
                          setTestError(err instanceof Error ? err.message : 'Could not play a test clip')
                        })
                      }}
                    >
                      Test
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-5 rounded-lg border border-line bg-canvas px-3 py-3">
              <div className="text-[12px] font-medium text-ink">Support</div>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                Grok Build Workbench is free. If it helps your work, you can buy me a coffee.
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

const USAGE_URL = 'https://grok.com/?_s=usage'

function formatReset(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

function periodLabel(period: UsageSnapshot['period']): string {
  if (period === 'weekly') return 'Weekly limit'
  if (period === 'monthly') return 'Monthly limit'
  return 'Usage limit'
}

export function UsageModal(): React.JSX.Element | null {
  const { showUsage, setShowUsage } = useWorkspace()
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!showUsage) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.grokcode
      .getUsage()
      .then((next) => {
        if (cancelled) return
        setUsage(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setUsage(null)
        setError(err instanceof Error ? err.message : 'Could not load usage')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showUsage])

  useEffect(() => {
    if (!showUsage) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setShowUsage(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showUsage, setShowUsage])

  if (!showUsage) return null

  const used = usage?.usedPercent
  const left = used === null || used === undefined ? null : Math.max(0, Math.round(100 - used))
  const reset = formatReset(usage?.periodEnd ?? null)
  const bar = used === null || used === undefined ? 0 : Math.round(used)
  const hot = bar >= 90
  const showCredits = (usage?.prepaidBalance ?? 0) > 0
  const showOnDemand = (usage?.onDemandCap ?? 0) > 0

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-overlay">
      <div className="w-[420px] rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="text-[15px] font-semibold tracking-tight">Usage</div>
        <p className="mt-1 text-[12.5px] text-muted">
          {usage?.tier ?? (loading ? 'Loading subscription limits' : 'Grok Build allowance')}
        </p>

        {loading ? (
          <p className="mt-4 text-[12.5px] text-muted">Loading usage…</p>
        ) : error ? (
          <p className="mt-4 text-[12.5px] text-ink">{error}</p>
        ) : !usage || usage.usedPercent === null ? (
          <p className="mt-4 text-[12.5px] text-ink">Couldn&apos;t load usage.</p>
        ) : (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[12px] text-muted">{periodLabel(usage.period)}</div>
              <div className="text-[13px] font-medium tabular-nums text-ink">{bar}% used</div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full ${hot ? 'bg-red-400' : 'bg-accent'}`}
                style={{ width: `${bar}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
              {left !== null && <span>{left}% left</span>}
              {reset && <span>Next reset: {reset}</span>}
            </div>
            {showCredits && (
              <div className="mt-3 text-[12px] text-ink">
                Credits: {money(usage.prepaidBalance ?? 0)}
              </div>
            )}
            {showOnDemand && (
              <div className="mt-1 text-[12px] text-ink">
                Pay-as-you-go: {money(usage.onDemandUsed ?? 0)} used of {money(usage.onDemandCap ?? 0)}{' '}
                limit
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-2 text-[12px] text-muted hover:text-ink"
            onClick={() => setShowUsage(false)}
          >
            Close
          </button>
          <button
            className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px"
            onClick={() => void window.grokcode.openExternal(USAGE_URL)}
          >
            Manage billing
          </button>
        </div>
      </div>
    </div>
  )
}
