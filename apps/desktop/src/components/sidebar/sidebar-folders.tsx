import { memo, useCallback, useState, type ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import {
  displayNoteTitle,
  errorMessage,
  hasOwnFolders,
  isProtectedFolder,
  revealFolder,
  type FolderTreeFolder,
  type FolderTreeNote,
} from '@kore/core'
import {
  Folder,
  FolderMove,
  FolderOpen,
  FolderPlus,
  Locate,
  NoteEdit,
  Pencil,
  Trash,
} from '@/components/icons'
import { NOTE_PATH_ATTRIBUTE, NoteContextMenuItems } from '@/components/notes/note-context-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { runCopyFolderPath } from '@/lib/folders/folder-actions'
import { startOperation } from '@/lib/operations'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/use-today'
import { useGraph } from '@/providers/graph-provider'
import { notePathForRoute, routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { SidebarFolderDialogs, type FolderDialogState } from './sidebar-folder-dialogs'
import { SidebarSortableSection } from './sidebar-sortable-section'
import {
  SIDEBAR_TREE_ITEM_CLASS,
  SIDEBAR_TREE_ROW_CLASS,
  SidebarTreeIcon,
  sidebarTreePadding,
} from './sidebar-tree-icon'
import { useSessionExpanded } from './use-session-expanded'

const EXPANDED_KEY = 'kore.workspace-sidebar.folders.expanded'
const FOLDER_PATH_ATTRIBUTE = 'data-folder-path'

/**
 * Note rows an expanded folder shows before a "Show all" row hands the rest
 * to its page — a 600-person `CRM/People` would otherwise bury the sidebar.
 */
export const FOLDER_NOTE_ROW_CAP = 50

interface FolderTreeContext {
  expanded: ReadonlySet<string>
  toggle: (path: string) => void
  open: (path: string) => void
  activePath: string | null
  activeFolder: string | null
}

type ContextTarget = { kind: 'folder'; path: string } | { kind: 'note'; path: string }

/**
 * The sidebar's Folders shelf: the vault's folders as a browsable and
 * manageable tree, for vaults organized by folder (an Obsidian vault's
 * `Active/Projects/…`). A folder's chevron expands it in place, its name opens
 * the folder's page, and right-clicking a folder or note opens a context menu
 * acting on the real Markdown files/directories on disk. Hidden entirely for a
 * Kore-shaped vault whose notes live only in its fixed `daily/` and `notes/`
 * folders.
 */
export function SidebarFolders(): ReactElement | null {
  const tree = useFolderTree()
  const { graph } = useGraph()
  const { route, navigate } = useRouter()
  const today = useToday()
  const [expanded, toggle] = useSessionExpanded(EXPANDED_KEY)
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null)
  const [dialog, setDialog] = useState<FolderDialogState | null>(null)

  const open = useCallback(
    (path: string): void =>
      navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: path } }),
    [navigate],
  )
  const ensureExpanded = useCallback(
    (path: string): void => {
      if (!expanded.has(path)) {
        toggle(path)
      }
    },
    [expanded, toggle],
  )

  if (tree === null || !hasOwnFolders(tree)) {
    return null
  }

  const context: FolderTreeContext = {
    expanded,
    toggle,
    open,
    activePath: notePathForRoute(route, today),
    activeFolder:
      route.kind === 'allNotes' && route.filter.kind === 'folder' ? route.filter.folder : null,
  }

  const generation = graph?.generation
  const handleReveal = (folderPath: string): void => {
    if (generation === undefined) {
      startOperation('Revealing folder').fail('No vault is open.')
      return
    }
    void revealFolder(folderPath, generation).catch((cause: unknown) => {
      startOperation('Revealing folder').fail(errorMessage(cause))
    })
  }

  return (
    <SidebarSortableSection id="folders" title="Folders" label="Folders">
      <ContextMenu>
        <ContextMenuTrigger render={<div className="contents" />}>
          <div
            className="contents"
            onContextMenuCapture={(event) => {
              const target = event.target as Element
              const folderRow = target.closest?.(`[${CSS.escape(FOLDER_PATH_ATTRIBUTE)}]`)
              const folderPath = folderRow?.getAttribute(FOLDER_PATH_ATTRIBUTE) ?? null
              if (folderPath !== null) {
                setContextTarget({ kind: 'folder', path: folderPath })
                return
              }
              const noteRow = target.closest?.(`[${CSS.escape(NOTE_PATH_ATTRIBUTE)}]`)
              const notePath = noteRow?.getAttribute(NOTE_PATH_ATTRIBUTE) ?? null
              if (notePath !== null) {
                setContextTarget({ kind: 'note', path: notePath })
                return
              }
              event.stopPropagation()
            }}
          >
            <ul className="mt-2 flex flex-col space-y-px">
              <FolderChildren folder={tree} depth={0} context={context} />
            </ul>
          </div>
        </ContextMenuTrigger>

        {contextTarget?.kind === 'folder' ? (
          <FolderContextMenuItems
            folderPath={contextTarget.path}
            onNewNote={() => setDialog({ kind: 'newNote', folderPath: contextTarget.path })}
            onNewSubfolder={() =>
              setDialog({ kind: 'newSubfolder', folderPath: contextTarget.path })
            }
            onRename={() => setDialog({ kind: 'rename', folderPath: contextTarget.path })}
            onMove={() => setDialog({ kind: 'move', folderPath: contextTarget.path })}
            onReveal={() => handleReveal(contextTarget.path)}
            onCopyPath={() => void runCopyFolderPath(graph?.root ?? null, contextTarget.path)}
            onTrash={() => setDialog({ kind: 'trash', folderPath: contextTarget.path })}
          />
        ) : contextTarget?.kind === 'note' ? (
          <NoteContextMenuItems path={contextTarget.path} />
        ) : null}
      </ContextMenu>

      <SidebarFolderDialogs
        dialog={dialog}
        tree={tree}
        onClose={() => setDialog(null)}
        onEnsureExpanded={ensureExpanded}
      />
    </SidebarSortableSection>
  )
}

interface FolderContextMenuItemsProps {
  folderPath: string
  onNewNote: () => void
  onNewSubfolder: () => void
  onRename: () => void
  onMove: () => void
  onReveal: () => void
  onCopyPath: () => void
  onTrash: () => void
}

function FolderContextMenuItems({
  folderPath,
  onNewNote,
  onNewSubfolder,
  onRename,
  onMove,
  onReveal,
  onCopyPath,
  onTrash,
}: FolderContextMenuItemsProps): ReactElement {
  const locked = isProtectedFolder(folderPath)
  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onNewNote}>
        <NoteEdit aria-hidden />
        New note…
      </ContextMenuItem>
      <ContextMenuItem onClick={onNewSubfolder}>
        <FolderPlus aria-hidden />
        New subfolder…
      </ContextMenuItem>

      {locked ? null : (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRename}>
            <Pencil aria-hidden />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem onClick={onMove}>
            <FolderMove aria-hidden />
            Move to…
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />
      <ContextMenuItem onClick={onReveal}>
        <Locate aria-hidden />
        Reveal in Finder
      </ContextMenuItem>
      <ContextMenuItem onClick={onCopyPath}>
        <FolderOpen aria-hidden />
        Copy folder path
      </ContextMenuItem>

      {locked ? null : (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={onTrash}>
            <Trash aria-hidden />
            Move to Trash…
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}

interface FolderChildrenProps {
  folder: FolderTreeFolder
  depth: number
  context: FolderTreeContext
}

function FolderChildren({ folder, depth, context }: FolderChildrenProps): ReactElement {
  // The vault root has no page to hand the rest to, so only real folders cap.
  const capped = folder.path !== '' && folder.notes.length > FOLDER_NOTE_ROW_CAP
  const notes = capped ? folder.notes.slice(0, FOLDER_NOTE_ROW_CAP) : folder.notes
  return (
    <>
      {folder.folders.map((child) => (
        <FolderRow key={child.path} folder={child} depth={depth} context={context} />
      ))}
      {notes.map((note) => (
        <NoteRow
          key={note.path}
          note={note}
          depth={depth}
          active={note.path === context.activePath}
        />
      ))}
      {capped ? (
        <li>
          <button
            type="button"
            onClick={() => context.open(folder.path)}
            className={cn(
              SIDEBAR_TREE_ITEM_CLASS,
              'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
            style={{ paddingLeft: sidebarTreePadding(depth, true) }}
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              Show all {folder.notes.length}
            </span>
          </button>
        </li>
      ) : null}
    </>
  )
}

function FolderRow({ folder, depth, context }: FolderChildrenProps): ReactElement {
  const open = context.expanded.has(folder.path)
  const Icon = open ? FolderOpen : Folder
  const active = context.activeFolder === folder.path
  return (
    <li>
      <div
        data-folder-path={folder.path}
        className={cn(
          SIDEBAR_TREE_ROW_CLASS,
          'flex w-full items-center gap-3 rounded-md transition-colors duration-[50ms]',
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        style={{ paddingLeft: sidebarTreePadding(depth) }}
      >
        <SidebarTreeIcon
          icon={<Icon className="size-3.5" />}
          open={open}
          toggle={{
            label: `${open ? 'Collapse' : 'Expand'} ${folder.name}`,
            onToggle: () => context.toggle(folder.path),
          }}
        />
        <button
          type="button"
          onClick={() => context.open(folder.path)}
          aria-current={active ? 'page' : undefined}
          className={cn(SIDEBAR_TREE_ITEM_CLASS, 'min-w-0 flex-1')}
        >
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{folder.name}</span>
          <span className="flex-none text-2xs tabular-nums text-text-muted">
            {folder.noteCount}
          </span>
        </button>
      </div>
      {open ? (
        <ul className="flex flex-col space-y-px">
          <FolderChildren folder={folder} depth={depth + 1} context={context} />
        </ul>
      ) : null}
    </li>
  )
}

interface NoteRowProps {
  note: FolderTreeNote
  depth: number
  active: boolean
}

const NoteRow = memo(function NoteRow({ note, depth, active }: NoteRowProps): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  return (
    <li>
      <button
        type="button"
        data-note-path={note.path}
        onClick={(event) =>
          navigateNoteLink({
            target: routeForPath(note.path),
            openInSplit: isModEvent(event),
          })
        }
        aria-current={active ? 'page' : undefined}
        className={cn(
          SIDEBAR_TREE_ITEM_CLASS,
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        // Starts on the label line, level with its sibling folders' names.
        style={{ paddingLeft: sidebarTreePadding(depth, true) }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {displayNoteTitle(note.title)}
        </span>
      </button>
    </li>
  )
})
