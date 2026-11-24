import { memo, useMemo, useState, type ReactElement } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  displayNoteTitle,
  recentNotesByFolder,
  type FolderPeekNote,
  type FolderTreeFolder,
} from '@kore/core'
import { Folder } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useFirstImages } from '@/hooks/use-note-card-images'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { CARD_SECTION_CLASS, GRID_CARD_BUTTON_CLASS, GRID_CARD_CLASS } from './grid-card-classes'

interface FolderSubfoldersProps {
  /** The page's folder from the tree; renders nothing without subfolders. */
  folder: FolderTreeFolder | null
  /** The section's grid; the Mac page's columns unless the phone passes its own. */
  className?: string
  /**
   * `compact` is the phone's half-width card: two notes peek instead of
   * three, and the counts sit under the name so neither crowds the other.
   */
  density?: 'regular' | 'compact'
}

/** A folder card shows this many of the notes inside it (two on a phone). */
const PEEK_COUNT = 3
const COMPACT_PEEK_COUNT = 2

const NO_PEEKS: ReadonlyMap<string, readonly FolderPeekNote[]> = new Map()

/**
 * A folder page's subfolders as cards above its notes, Notion's child pages
 * made visual: each card peeks at the folder's three most recently edited
 * notes (their pictures, or their titles on a paper tile), then names the
 * folder and counts what it holds. A card opens that subfolder's own page.
 * One indexed query for every card's peek, one for their pictures.
 */
export function FolderSubfolders({
  folder,
  className = CARD_SECTION_CLASS,
  density = 'regular',
}: FolderSubfoldersProps): ReactElement | null {
  const children = folder?.folders ?? []
  const paths = useMemo(() => children.map((child) => child.path), [children])
  const peeks = useFolderPeeks(paths)
  const pictures = useFirstImages(
    useMemo(() => [...peeks.values()].flat().map((note) => note.path), [peeks]),
  )
  if (children.length === 0) {
    return null
  }
  return (
    <ul aria-label="Subfolders" className={className}>
      {children.map((child) => (
        <li key={child.path} className="min-w-0">
          <FolderCard
            folder={child}
            peek={peeks.get(child.path)}
            pictures={pictures}
            compact={density === 'compact'}
          />
        </li>
      ))}
    </ul>
  )
}

function useFolderPeeks(paths: readonly string[]): ReadonlyMap<string, readonly FolderPeekNote[]> {
  const { graph } = useGraph()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'folder-peeks', paths],
    queryFn: () => recentNotesByFolder(paths, PEEK_COUNT),
    enabled: graph !== null && graph !== undefined && paths.length > 0,
    placeholderData: keepPreviousData,
  })
  return data ?? NO_PEEKS
}

interface FolderCardProps {
  folder: FolderTreeFolder
  peek: readonly FolderPeekNote[] | undefined
  pictures: ReadonlyMap<string, string>
  compact: boolean
}

const FolderCard = memo(function FolderCard({
  folder,
  peek,
  pictures,
  compact,
}: FolderCardProps): ReactElement {
  const { navigate } = useRouter()
  const shown = compact ? peek?.slice(0, COMPACT_PEEK_COUNT) : peek
  return (
    <div className={GRID_CARD_CLASS}>
      <button
        type="button"
        aria-label={`${folder.name}, ${folderCountLabel(folder)}`}
        onClick={() =>
          navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: folder.path } })
        }
        className={GRID_CARD_BUTTON_CLASS}
      />
      <div
        aria-hidden
        data-testid="folder-card-peek"
        // overflow-hidden holds the band to its ratio: a long peek title would
        // otherwise stretch it and leave cards in one row at different heights.
        className="flex aspect-[16/7] w-full gap-2 overflow-hidden bg-surface-hover p-3"
      >
        {shown === undefined || shown.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Folder className="size-6 text-text-muted" />
          </div>
        ) : (
          shown.map((note) => (
            <PeekTile
              key={note.path}
              note={note}
              picture={pictures.get(note.path)}
              compact={compact}
            />
          ))
        )}
      </div>
      {compact ? (
        <div className="flex min-w-0 flex-col gap-0.5 px-3.5 py-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <Folder aria-hidden className="size-3.5 flex-none text-text-muted" />
            <span className="min-w-0 truncate text-sm font-semibold text-text">{folder.name}</span>
          </span>
          <span className="truncate text-2xs tabular-nums text-text-secondary">
            {folderCountLabel(folder)}
          </span>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-4 py-3.5">
          <Folder aria-hidden className="size-3.5 flex-none text-text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
            {folder.name}
          </span>
          <span className="flex-none text-2xs tabular-nums text-text-secondary">
            {folderCountLabel(folder)}
          </span>
        </div>
      )}
    </div>
  )
})

/** One note peeking out of a folder card: its picture, else its title on paper. */
function PeekTile({
  note,
  picture,
  compact,
}: {
  note: FolderPeekNote
  picture: string | undefined
  /** A phone card's tile is short: two lines of title, never a cut third. */
  compact: boolean
}): ReactElement {
  // A thumbnail that fails (the file went away since the index named it)
  // falls back to the title, like a note without a picture.
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface">
      {picture !== undefined && failed !== picture ? (
        <img
          src={picture}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(picture)}
          className="size-full object-cover"
        />
      ) : (
        <p
          className={cn(
            'm-2 text-2xs font-medium leading-snug text-text-secondary [overflow-wrap:anywhere]',
            compact ? 'line-clamp-2' : 'line-clamp-4',
          )}
        >
          {displayNoteTitle(note.title)}
        </p>
      )}
    </div>
  )
}

/** "12 notes", plus its folders when it has some: "3 folders · 12 notes". */
export function folderCountLabel(folder: FolderTreeFolder): string {
  const notes = `${folder.noteCount} ${folder.noteCount === 1 ? 'note' : 'notes'}`
  const folders = folder.folders.length
  return folders === 0 ? notes : `${folders} ${folders === 1 ? 'folder' : 'folders'} · ${notes}`
}
