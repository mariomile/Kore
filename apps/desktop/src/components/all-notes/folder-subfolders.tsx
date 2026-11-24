import { memo, useMemo, useState, type ReactElement } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  displayNoteTitle,
  recentNotesByFolder,
  type FolderPeekNote,
  type FolderTreeFolder,
} from '@kore/core'
import { Folder } from '@/components/icons'
import { useFirstImages } from '@/hooks/use-note-card-images'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { CARD_SECTION_CLASS, GRID_CARD_BUTTON_CLASS, GRID_CARD_CLASS } from './grid-card-classes'

interface FolderSubfoldersProps {
  /** The page's folder from the tree; renders nothing without subfolders. */
  folder: FolderTreeFolder | null
}

/** A folder card shows this many of the notes inside it. */
const PEEK_COUNT = 3

const NO_PEEKS: ReadonlyMap<string, readonly FolderPeekNote[]> = new Map()

/**
 * A folder page's subfolders as cards above its notes, Notion's child pages
 * made visual: each card peeks at the folder's three most recently edited
 * notes (their pictures, or their titles on a paper tile), then names the
 * folder and counts what it holds. A card opens that subfolder's own page.
 * One indexed query for every card's peek, one for their pictures.
 */
export function FolderSubfolders({ folder }: FolderSubfoldersProps): ReactElement | null {
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
    <ul aria-label="Subfolders" className={CARD_SECTION_CLASS}>
      {children.map((child) => (
        <li key={child.path} className="min-w-0">
          <FolderCard folder={child} peek={peeks.get(child.path)} pictures={pictures} />
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
}

const FolderCard = memo(function FolderCard({
  folder,
  peek,
  pictures,
}: FolderCardProps): ReactElement {
  const { navigate } = useRouter()
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
        className="flex aspect-[16/7] w-full gap-2 bg-surface-hover p-3"
      >
        {peek === undefined || peek.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Folder className="size-6 text-text-muted" />
          </div>
        ) : (
          peek.map((note) => (
            <PeekTile key={note.path} note={note} picture={pictures.get(note.path)} />
          ))
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 px-4 py-3.5">
        <Folder aria-hidden className="size-3.5 flex-none text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {folder.name}
        </span>
        <span className="flex-none text-2xs tabular-nums text-text-secondary">
          {folderCountLabel(folder)}
        </span>
      </div>
    </div>
  )
})

/** One note peeking out of a folder card: its picture, else its title on paper. */
function PeekTile({
  note,
  picture,
}: {
  note: FolderPeekNote
  picture: string | undefined
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
        <p className="line-clamp-4 p-2 text-2xs font-medium leading-snug text-text-secondary [overflow-wrap:anywhere]">
          {displayNoteTitle(note.title)}
        </p>
      )}
    </div>
  )
}

/** "12 notes", plus its folders when it has some: "3 folders · 12 notes". */
function folderCountLabel(folder: FolderTreeFolder): string {
  const notes = `${folder.noteCount} ${folder.noteCount === 1 ? 'note' : 'notes'}`
  const folders = folder.folders.length
  return folders === 0 ? notes : `${folders} ${folders === 1 ? 'folder' : 'folders'} · ${notes}`
}
