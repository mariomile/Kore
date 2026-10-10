import { memo, useCallback, useState, type ReactElement } from 'react'
import { z } from 'zod'
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

const EXPANDED_KEY = 'reflect.workspace-sidebar.folders.expanded'
const expandedSchema = z.array(z.string()).catch([])

/** The session's expanded folders — same per-session policy as the shelves. */
function readExpanded(): ReadonlySet<string> {
  const stored = window.sessionStorage.getItem(EXPANDED_KEY)
  if (stored === null) {
    return new Set()
  }
  try {
    return new Set(expandedSchema.parse(JSON.parse(stored)))
  } catch {
    return new Set()
  }
}

const ROW_CLASS =
  'flex w-full items-center gap-1.5 rounded-md py-1 pr-2.5 text-left leading-5 transition-colors duration-[50ms]'
const INDENT_PX = 12
const BASE_PADDING_PX = 10

interface FolderTreeContext {
  expanded: ReadonlySet<string>
  toggle: (path: string) => void
  activePath: string | null
}

/**
 * The sidebar's Folders shelf: the vault's folders as a read-only tree, for
 * vaults organized by folder (an Obsidian vault's `Active/Projects/…`). Rows
 * only browse and open — nothing here moves, renames or creates a folder;
 * association stays the organizing model and this is a way in. Built from
 * the index, so hidden folders and Obsidian-excluded files never show. Hidden
 * entirely for a Kore-shaped vault whose notes live only in its fixed
 * `daily/` and `notes/` folders.
 */
export function SidebarFolders(): ReactElement | null {
  const tree = useFolderTree()
  const { route } = useRouter()
  const today = useToday()
  const [expanded, setExpanded] = useState(readExpanded)
  const toggle = useCallback((path: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(path)) {
        next.add(path)
      }
      window.sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  if (tree === null || !hasOwnFolders(tree)) {
    return null
  }

  const context: FolderTreeContext = {
    expanded,
    toggle,
    activePath: notePathForRoute(route, today),
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
  return (
    <>
      {folder.folders.map((child) => (
        <FolderRow key={child.path} folder={child} depth={depth} context={context} />
      ))}
      {folder.notes.map((note) => (
        <NoteRow
          key={note.path}
          note={note}
          depth={depth}
          active={note.path === context.activePath}
        />
      ))}
    </>
  )
}

function FolderRow({ folder, depth, context }: FolderChildrenProps): ReactElement {
  const open = context.expanded.has(folder.path)
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = open ? FolderOpen : Folder
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => context.toggle(folder.path)}
        className={cn(ROW_CLASS, 'text-text-secondary hover:bg-surface-hover hover:text-text')}
        style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX }}
      >
        <Chevron aria-hidden className="size-3 flex-none text-text-muted" />
        <Icon aria-hidden className="size-3.5 flex-none" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{folder.name}</span>
        <span className="flex-none text-2xs tabular-nums text-text-muted">{folder.noteCount}</span>
      </button>
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
