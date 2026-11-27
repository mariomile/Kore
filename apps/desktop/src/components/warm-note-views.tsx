import { useEffect, useRef, useState, type ReactElement } from 'react'
import { PaneErrorBoundary } from '@/components/pane-error-boundary'
import { SingleNoteView } from '@/components/single-note-view'
import { usePaneIsActive } from '@/providers/panes-provider'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { RouterFreeze } from '@/routing/router'
import { nextWarmNotes, type WarmNote } from '@/lib/warm-notes'

/**
 * Every warm note of the pane, the active one shown and the rest hidden. Only
 * paths that are still open tabs (or the note on screen) stay warm, so a
 * closed, renamed or deleted note never lingers with a session on its old path.
 */
export function WarmNoteViews({ activePath }: { activePath: string | null }): ReactElement {
  const { tabs } = useOpenTabs()
  const openPaths = new Set(tabs.flatMap((tab) => (tab.kind === 'note' ? [tab.path] : [])))
  const [warm, setWarm] = useState<readonly WarmNote[]>([])
  // State adjusted during render, so the note is mounted in the same commit
  // the route arrives in, and a closed tab's note is gone in the commit that
  // closes it.
  const next = nextWarmNotes(warm, activePath, openPaths)
  if (next !== warm) {
    setWarm(next)
  }
  return (
    <>
      {next.map((note) => (
        <WarmNoteView key={note.path} path={note.path} active={note.path === activePath} />
      ))}
    </>
  )
}

function WarmNoteView({ path, active }: { path: string; active: boolean }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const paneIsActive = usePaneIsActive()
  const wasActive = useRef(active)
  // Coming back to a warm tab hands the caret back to its editor, where it
  // was: the editor keeps its selection while hidden. Commands run from
  // outside the editor (the palette's Zoom, Copy link) act on the last
  // focused editor, which must be the one on screen.
  useEffect(() => {
    if (active && !wasActive.current && paneIsActive) {
      ref.current?.querySelector<HTMLElement>('.ProseMirror')?.focus({ preventScroll: true })
    }
    wasActive.current = active
  }, [active, paneIsActive])
  return (
    <div
      ref={ref}
      className={active ? 'h-full' : 'kore-warm-note'}
      inert={!active}
      aria-hidden={active ? undefined : true}
      data-warm-note={active ? undefined : path}
    >
      {/* A hidden note sees the router as it was when it left the screen,
          so arrivals elsewhere never re-anchor or refocus it. */}
      <RouterFreeze frozen={!active}>
        <PaneErrorBoundary resetKey={path} surface="note" path={path}>
          <SingleNoteView path={path} shown={active} />
        </PaneErrorBoundary>
      </RouterFreeze>
    </div>
  )
}
