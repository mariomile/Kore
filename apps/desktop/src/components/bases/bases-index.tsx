import type { ReactElement } from 'react'
import { baseDisplayName } from '@reflect/core'
import { useRouter } from '@/routing/router'
import { useBaseFiles } from './use-base-view'

/** Every `.base` file in the vault, each opening its Base screen. */
export function BasesIndex(): ReactElement {
  const { navigate } = useRouter()
  const { paths, failed } = useBaseFiles()
  return (
    <div className="mx-auto w-full max-w-2xl overflow-auto px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Bases</h1>
      <p className="mt-1 text-sm text-text-muted">
        Obsidian bases in this vault, shown live over your notes.
      </p>
      {failed ? (
        <p role="alert" className="mt-6 text-sm text-text-muted">
          Couldn’t list the bases.
        </p>
      ) : paths === undefined ? (
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      ) : paths.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">
          No .base files yet. Bases made in Obsidian show up here.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col">
          {paths.map((path) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => {
                  navigate({ kind: 'base', path, view: null })
                }}
                className="flex w-full min-w-0 items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
              >
                <span className="text-[13px] font-medium text-text">{baseDisplayName(path)}</span>
                <span className="min-w-0 truncate text-xs text-text-muted">{path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
