import type { ReactElement, ReactNode } from 'react'
import { canvasDisplayName } from '@kore/core'
import { LayoutTemplate } from '@/components/icons'
import { PageLoading } from '@/components/page-loading'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { isMobileSurface } from '@/lib/platform-surface'
import { MobileScreenHeader } from '@/mobile/screen-header'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useRouter } from '@/routing/router'
import { CanvasBoard } from './canvas-board'
import { useCanvasDocument, useCanvasEditor, useCanvasFiles } from './use-canvas'

interface CanvasScreenProps {
  /** The `.canvas` file, or null for the list of every canvas. */
  path: string | null
}

/**
 * A JSON Canvas board (Obsidian's `.canvas`): its cards, groups and arrows
 * on a board you pan and zoom. On the Mac its cards can be moved, resized,
 * added and removed; every write patches the file's own JSON, so it keeps
 * working in Obsidian. On the iPhone it is a view.
 */
export function CanvasScreen({ path }: CanvasScreenProps): ReactElement {
  // Keyed by path: the undo history belongs to one file.
  return path === null ? <CanvasIndex /> : <CanvasFileScreen key={path} path={path} />
}

function CanvasFileScreen({ path }: { path: string }): ReactElement {
  const state = useCanvasDocument(path)
  const editor = useCanvasEditor(path)
  const name = canvasDisplayName(path)
  // No page header: a board is all canvas. The Mac's tab names it; the
  // iPhone gets the stack's glass bar, with the board running under it.
  const body =
    state.status === 'loading' ? (
      <PageLoading label="Loading canvas" />
    ) : state.status === 'error' ? (
      <p role="alert" className="px-6 py-6 text-sm text-text-muted">
        Couldn’t open this canvas: {state.message}
      </p>
    ) : state.canvas.nodes.length === 0 && editor === null ? (
      <EmptyState icon={LayoutTemplate} title="This canvas is empty" />
    ) : (
      <CanvasBoard canvas={state.canvas} label={name} editor={editor} />
    )
  return isMobileSurface() ? (
    <MobileCanvasFrame title={name}>{body}</MobileCanvasFrame>
  ) : (
    <div className="flex h-full min-h-0 flex-col">{body}</div>
  )
}

function MobileCanvasFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): ReactElement {
  const { navigate, back, canBack } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title={title}
        onBack={() => (canBack ? back() : navigate({ kind: 'canvas', path: null }))}
      />
      <main
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
      >
        {children}
      </main>
    </div>
  )
}

/** Every `.canvas` file in the vault, each opening its canvas. */
function CanvasIndex(): ReactElement {
  const { navigate } = useRouter()
  const { paths, failed } = useCanvasFiles()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <PageHeader
        title="Canvases"
        description="Canvas boards in this vault, from Obsidian or drawn by an agent."
      />
      {failed ? (
        <p role="alert" className="pr-7 pl-12 text-sm text-text-muted">
          Couldn’t list the canvases.
        </p>
      ) : paths === undefined ? (
        <PageLoading label="Loading canvases" />
      ) : paths.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No canvases yet"
          description="A canvas you draw in Obsidian shows up here the moment its file is in the vault."
          className="my-auto"
        />
      ) : (
        <ul className="flex max-w-3xl flex-col pr-7 pb-10 pl-10">
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
