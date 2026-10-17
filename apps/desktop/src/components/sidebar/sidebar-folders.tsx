import { memo, useCallback, type ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import {
  displayNoteTitle,
  hasOwnFolders,
  type FolderTreeFolder,
  type FolderTreeNote,
} from '@reflect/core'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from '@/components/icons'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/use-today'
import { notePathForRoute, routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { SidebarSortableSection } from './sidebar-sortable-section'
import { useSessionExpanded } from './use-session-expanded'

const EXPANDED_KEY = 'reflect.workspace-sidebar.folders.expanded'

const ROW_CLASS =
  'flex w-full items-center gap-1.5 rounded-md py-1 pr-2.5 text-left leading-5 transition-colors duration-[50ms]'
const INDENT_PX = 12
const BASE_PADDING_PX = 10
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

/**
 * The sidebar's Folders shelf: the vault's folders as a read-only tree, for
 * vaults organized by folder (an Obsidian vault's `Active/Projects/…`). A
 * folder's chevron expands it in place and its name opens the folder's page;
 * an expanded folder lists at most {@link FOLDER_NOTE_ROW_CAP} notes, then a
 * "Show all" row to that page. Rows only browse and open — nothing here
 * moves, renames or creates a folder;
 * association stays the organizing model and this is a way in. Built from
 * the index, so hidden folders and Obsidian-excluded files never show. Hidden
 * entirely for a Kore-shaped vault whose notes live only in its fixed
 * `daily/` and `notes/` folders.
 */
export function SidebarFolders(): ReactElement | null {
  const tree = useFolderTree()
  const { route, navigate } = useRouter()
  const today = useToday()
  const [expanded, toggle] = useSessionExpanded(EXPANDED_KEY)
  const open = useCallback(
    (path: string): void =>
      navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: path } }),
    [navigate],
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
  return (
    <SidebarSortableSection id="folders" title="Folders" label="Folders">
      <ul className="mt-2 flex flex-col space-y-px">
        <FolderChildren folder={tree} depth={0} context={context} />
      </ul>
    </SidebarSortableSection>
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
            className={cn(ROW_CLASS, 'text-text-muted hover:bg-surface-hover hover:text-text')}
            style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX + 18 }}
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
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = open ? FolderOpen : Folder
  const active = context.activeFolder === folder.path
  return (
    <li>
      <div
        className={cn(
          'flex w-full items-center rounded-md transition-colors duration-[50ms]',
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        style={{ paddingLeft: BASE_PADDING_PX - 4 + depth * INDENT_PX }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${folder.name}`}
          onClick={() => context.toggle(folder.path)}
          className="flex size-5 flex-none items-center justify-center rounded text-text-muted hover:text-text"
        >
          <Chevron aria-hidden className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => context.open(folder.path)}
          aria-current={active ? 'page' : undefined}
          className={cn(ROW_CLASS, 'min-w-0 flex-1 pl-0.5')}
        >
          <Icon aria-hidden className="size-3.5 flex-none" />
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
        onClick={(event) =>
          navigateNoteLink({
            target: routeForPath(note.path),
            openInSplit: isModEvent(event),
          })
        }
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW_CLASS,
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        // The chevron column (12px + gap) keeps a note level with its
        // sibling folders' names rather than their chevrons.
        style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX + 18 }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {displayNoteTitle(note.title)}
        </span>
      </button>
    </li>
  )
})
