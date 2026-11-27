import { useMemo, type ReactElement } from 'react'
import { displayNoteTitle } from '@kore/core'
import { TypeSuggestions } from '@/components/first-look/type-suggestions'
import { useVaultArrival } from '@/components/first-look/use-vault-arrival'
import { VaultArrivalHero } from '@/components/first-look/vault-arrival-hero'
import { VaultChecks } from '@/components/first-look/vault-checks'
import { NoteCardGrid } from '@/mobile/note-card-grid'
import { MobileScreenHeader } from '@/mobile/screen-header'
import type { NoteRowModel } from '@/mobile/swipeable-note-row'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * Insights on the iPhone (route kind `insights`): a vault's first look, the
 * same story as the Mac in the phone's language. While the first index
 * fills, the count climbs and the newest notes arrive as cards; once the
 * vault is read, the types Kore sees and the three checks take their place.
 * The Mac's graph frame has no phone counterpart (there is no Graph view
 * here); the rest is the Mac's components at touch size.
 */
export function MobileInsights(): ReactElement {
  const { back, canBack, navigate } = useRouter()
  const { graph } = useGraph()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const arrival = useVaultArrival()

  const rows = useMemo<NoteRowModel[]>(
    () =>
      arrival.filling
        ? arrival.recent.map((note) => ({
            path: note.path,
            titleSegments: [{ text: displayNoteTitle(note.title), highlighted: false }],
            mtime: note.mtime,
            isPinned: note.isPinned,
            canDelete: true,
            snippet: [{ text: note.snippet, highlighted: false }],
          }))
        : [],
    [arrival.filling, arrival.recent],
  )
  const openNote = (path: string): void => navigate(routeForPath(path))
  const openTag = (tag: string): void =>
    navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } })

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title={arrival.arriving ? (graph?.name ?? 'Your vault') : 'Insights'}
        onBack={() => (canBack ? back() : navigate({ kind: 'today' }))}
      />
      <NoteCardGrid
        rows={rows}
        onOpen={openNote}
        leading={
          <div className="flex flex-col gap-10 px-4 pt-2">
            <VaultArrivalHero
              tally={arrival.tally}
              progress={arrival.progress}
              filling={arrival.filling}
              readyInMs={arrival.readyInMs}
              touch
            />
            {arrival.firstLook !== undefined ? (
              <>
                <TypeSuggestions
                  suggestions={arrival.firstLook.suggestions}
                  onOpenType={openTag}
                  touch
                />
                <VaultChecks look={arrival.firstLook} onOpenNote={openNote} touch />
              </>
            ) : null}
            {rows.length > 0 ? (
              <h2 className="-mb-4 text-2xs font-medium tracking-wide text-text-muted">
                Just read
              </h2>
            ) : null}
          </div>
        }
      />
    </div>
  )
}
