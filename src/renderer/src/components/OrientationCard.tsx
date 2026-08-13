import { useEffect, useState } from 'react'
import type { IndexState, OrientationCard as OrientationCardData, ProjectIndex } from '../../../shared/types'
import { useWorkspace } from '../workspace'

function stateLabel(state: IndexState): string {
  switch (state) {
    case 'indexed':
      return 'Indexed'
    case 'indexing':
      return 'Indexing'
    case 'installing':
      return 'Installing Codegraph'
    case 'not-indexed':
      return 'Not indexed'
    case 'missing-cli':
      return 'Codegraph missing'
    case 'no-folder':
      return 'No folder'
    case 'error':
      return 'Index error'
  }
}

function canIndex(state: IndexState | undefined): boolean {
  return state === 'not-indexed' || state === 'missing-cli' || state === 'error'
}

function indexAction(state: IndexState | undefined): string {
  if (state === 'missing-cli') return 'Install & index'
  if (state === 'error') return 'Retry'
  return 'Create index'
}

export function IndexStatus({
  projectId,
  compact
}: {
  projectId: string
  compact?: boolean
}): React.JSX.Element | null {
  const { indexes, indexProject, projects } = useWorkspace()
  const project = projects.find((item) => item.id === projectId)
  const index = indexes[projectId]
  const state = index?.state ?? (project?.path ? 'not-indexed' : 'no-folder')
  if (state === 'no-folder') return null

  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'mt-1'}`}>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          state === 'indexed'
            ? 'bg-accent'
            : state === 'indexing' || state === 'installing'
              ? 'streaming-dot bg-accent'
              : state === 'error' || state === 'missing-cli'
                ? 'bg-danger'
                : 'bg-line'
        }`}
      />
      <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
        {stateLabel(state)}
        {state === 'indexed' && index?.fileCount != null ? ` · ${index.fileCount}` : ''}
      </span>
      {canIndex(state) && (
        <button
          data-testid="create-index"
          className="rounded px-1.5 py-0.5 text-[9px] text-muted hover:bg-canvas hover:text-ink"
          onClick={() => void indexProject(projectId)}
        >
          {indexAction(state)}
        </button>
      )}
    </div>
  )
}

export function ProjectOrientation({
  projectId,
  index
}: {
  projectId: string
  index?: ProjectIndex
}): React.JSX.Element {
  const { getOrientation, indexProject } = useWorkspace()
  const [card, setCard] = useState<OrientationCardData | null>(null)

  useEffect(() => {
    let cancelled = false
    void getOrientation(projectId).then((next) => {
      if (!cancelled) setCard(next)
    })
    return () => {
      cancelled = true
    }
  }, [getOrientation, projectId, index?.state, index?.fileCount, index?.nodeCount])

  const state = card?.state ?? index?.state ?? 'not-indexed'
  const stats = [
    card?.fileCount != null ? `${card.fileCount} files` : null,
    card?.nodeCount != null ? `${card.nodeCount} symbols` : null,
    card?.languages.length ? card.languages.join(', ') : null
  ].filter(Boolean)

  return (
    <div
      data-testid="orientation-card"
      className="select-text rounded-2xl border border-line bg-surface px-5 py-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Project</div>
          <div className="font-display mt-1 text-[16px] font-semibold tracking-tight text-ink">
            {card?.name ?? 'Project'}
          </div>
        </div>
        <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {stateLabel(state)}
        </div>
      </div>
      {card?.stack && <div className="mt-1 text-[13px] text-ink/80">{card.stack}</div>}
      {card?.summary && <p className="mt-2 text-[13px] leading-5 text-muted">{card.summary}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        {stats.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {card?.rulesFile && <span>Rules: {card.rulesFile}</span>}
      </div>
      {card?.tree && (
        <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-5 text-ink/70">
          {card.tree}
        </pre>
      )}
      {card?.error && <div className="mt-3 text-[12px] text-danger">{card.error}</div>}
      {state === 'no-folder' && (
        <p className="mt-3 text-[12px] text-muted">Attach a folder to build a Codegraph index.</p>
      )}
      {canIndex(state) && (
        <button
          data-testid="create-index-card"
          className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 active:translate-y-px"
          onClick={() => void indexProject(projectId)}
        >
          {indexAction(state)}
        </button>
      )}
    </div>
  )
}
