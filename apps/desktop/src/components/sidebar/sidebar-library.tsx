import { memo, useCallback, type ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import { libraryFileTitle, type LibraryRoot } from '@reflect/core'
import { Bot, ChevronDown, ChevronRight, Folder, FolderOpen } from '@/components/icons'
import { useLibraryDir, useLibraryRoots } from '@/hooks/use-library'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { SidebarSortableSection } from './sidebar-sortable-section'
import { useSessionExpanded } from './use-session-expanded'

const EXPANDED_KEY = 'kore.workspace-sidebar.library.expanded'

const ROW_CLASS =
  'flex w-full items-center gap-1.5 rounded-md py-1 pr-2.5 text-left leading-5 transition-colors duration-[50ms]'
const INDENT_PX = 12
const BASE_PADDING_PX = 10

interface LibraryTreeContext {
  root: string
  expanded: ReadonlySet<string>
  toggle: (key: string) => void
  /** The file the active route shows, as `root:path`, or null. */
  activeKey: string | null
}

/** One folder's expansion key: its root id and its path inside the root. */
function folderKey(root: string, dir: string): string {
  return `${root}:${dir}`
}

function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`
}

/**
 * The sidebar's Library shelf: coding agents' home folders (`~/.claude`,
 * `~/.codex`, `~/.agents`, …) as a read-only tree, so the skills, agent
 * definitions and memory files those tools keep can be read beside the
 * graph. Only folders and markdown files show; dotfiles never do. A folder
 * loads its own level when it is first expanded, since `~/.claude` alone can
 * hold ten thousand files. Hidden when none of the folders exist (and on
 * mobile, where they never do).
 */
export function SidebarLibrary(): ReactElement | null {
  const roots = useLibraryRoots()
  const { route } = useRouter()
  const [expanded, toggle] = useSessionExpanded(EXPANDED_KEY)

  if (roots.length === 0) {
    return null
  }
  const activeKey = route.kind === 'library' ? `${route.root}:${route.path}` : null
  return (
    <SidebarSortableSection id="library" title="Library" label="Library">
      <ul className="mt-2 flex flex-col space-y-px">
        {roots.map((root) => (
          <RootRow
            key={root.id}
            root={root}
            context={{ root: root.id, expanded, toggle, activeKey }}
          />
        ))}
      </ul>
    </SidebarSortableSection>
  )
}

interface RootRowProps {
  root: LibraryRoot
  context: LibraryTreeContext
}

function RootRow({ root, context }: RootRowProps): ReactElement {
  const key = folderKey(root.id, '')
  const open = context.expanded.has(key)
  return (
    <li>
      <FolderToggle
        name={root.label}
        title={root.path}
        open={open}
        depth={0}
        icon={<Bot aria-hidden className="size-3.5 flex-none" />}
        onToggle={() => context.toggle(key)}
      />
      {open ? <FolderLevel dir="" depth={1} context={context} /> : null}
    </li>
  )
}

interface FolderLevelProps {
  dir: string
  depth: number
  context: LibraryTreeContext
}

function FolderLevel({ dir, depth, context }: FolderLevelProps): ReactElement {
  const level = useLibraryDir(context.root, dir, true)
  if (level === null) {
    return <ul className="flex flex-col space-y-px" />
  }
  if (level === 'error' || (level.folders.length === 0 && level.files.length === 0)) {
    return (
      <p
        className="py-1 text-2xs text-text-muted"
        style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX + 18 }}
      >
        {level === 'error' ? 'This folder couldn’t be opened' : 'No markdown here'}
      </p>
    )
  }
  return (
    <ul className="flex flex-col space-y-px">
      {level.folders.map((name) => (
        <FolderRow
          key={name}
          path={joinPath(dir, name)}
          name={name}
          depth={depth}
          context={context}
        />
      ))}
      {level.files.map((name) => {
        const path = joinPath(dir, name)
        return (
          <FileRow
            key={name}
            root={context.root}
            path={path}
            depth={depth}
            active={context.activeKey === `${context.root}:${path}`}
          />
        )
      })}
    </ul>
  )
}

interface FolderRowProps {
  path: string
  name: string
  depth: number
  context: LibraryTreeContext
}

function FolderRow({ path, name, depth, context }: FolderRowProps): ReactElement {
  const key = folderKey(context.root, path)
  const open = context.expanded.has(key)
  const Icon = open ? FolderOpen : Folder
  return (
    <li>
      <FolderToggle
        name={name}
        open={open}
        depth={depth}
        icon={<Icon aria-hidden className="size-3.5 flex-none" />}
        onToggle={() => context.toggle(key)}
      />
      {open ? <FolderLevel dir={path} depth={depth + 1} context={context} /> : null}
    </li>
  )
}

interface FolderToggleProps {
  name: string
  title?: string
  open: boolean
  depth: number
  icon: ReactElement
  onToggle: () => void
}

/** A folder row: the whole row expands it, since a Library folder has no page. */
function FolderToggle({
  name,
  title,
  open,
  depth,
  icon,
  onToggle,
}: FolderToggleProps): ReactElement {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      aria-expanded={open}
      title={title}
      onClick={onToggle}
      className={cn(ROW_CLASS, 'text-text-secondary hover:bg-surface-hover hover:text-text')}
      style={{ paddingLeft: BASE_PADDING_PX - 4 + depth * INDENT_PX }}
    >
      <span className="flex size-5 flex-none items-center justify-center text-text-muted">
        <Chevron aria-hidden className="size-3" />
      </span>
      {icon}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
    </button>
  )
}

interface FileRowProps {
  root: string
  path: string
  depth: number
  active: boolean
}

const FileRow = memo(function FileRow({ root, path, depth, active }: FileRowProps): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const open = useCallback(
    (openInSplit: boolean) =>
      navigateNoteLink({ target: { kind: 'library', root, path }, openInSplit }),
    [navigateNoteLink, root, path],
  )
  return (
    <li>
      <button
        type="button"
        onClick={(event) => open(isModEvent(event))}
        aria-current={active ? 'page' : undefined}
        title={path}
        className={cn(
          ROW_CLASS,
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX + 18 }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {libraryFileTitle(path)}
        </span>
      </button>
    </li>
  )
})
