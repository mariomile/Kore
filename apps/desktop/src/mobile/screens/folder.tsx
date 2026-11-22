import { useMemo, useState, type ReactElement } from 'react'
import { parseSearchQuery } from '@kore/core'
import {
  ChevronRight,
  Folder,
  FolderMove,
  FolderPlus,
  MoreHorizontal,
  NoteEdit,
  Pencil,
  Trash,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { findFolder } from '@/lib/folders/folder-options'
import { folderOf } from '@/lib/notes/use-note-bulk-actions'
import { toggleNotePinned } from '@/lib/note-pin'
import { hapticImpactLight } from '@/mobile/haptics'
import { rowForHit, useNoteSearchFeed } from '@/mobile/note-search-feed'
import { MobileScreenHeader } from '@/mobile/screen-header'
import { SwipeableNoteRow } from '@/mobile/swipeable-note-row'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * The iPhone folder page, the Mac folder page's twin: where you are, the
 * subfolders, then the folder's own notes. ⋯ holds the folder's actions.
 * `folder === ''` is the vault root ("Folders"), the Notes tab's entry.
 */
export function MobileFolder({ folder }: { folder: string }): ReactElement {
  const { navigate, back, canBack } = useRouter()
  const { graph } = useGraph()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const tree = useFolderTree()
  const node = tree === null ? null : findFolder(tree, folder)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)

  const parsed = useMemo(
    () => parseSearchQuery(folder === '' ? '' : `path:"${folder}/"`),
    [folder],
  )
  const { feed } = useNoteSearchFeed(parsed)
  const rows = useMemo(
    () => (feed?.hits ?? []).filter((hit) => folderOf(hit.path) === folder).map(rowForHit),
    [feed, folder],
  )

  const name = folder === '' ? 'Folders' : folder.split('/').at(-1)!
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
  const subfolders = node?.folders ?? []
  const open = (path: string): void => navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: path } })

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title=""
        accessibleTitle={name}
        onBack={() => (canBack ? back() : navigate({ kind: 'today' }))}
        trailing={
          folder === '' ? null : (
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Folder actions"
              onClick={() => setActionsOpen(true)}
            >
              <MoreHorizontal />
            </Button>
          )
        }
      />
      <main
        className="min-h-0 flex-1 overflow-y-auto"
        style={{
          paddingTop: 'var(--mobile-header-height, 0px)',
          paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
        }}
        onScroll={() => setRevealed(null)}
      >
        <div className="px-4 pt-2 pb-4">
          {parent !== '' ? (
            <button
              type="button"
              onClick={() => open(parent)}
              className="mb-1 flex max-w-full items-center gap-1 text-[13px] text-text-muted"
            >
              <Folder aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{parent.split('/').join(' › ')}</span>
            </button>
          ) : null}
          <h1 className="text-[28px] font-semibold tracking-tight">{name}</h1>
          <p className="mt-0.5 text-[13px] text-text-muted tabular-nums">
            {subfolders.length > 0
              ? `${subfolders.length} ${subfolders.length === 1 ? 'folder' : 'folders'} · `
              : ''}
            {node?.noteCount ?? 0} notes
          </p>
        </div>

        {subfolders.length > 0 ? (
          <ul className="px-2 pb-3">
            {subfolders.map((child) => (
              <li key={child.path}>
                <button
                  type="button"
                  onClick={() => {
                    hapticImpactLight()
                    open(child.path)
                  }}
                  className="flex h-12 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-surface-hover"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
                    <Folder aria-hidden className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base">{child.name}</span>
                  <span className="shrink-0 text-sm text-text-muted tabular-nums">
                    {child.noteCount}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {rows.length > 0 ? (
          <>
            {subfolders.length > 0 ? (
              <h2 className="px-4 pt-2 pb-1 text-[13px] font-medium text-text-muted">Notes</h2>
            ) : null}
            <ul>
              {rows.map((row) => (
                <SwipeableNoteRow
                  key={row.path}
                  row={row}
                  revealed={revealed === row.path}
                  onReveal={() => setRevealed(row.path)}
                  onClose={() => setRevealed(null)}
                  onBeginInteraction={() =>
                    setRevealed((current) => (current === row.path ? current : null))
                  }
                  onOpen={() => navigate(routeForPath(row.path))}
                  onTogglePin={() => {
                    if (graph !== null) {
                      void toggleNotePinned(row.path, graph.generation).catch(() => {})
                    }
                  }}
                  onDelete={() => setRevealed(null)}
                />
              ))}
            </ul>
          </>
        ) : null}
      </main>

      <Drawer open={actionsOpen} onOpenChange={setActionsOpen}>
        <DrawerContent>
          <DrawerTitle className="sr-only">Folder actions</DrawerTitle>
          <div className="flex flex-col gap-1 p-4">
            {[
              { icon: <NoteEdit />, label: 'New note here' },
              { icon: <FolderPlus />, label: 'New subfolder' },
              { icon: <Pencil />, label: 'Rename' },
              { icon: <FolderMove />, label: 'Move to…' },
            ].map((action) => (
              <Button
                key={action.label}
                variant="ghost"
                size="lg"
                className="h-12 justify-start gap-3 text-base"
                onClick={() => setActionsOpen(false)}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="lg"
              className="h-12 justify-start gap-3 text-base text-destructive hover:text-destructive"
              onClick={() => setActionsOpen(false)}
            >
              <Trash />
              Delete folder
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
