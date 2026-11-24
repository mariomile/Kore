import { memo, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { looseFiles, type LooseFile, type LooseFileKind } from '@kore/core'
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
 * itself, any other file a sheet of paper naming its type. A card opens the
 * file in the in-app viewer, or the app the OS picks for it.
 */
export function FolderFiles({
  folder,
  includeSubfolders,
  onOpen,
}: FolderFilesProps): ReactElement | null {
  const { graph } = useGraph()
  const resolve = usePassiveImageResolver()
  const { data: files = NO_FILES } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'loose-files', folder, includeSubfolders],
    queryFn: () => looseFiles(folder, includeSubfolders),
    enabled: graph !== null && graph !== undefined,
  })
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
  // the catalog listed it) falls back to the paper sheet.
  const [failed, setFailed] = useState<string | null>(null)
  const type = file.extension === '' ? 'File' : file.extension.toUpperCase()
  const meta = `${type} · ${formatBytes(file.size)}`
  const KindIcon = KIND_ICON[file.kind]
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
        className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-surface-hover"
      >
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
          <div className="flex aspect-[3/4] h-3/4 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-surface">
            <KindIcon className="size-5 text-text-muted" />
            <span className="text-2xs font-semibold tracking-wide text-text-secondary">{type}</span>
          </div>
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
