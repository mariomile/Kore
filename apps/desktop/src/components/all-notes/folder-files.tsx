import { memo, useEffect, useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  looseFiles,
  looseFilesAffectedBy,
  subscribeIndexApplied,
  type LooseFile,
  type LooseFileKind,
} from '@kore/core'
import {
  Archive,
  Image,
  Microphone,
  Note,
  Paperclip,
  Play,
  TableView,
  type Icon,
} from '@/components/icons'
import { previewThumbnailUrl } from '@/editor/preview-image-url'
import { usePassiveImageResolver } from '@/hooks/use-note-card-images'
import { formatBytes } from '@/lib/format-bytes'
import { cn } from '@/lib/utils'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { CARD_SECTION_CLASS, GRID_CARD_BUTTON_CLASS, GRID_CARD_CLASS } from './grid-card-classes'

interface FolderFilesProps {
  /** The folder page's folder. */
  folder: string
  includeSubfolders: boolean
  /** Opens a file the way Kore opens every vault file (use-asset-opener.tsx). */
  onOpen: (path: string) => void
}

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
  document: Note,
  sheet: TableView,
  audio: Microphone,
  video: Play,
  archive: Archive,
  other: Paperclip,
}

/**
 * A folder page's loose files (images, PDFs, documents no note references)
 * as cards beside its subfolders, in the same columns: a picture shows
 * itself, any other file its icon (its type is in the line under the name). A card opens the
 * file in the in-app viewer, or the app the OS picks for it.
 */
export function FolderFiles({
  folder,
  includeSubfolders,
  onOpen,
}: FolderFilesProps): ReactElement | null {
  const { graph } = useGraph()
  const resolve = usePassiveImageResolver()
  const generation = graph?.generation
  const root = graph?.root
  const { data: files = NO_FILES } = useQuery({
    queryKey: looseFilesQueryKey(root, folder, includeSubfolders),
    queryFn: () => looseFiles(folder, includeSubfolders, generation),
    enabled: generation !== undefined,
  })
  // The index queries refresh when notes change; a file added, changed or
  // removed here changes no note, so the cards listen for it themselves.
  const queryClient = useQueryClient()
  useEffect(
    () =>
      subscribeIndexApplied((changes, appliedGeneration) => {
        if (
          appliedGeneration === generation &&
          looseFilesAffectedBy(changes, folder, includeSubfolders)
        ) {
          void queryClient.invalidateQueries({
            queryKey: looseFilesQueryKey(root, folder, includeSubfolders),
            exact: true,
          })
        }
      }),
    [queryClient, root, generation, folder, includeSubfolders],
  )
  if (files.length === 0) {
    return null
  }
  return (
    <ul aria-label="Files" className={CARD_SECTION_CLASS}>
      {files.map((file) => {
        const url = file.kind === 'image' ? resolve(file.path) : null
        return (
          <li key={file.path} className="min-w-0">
            <FileCard
              file={file}
              picture={url === null ? undefined : previewThumbnailUrl(url)}
              onOpen={onOpen}
            />
          </li>
        )
      })}
    </ul>
  )
}

interface FileCardProps {
  file: LooseFile
  picture: string | undefined
  onOpen: (path: string) => void
}

const FileCard = memo(function FileCard({ file, picture, onOpen }: FileCardProps): ReactElement {
  // A picture that fails (a format the card can't draw, a file gone since
  // the catalog listed it) falls back to the file's icon.
  const [failed, setFailed] = useState<string | null>(null)
  const type = file.extension === '' ? 'File' : file.extension.toUpperCase()
  const meta = `${type} · ${formatBytes(file.size)}`
  const KindIcon = KIND_ICON[file.kind]
  const showPicture = picture !== undefined && failed !== picture
  return (
    <div className={GRID_CARD_CLASS}>
      <button
        type="button"
        aria-label={`${file.name}, ${meta}`}
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
        <span className="truncate text-sm font-semibold text-text" title={file.name}>
          {file.name}
        </span>
        <span className="text-2xs tabular-nums text-text-secondary">{meta}</span>
      </div>
    </div>
  )
})
