import { memo, useLayoutEffect, useState, type ReactElement } from 'react'
import type { LooseFile } from '@kore/core'
import { formatBytes } from '@/lib/format-bytes'
import { cn } from '@/lib/utils'
import { columnsThatFit } from '@/lib/deal-columns'
import { fileStem, fileTypeLabel, KIND_ICON, useFilePicture } from './folder-files'
import { GRID_CARD_SURFACE_CLASS } from './grid-card-classes'

/** A row is at least this wide: two to four side by side on a Mac page, one on a phone. */
const ROW_MIN_WIDTH_REM = 15
/** The gap between rows, in px (`gap-2`). */
const ROW_GAP_PX = 8

interface FolderFilesSectionProps {
  files: readonly LooseFile[]
  onOpen: (path: string) => void
  /**
   * How many lines of rows show before "Show all"; `null` shows every file
   * (a folder of files alone has nothing for them to push down).
   */
  lines: number | null
  /** The section's gutters: the Mac page's unless the phone passes its own. */
  className?: string
}

/**
 * A folder page's loose files (the PDFs, pages, sheets no note references)
 * as a compact section above its notes: a couple of lines of small rows and
 * "Show all" for the rest, so the notes the folder is about start right
 * under it instead of a few screens down. The rest are not mounted until
 * asked for. The File type filter still lists them as big cards.
 */
export function FolderFilesSection({
  files,
  onOpen,
  lines,
  className = 'pb-6 pl-12 pr-7 pt-2',
}: FolderFilesSectionProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  const [grid, setGrid] = useState<HTMLUListElement | null>(null)
  const columns = useColumns(grid, ROW_MIN_WIDTH_REM, ROW_GAP_PX)
  if (files.length === 0) {
    return null
  }
  const cap = lines === null ? files.length : columns * lines
  const capped = files.length > cap
  const shown = capped && !expanded ? files.slice(0, cap) : files
  return (
    <section aria-label="Files" className={className}>
      <div className="mb-2 flex h-7 items-center gap-1.5">
        <h2 className="text-[13px] font-medium text-text-secondary">Files</h2>
        <span className="text-[13px] tabular-nums text-text-muted">{files.length}</span>
        {capped ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            // 28pt to the eye, 44pt to the finger.
            className="relative -mr-3 ml-auto h-7 rounded-full px-3 text-[13px] text-text-secondary transition-colors duration-150 ease-swift after:absolute after:inset-x-0 after:-inset-y-2 hover:bg-surface-hover hover:text-text active:bg-surface-active"
          >
            {expanded ? 'Show less' : `Show all ${files.length}`}
          </button>
        ) : null}
      </div>
      <ul ref={setGrid} className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
        {shown.map((file) => (
          <li key={file.path} className="min-w-0">
            <FileRow file={file} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** How many columns of `minRem` fit the element's width, measured before paint. */
function useColumns(element: HTMLElement | null, minRem: number, gap: number): number {
  const [count, setCount] = useState(1)
  useLayoutEffect(() => {
    if (element === null) {
      return
    }
    const measure = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      const next = columnsThatFit(element.clientWidth, minRem * rem, gap)
      setCount((current) => (current === next ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, minRem, gap])
  return count
}

/**
 * One loose file as a compact row: its picture (or its icon) small, then
 * its name and type. The file name, not a page's title: a folder of CVs is
 * told apart by its file names, and a row reads no file to draw itself.
 */
const FileRow = memo(function FileRow({
  file,
  onOpen,
}: {
  file: LooseFile
  onOpen: (path: string) => void
}): ReactElement {
  const { picture, showPicture, onPictureError } = useFilePicture(file)
  const KindIcon = KIND_ICON[file.kind]
  const meta = `${fileTypeLabel(file)} · ${formatBytes(file.size)}`
  // The type is in the line under it: two files of one name stay told apart.
  const name = fileStem(file)
  return (
    <button
      type="button"
      aria-label={`${file.name}, ${meta}`}
      title={file.name}
      onClick={() => onOpen(file.path)}
      className={cn(
        'flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl p-2 pr-3 text-left transition-shadow duration-150 ease-swift hover:shadow-md active:shadow-none',
        GRID_CARD_SURFACE_CLASS,
      )}
    >
      <span
        aria-hidden
        className="flex size-10 flex-none items-center justify-center overflow-hidden rounded-lg bg-surface-hover"
      >
        {showPicture ? (
          <img
            src={picture}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={onPictureError}
            className={cn('size-full object-cover', file.kind === 'pdf' && 'object-top')}
          />
        ) : (
          <KindIcon className="size-5 text-text-muted" />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-text">{name}</span>
        <span className="text-2xs tabular-nums text-text-secondary">{meta}</span>
      </span>
    </button>
  )
})
