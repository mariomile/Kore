import type { ReactElement } from 'react'
import { baseDisplayName } from '@reflect/core'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { cn } from '@/lib/utils'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { BaseViewContent } from './base-view-content'
import { BasesIndex } from './bases-index'
import { useBaseView } from './use-base-view'

interface BaseScreenProps {
  /** The `.base` file, or null for the list of every base. */
  path: string | null
  view: string | null
}

/**
 * An Obsidian base: its views as tabs over the live vault. Cells edit the
 * notes' own frontmatter; the `.base` file is never written, so the same
 * base keeps working in Obsidian.
 */
export function BaseScreen({ path, view }: BaseScreenProps): ReactElement {
  if (path === null) {
    return <BasesIndex />
  }
  return <BaseFileScreen path={path} view={view} />
}

function BaseFileScreen({ path, view }: { path: string; view: string | null }): ReactElement {
  const { navigate } = useRouter()
  const state = useBaseView(path, view)
  const commitProperty = useCommitNoteProperty()
  const openNote = (target: string): void => navigate(routeForPath(target))

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="px-12 pb-4 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{baseDisplayName(path)}</h1>
        <p className="mt-1 truncate text-xs text-text-muted">{path}</p>
        {state.status === 'ready' && state.definition.views.length > 1 ? (
          <div role="tablist" aria-label="Views" className="mt-4 flex flex-wrap gap-1">
            {state.definition.views.map((entry, index) => (
              <button
                key={`${entry.name}:${index}`}
                type="button"
                role="tab"
                aria-selected={index === state.viewIndex}
                onClick={() => {
                  navigate({ kind: 'base', path, view: entry.name })
                }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[13px] transition-colors',
                  index === state.viewIndex
                    ? 'bg-surface-active text-text'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary',
                )}
              >
                {entry.name}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {state.status === 'loading' ? (
        <p className="px-12 py-6 text-sm text-text-muted">Loading…</p>
      ) : state.status === 'error' ? (
        <p role="alert" className="px-12 py-6 text-sm text-text-muted">
          Couldn’t open this base: {state.message}
        </p>
      ) : (
        <BaseViewContent result={state.result} onOpenNote={openNote} onEdit={commitProperty} />
      )}
    </div>
  )
}
