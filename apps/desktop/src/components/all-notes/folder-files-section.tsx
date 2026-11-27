import { memo, useLayoutEffect, useState, type ReactElement } from 'react'
import type { LooseFile } from '@kore/core'
import { previewThumbnailUrl } from '@/editor/preview-image-url'
import { usePassiveImageResolver } from '@/hooks/use-note-card-images'
import { formatBytes } from '@/lib/format-bytes'
import { cn } from '@/lib/utils'
import { FileCard, KIND_ICON } from './folder-files'
import { CARD_SECTION_CLASS } from './grid-card-classes'

export type FolderFilesLayout = 'rows' | 'shelf' | 'end'

/** A row is at least this wide: two to four rows side by side on a Mac page. */
const ROW_MIN_WIDTH_REM = 15
/** The gap between rows, in px (`gap-2`). */
const ROW_GAP_PX = 8

interface FolderFilesSectionProps {
  files: readonly LooseFile[]
  onOpen: (path: string) => void
  layout: FolderFilesLayout
  /** How many lines of rows show before "Show all". */
  lines?: number
  /** The section's gutters: the Mac page's unless the phone passes its own. */
  className?: string
}

/**
 * A folder page's loose files as a section of their own, so the notes the
 * folder is about stay at the top of the page.
 */
export function FolderFilesSection({
  files,
  onOpen,
  layout,
  lines = 2,
  className = 'pb-6 pl-12 pr-7 pt-2',
}: FolderFilesSectionProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  const [grid, setGrid] = useState<HTMLUListElement | null>(null)
  const columns = useColumns(grid, ROW_MIN_WIDTH_REM, ROW_GAP_PX)
  if (files.length === 0) {
    return null
  }
  const cap = columns * lines
  const capped = layout === 'rows' && files.length > cap
  const shown = capped && !expanded ? files.slice(0, cap) : files
  return (
    <section aria-label="Files" className={className}>
      <div className="mb-2 flex h-7 items-center gap-1.5">
        <h2 className="text-[13px] font-medium text-text-secondary">Files</h2>
        <span className="text-[13px] tabular-nums text-text-muted">{files.length}</span>
        {capped ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="-mr-3 ml-auto h-7 rounded-full px-3 text-[13px] text-text-secondary transition-colors duration-150 ease-swift hover:bg-surface-hover hover:text-text"
          >
            {expanded ? 'Show less' : `Show all ${files.length}`}
          </button>
        ) : null}
      </div>
      {layout === 'rows' ? (
        <ul
          ref={setGrid}
          className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2"
        >
          {shown.map((file) => (
            <li key={file.path} className="min-w-0">
              <FileRow file={file} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : layout === 'shelf' ? (
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [mask-image:linear-gradient(to_right,black_calc(100%-4rem),transparent)] [scrollbar-width:none]">
          {files.map((file) => (
            <li key={file.path} className="w-48 flex-none snap-start">
              <FileCard file={file} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className={cn(CARD_SECTION_CLASS, 'p-0')}>
          {files.map((file) => (
            <li key={file.path} className="min-w-0">
              <FileCard file={file} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
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
      const next = Math.max(1, Math.floor((element.clientWidth + gap) / (minRem * rem + gap)))
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
  const resolve = usePassiveImageResolver()
  const url = file.kind === 'image' || file.kind === 'pdf' ? resolve(file.path) : null
  const picture = url === null ? undefined : previewThumbnailUrl(url)
  const [failed, setFailed] = useState<string | null>(null)
  const KindIcon = KIND_ICON[file.kind]
  const type = file.extension === '' ? 'File' : file.extension.toUpperCase()
  const meta = `${type} · ${formatBytes(file.size)}`
  // The type is in the line under it: two files of one name stay told apart.
  const name =
    file.extension === '' ? file.name : file.name.slice(0, -(file.extension.length + 1))
  const showPicture = picture !== undefined && failed !== picture
  return (
    <button
      type="button"
      aria-label={`${file.name}, ${meta}`}
      title={file.name}
      onClick={() => onOpen(file.path)}
      className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-surface p-2 pr-3 text-left shadow-sm transition-[background-color,box-shadow] duration-150 ease-swift hover:bg-surface-hover hover:shadow-md"
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
            onError={() => setFailed(picture)}
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
