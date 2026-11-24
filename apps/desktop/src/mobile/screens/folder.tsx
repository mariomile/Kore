import { useMemo, useState, type ReactElement } from 'react'
import { findFolder, folderDisplayName, parseSearchQuery, sortNoteList } from '@kore/core'
import { ChevronLeft, Folder, MoreHorizontal } from '@/components/icons'
import { FolderFiles } from '@/components/all-notes/folder-files'
import { FolderSubfolders } from '@/components/all-notes/folder-subfolders'
import { MOBILE_CARD_SECTION_CLASS } from '@/components/all-notes/grid-card-classes'
import { useFolderIncludesSubfolders } from '@/components/all-notes/use-folder-includes-subfolders'
import { NoteFolderBreadcrumb } from '@/components/note-folder-breadcrumb'
import { FolderDialogs, type FolderDialogState } from '@/components/folders/folder-dialogs'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useAssetOpener } from '@/hooks/use-asset-opener'
import { useFolderTree } from '@/hooks/use-folder-tree'
import type { MoveTarget } from '@/lib/folders/use-folder-operations'
import { folderOf } from '@/lib/notes/use-note-bulk-actions'
import { hapticImpactLight } from '@/mobile/haptics'
import { FolderActionsDrawer } from '@/mobile/folder-actions-drawer'
import { FolderRows } from '@/mobile/folder-rows'
import { LayoutToggle } from '@/mobile/layout-toggle'
import { MoveToDrawer } from '@/mobile/move-to-drawer'
import { NoteCardGrid } from '@/mobile/note-card-grid'
import { NoteRowList } from '@/mobile/note-row-list'
import { rowForHit, useNoteSearchFeed } from '@/mobile/note-search-feed'
import { folderSearchQuery } from '@/mobile/search-filters/filter-state'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

interface MobileFolderProps {
  /** Graph-relative folder; `''` is the vault's top level ("Folders"). */
  folder: string
}

/**
 * The iPhone folder page, the Mac folder page's twin: the folder's place in
 * the vault above its name, then its subfolders and loose files as cards,
 * then its notes in the Notes tab's list or grid (its subfolders' notes too
 * unless the folder's settings say otherwise, the same per-folder choice as
 * the Mac). ⋯ holds what the Mac's folder menu does. `folder === ''` is the
 * vault's top level, reached from the Notes tab's Folders chip: its folders
 * and the notes that sit at the top.
 */
export function MobileFolder({ folder }: MobileFolderProps): ReactElement {
  const { navigate, back, canBack } = useRouter()
  const { graph } = useGraph()
  const { settings, updateSettings } = useSettings()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const tree = useFolderTree()
  const atTop = folder === ''
  const node = tree === null ? null : findFolder(tree, folder)
  const [includeSubfolders, setIncludeSubfolders] = useFolderIncludesSubfolders(
    atTop ? null : folder,
  )
  const recursive = !atTop && includeSubfolders

  const [actionsOpen, setActionsOpen] = useState(false)
  const [dialog, setDialog] = useState<FolderDialogState | null>(null)
  const [moving, setMoving] = useState<MoveTarget | null>(null)

  const search = useMemo(
    () => parseSearchQuery(atTop ? '' : folderSearchQuery(folder)),
    [atTop, folder],
  )
  const { feed, enabled, removeDeletedRow } = useNoteSearchFeed(search)
  const sort = settings.allNotesSort
  const rows = useMemo(() => {
    if (feed === undefined) {
      return feed
    }
    const inFolder = recursive
      ? feed.hits
      : feed.hits.filter((hit) => folderOf(hit.path) === folder)
    return (sort === 'updated-desc' ? inFolder : sortNoteList(inFolder, sort)).map(rowForHit)
  }, [feed, folder, recursive, sort])

  const { resolveImageUrl, openAsset } = useAssetPersistence(graph?.generation ?? null)
  const { openAsset: openFile, viewer: fileViewer } = useAssetOpener({
    resolveUrl: resolveImageUrl,
    openExternally: openAsset,
  })

  const grid = settings.allNotesView === 'grid'
  const name = atTop ? 'Folders' : folderDisplayName(folder)
  const openNote = (path: string): void => navigate(routeForPath(path))

  const leading = (
    <div>
      {grid ? (
        <FolderSubfolders folder={node} className={MOBILE_CARD_SECTION_CLASS} density="compact" />
      ) : (
        <FolderRows folder={node} />
      )}
      {atTop ? null : (
        <FolderFiles
          folder={folder}
          includeSubfolders={includeSubfolders}
          onOpen={(path) => void openFile(path)}
          className={MOBILE_CARD_SECTION_CLASS}
        />
      )}
      {rows !== undefined && rows.length > 0 && (node?.folders.length ?? 0) > 0 ? (
        <h2 className="px-4 pt-3 text-[13px] font-medium text-text-muted">Notes</h2>
      ) : null}
    </div>
  )

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <header
        ref={barRef}
        className="mobile-glass-bar absolute inset-x-0 top-0 z-30 px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)' }}
      >
        <div className="flex h-11 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 size-11 shrink-0"
            aria-label="Back"
            onClick={() =>
              canBack ? back() : navigate({ kind: 'allNotes', filter: { kind: 'all' } })
            }
          >
            <ChevronLeft />
          </Button>
          <div className="flex-1" />
          <LayoutToggle
            view={settings.allNotesView === 'grid' ? 'grid' : 'list'}
            onChange={(view) => {
              hapticImpactLight()
              updateSettings({ allNotesView: view })
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 size-11 shrink-0"
            aria-label="Folder actions"
            aria-haspopup="dialog"
            onClick={() => {
              hapticImpactLight()
              setActionsOpen(true)
            }}
          >
            <MoreHorizontal />
          </Button>
        </div>
        <NoteFolderBreadcrumb path={folder} className="mb-0 pt-1" />
        <div className="flex min-w-0 items-center gap-2.5 pt-1">
          <Folder aria-hidden className="size-6 shrink-0 text-text-muted" />
          <h1 className="min-w-0 truncate text-[28px] font-semibold tracking-tight">{name}</h1>
          {rows !== undefined && !atTop ? (
            <span className="shrink-0 pt-1.5 text-[15px] tabular-nums text-text-muted">
              {rows.length}
            </span>
          ) : null}
        </div>
      </header>

      {enabled && rows === undefined ? (
        <div
          className="flex flex-1 items-center justify-center"
          style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
          aria-label="Loading notes"
        >
          <Spinner className="size-5 text-text-muted" />
        </div>
      ) : rows === undefined || rows.length === 0 ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{
            paddingTop: 'var(--mobile-header-height, 0px)',
            paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
          }}
        >
          {leading}
          {(node?.folders.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 pt-24 text-center text-text-muted">
              <Folder className="size-6" />
              <p className="text-sm">This folder is empty</p>
              <Button
                variant="outline"
                onClick={() => setDialog({ kind: 'newNote', folderPath: folder })}
              >
                New note
              </Button>
            </div>
          ) : null}
        </div>
      ) : grid ? (
        <NoteCardGrid rows={rows} onOpen={openNote} leading={leading} />
      ) : (
        <NoteRowList rows={rows} onOpen={openNote} onDeleted={removeDeletedRow} leading={leading} />
      )}

      <FolderActionsDrawer
        folder={folder}
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        onDialog={setDialog}
        onMove={() => setMoving({ kind: 'folder', path: folder })}
        includeSubfolders={includeSubfolders}
        onIncludeSubfoldersChange={setIncludeSubfolders}
      />
      <FolderDialogs dialog={dialog} onClose={() => setDialog(null)} />
      {moving !== null ? <MoveToDrawer target={moving} onClose={() => setMoving(null)} /> : null}
      {fileViewer}
    </div>
  )
}
