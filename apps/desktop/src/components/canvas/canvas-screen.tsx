import type { ReactElement } from 'react'
import { canvasDisplayName } from '@reflect/core'
import { useRouter } from '@/routing/router'
import { CanvasBoard } from './canvas-board'
import { useCanvasDocument, useCanvasFiles } from './use-canvas'

interface CanvasScreenProps {
  /** The `.canvas` file, or null for the list of every canvas. */
  path: string | null
}

/**
 * An Obsidian canvas, read-only: its cards, groups and arrows on a board you
 * can pan and zoom. The file is never written, so it keeps working in
 * Obsidian.
 */
export function CanvasScreen({ path }: CanvasScreenProps): ReactElement {
  return path === null ? <CanvasIndex /> : <CanvasFileScreen path={path} />
}

function CanvasFileScreen({ path }: { path: string }): ReactElement {
  const state = useCanvasDocument(path)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-6 pb-3 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {canvasDisplayName(path)}
        </h1>
        <p className="mt-1 truncate text-xs text-text-muted">{path}</p>
      </header>
      {state.status === 'loading' ? (
        <p className="px-6 py-6 text-sm text-text-muted">Loading…</p>
      ) : state.status === 'error' ? (
        <p role="alert" className="px-6 py-6 text-sm text-text-muted">
          Couldn’t open this canvas: {state.message}
        </p>
      ) : state.canvas.nodes.length === 0 ? (
        <p className="px-6 py-6 text-sm text-text-muted">This canvas is empty.</p>
      ) : (
        <CanvasBoard key={path} canvas={state.canvas} label={canvasDisplayName(path)} />
      )}
    </div>
  )
}

/** Every `.canvas` file in the vault, each opening its canvas. */
function CanvasIndex(): ReactElement {
  const { navigate } = useRouter()
  const { paths, failed } = useCanvasFiles()
  return (
    <div className="mx-auto w-full max-w-2xl overflow-auto px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Canvases</h1>
      <p className="mt-1 text-sm text-text-muted">
        Obsidian canvases in this vault, shown read-only.
      </p>
      {failed ? (
        <p role="alert" className="mt-6 text-sm text-text-muted">
          Couldn’t list the canvases.
        </p>
      ) : paths === undefined ? (
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      ) : paths.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">
          No .canvas files yet. Canvases made in Obsidian show up here.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col">
          {paths.map((path) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => {
                  navigate({ kind: 'canvas', path })
                }}
                className="flex w-full min-w-0 items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
              >
                <span className="text-[13px] font-medium text-text">{canvasDisplayName(path)}</span>
                <span className="min-w-0 truncate text-xs text-text-muted">{path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
