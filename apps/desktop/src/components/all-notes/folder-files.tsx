import { memo, useEffect, useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  htmlDisplayName,
  htmlPageUrl,
  looseFiles,
  looseFilesAffectedBy,
  subscribeIndexApplied,
  type LooseFile,
  type LooseFileKind,
} from '@kore/core'
import {
  Archive,
  Globe,
  Image,
  Microphone,
  Note,
  Paperclip,
  Play,
  TableView,
  type Icon,
} from '@/components/icons'
import { previewThumbnailUrl } from '@/editor/preview-image-url'
import { useHtmlTitle } from '@/hooks/use-html-title'
import { usePassiveImageResolver } from '@/hooks/use-note-card-images'
import { formatBytes } from '@/lib/format-bytes'
import { cn } from '@/lib/utils'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { CARD_SECTION_CLASS, GRID_CARD_BUTTON_CLASS, GRID_CARD_CLASS } from './grid-card-classes'

const NO_FILES: readonly LooseFile[] = []

function looseFilesQueryKey(
  root: string | undefined,
  folder: string,
  includeSubfolders: boolean,
): readonly unknown[] {
  return [INDEX_QUERY_SCOPE, root, 'loose-files', folder, includeSubfolders]
}

const KIND_ICON: Readonly<Record<LooseFileKind, Icon>> = {
  image: Image,
  pdf: Note,
  html: Globe,
  document: Note,
  sheet: TableView,
  audio: Microphone,
  video: Play,
  archive: Archive,
  other: Paperclip,
}

/**
 * A folder's loose files (images, PDFs, pages, documents no note
 * references), newest first, kept fresh as files come and go.
 */
export function useFolderLooseFiles(
  folder: string | null,
  includeSubfolders: boolean,
): readonly LooseFile[] {
  const { graph } = useGraph()
  const generation = graph?.generation
  const root = graph?.root
  const { data: files = NO_FILES } = useQuery({
    queryKey: looseFilesQueryKey(root, folder ?? '', includeSubfolders),
    queryFn: () => looseFiles(folder ?? '', includeSubfolders, generation),
    enabled: generation !== undefined && folder !== null,
  })
  // The index queries refresh when notes change; a file added, changed or
  // removed here changes no note, so the files listen for it themselves.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (folder === null) {
      return
    }
    return subscribeIndexApplied((changes, appliedGeneration) => {
      if (
        appliedGeneration === generation &&
        looseFilesAffectedBy(changes, folder, includeSubfolders)
      ) {
        void queryClient.invalidateQueries({
          queryKey: looseFilesQueryKey(root, folder, includeSubfolders),
          exact: true,
        })
      }
    })
  }, [queryClient, root, generation, folder, includeSubfolders])
  return folder === null ? NO_FILES : files
}

interface FolderFilesProps {
  files: readonly LooseFile[]
  /** Opens a file the way Kore opens every vault file (use-asset-opener.tsx). */
  onOpen: (path: string) => void
}

/**
 * A folder page's loose files as a row of cards above a list view. The grid
 * view deals them among the notes instead (all-notes-grid.tsx).
 */
export function FolderFiles({ files, onOpen }: FolderFilesProps): ReactElement | null {
  if (files.length === 0) {
    return null
  }
  return (
    <ul aria-label="Files" className={CARD_SECTION_CLASS}>
      {files.map((file) => (
        <li key={file.path} className="min-w-0">
          <FileCard file={file} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

interface FileCardProps {
  file: LooseFile
  onOpen: (path: string) => void
}

/**
 * One loose file as a card: a picture shows itself, an HTML page its own
 * title, any other file its icon (its type is in the line under the name).
 * A card opens the file in Kore's own viewer, or the app the OS picks for it.
 */
export const FileCard = memo(function FileCard({ file, onOpen }: FileCardProps): ReactElement {
  const { graph } = useGraph()
  const generation = graph?.generation
  const resolve = usePassiveImageResolver()
  const url = file.kind === 'image' ? resolve(file.path) : null
  const picture = url === null ? undefined : previewThumbnailUrl(url)
  const pageUrl =
    file.kind === 'html' && generation !== undefined ? htmlPageUrl(generation, file.path) : null
  // A picture that fails (a format the card can't draw, a file gone since
  // the catalog listed it) falls back to the file's icon.
  const [failed, setFailed] = useState<string | null>(null)
  const pageTitle = useHtmlTitle(pageUrl, file.modifiedMs)
  // A page leads with the title its reader sees; its file name moves under
  // it. Any other file is its name, with its type under it.
  const page = file.kind === 'html'
  const name = page ? (pageTitle ?? htmlDisplayName(file.path)) : file.name
  const type = file.extension === '' ? 'File' : file.extension.toUpperCase()
  const meta = `${page ? file.name : type} · ${formatBytes(file.size)}`
  const KindIcon = KIND_ICON[file.kind]
  const showPicture = picture !== undefined && failed !== picture
  return (
    <div className={GRID_CARD_CLASS}>
      <button
        type="button"
        aria-label={`${name}, ${meta}`}
        onClick={() => onOpen(file.path)}
        className={GRID_CARD_BUTTON_CLASS}
      />
      <div
        aria-hidden
        data-testid="file-card-cover"
        className={cn(
          'flex aspect-[16/10] w-full items-center justify-center overflow-hidden',
          // A picture fills the cover; a file without one is its icon on the card itself.
          showPicture && 'bg-surface-hover',
        )}
      >
        {showPicture ? (
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
          <KindIcon className="size-10 text-text-muted" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
        <span className="truncate text-sm font-semibold text-text" title={name}>
          {name}
        </span>
        <span className="text-2xs tabular-nums text-text-secondary">{meta}</span>
      </div>
    </div>
  )
})
