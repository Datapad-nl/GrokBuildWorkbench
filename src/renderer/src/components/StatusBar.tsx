import { useEffect, useState } from 'react'
import { useWorkspace } from '../workspace'

const USAGE_REFRESH_MS = 5 * 60 * 1000

function UsageIcon({ percent }: { percent: number | null }): React.JSX.Element {
  const used = percent == null ? null : Math.min(100, Math.max(0, percent))
  const r = 5.2
  const c = 2 * Math.PI * r
  const dash = used == null ? 0 : (used / 100) * c
  const hot = (used ?? 0) >= 90
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r={r} stroke="currentColor" strokeWidth="1.6" opacity="0.28" />
      {used != null && (
        <circle
          cx="8"
          cy="8"
          r={r}
          stroke={hot ? 'var(--color-danger)' : 'currentColor'}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
  )
}

export function StatusBar(): React.JSX.Element {
  const { showUsage, setShowUsage } = useWorkspace()
  const [percent, setPercent] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      if (!window.grokcode.getUsage) return
      try {
        const next = await window.grokcode.getUsage()
        if (!cancelled) setPercent(next.usedPercent)
      } catch {
        if (!cancelled) setPercent(null)
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, USAGE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [showUsage])

  const label =
    percent == null ? 'Usage' : `Usage · ${Math.round(percent)}% used`

  return (
    <footer className="drag flex h-8 shrink-0 items-center border-t border-line bg-surface px-2">
      <div className="no-drag flex items-center">
        <button
          type="button"
          data-testid="open-usage"
          className={`flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] hover:bg-raised hover:text-ink active:scale-95 ${
            showUsage ? 'bg-raised text-ink' : 'text-muted'
          }`}
          title={label}
          aria-label={label}
          aria-expanded={showUsage}
          onClick={() => setShowUsage(!showUsage)}
        >
          <UsageIcon percent={percent} />
          <span>Usage</span>
        </button>
      </div>
    </footer>
  )
}
