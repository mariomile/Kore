import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { noteIconValue, parseNoteAppearanceFromSource } from '@kore/core'
import { Image, Smile } from '@/components/icons'
import { cn } from '@/lib/utils'
import {
  dragHasFiles,
  firstImageFile,
  NoteCoverPicker,
  type CoverUpload,
} from './note-cover-picker'
import { NoteIconGlyph } from './note-icon-glyph'
import { NoteIconPicker } from './note-icon-picker'

interface NoteAppearanceProps {
  /** Exact frontmatter bytes (or the full note source). */
  source: string
  resolveImageUrl: (src: string) => string | null
  /** Aligns the icon with the editor column when there is no cover. */
  gutterClassName?: string | undefined
  /**
   * Draw the icon here, above the body. False when the note's `#` title
   * line draws it instead (`NoteTitleIcon`), left of the title text.
   */
  showIcon?: boolean
  /**
   * Makes the icon editable: the icon opens a picker, and a note without one
   * shows "Add icon" while the pointer is over the note (a `group/note`
   * ancestor) or the control has focus. Omitted, the header only renders.
   */
  onIconChange?: ((icon: string | null) => void) | undefined
  /**
   * Makes the cover editable, together with {@link uploadCover}: "Add cover"
   * joins "Add icon" on hover, and an existing cover shows Change and Remove
   * and takes a dropped image.
   */
  onCoverChange?: ((cover: string | null) => void) | undefined
  /** Copies a picked or dropped image into the vault for the cover. */
  uploadCover?: CoverUpload | undefined
}

interface CoverEdit {
  onChange: (cover: string | null) => void
  upload: CoverUpload
}

const HOVER_ACTION_CLASS =
  'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text'

const COVER_ACTION_CLASS =
  'rounded-md bg-surface/90 px-2 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-sm transition-colors hover:bg-surface hover:text-text'

/**
 * The cover image. Editable, it shows Change and Remove while hovered (or
 * focused, or while its picker is open) and replaces itself with an image
 * dropped on it.
 */
function NoteCover({ url, edit }: { url: string; edit: CoverEdit | null }): ReactElement {
  const [dragOver, setDragOver] = useState(false)
  const image = (
    <img data-testid="note-cover" src={url} alt="" className="h-40 w-full object-cover" />
  )
  if (edit === null) {
    return image
  }
  const onDrop = (event: DragEvent): void => {
    if (!dragHasFiles(event)) {
      return
    }
    event.preventDefault()
    setDragOver(false)
    const file = firstImageFile(event.dataTransfer.files)
    if (file !== null) {
      void edit.upload(file).then((path) => {
        if (path !== null) {
          edit.onChange(path)
        }
      })
    }
  }
  return (
    <div
      className="group/cover relative"
      onDragOver={(event) => {
        if (dragHasFiles(event)) {
          event.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {image}
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 bg-surface-inverse/30 ring-2 ring-border-focus ring-inset" />
      ) : null}
      <div className="absolute right-3 bottom-3 flex gap-1 opacity-0 transition-opacity duration-100 group-hover/cover:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100">
        <NoteCoverPicker
          onChange={edit.onChange}
          upload={edit.upload}
          label="Change cover"
          className={COVER_ACTION_CLASS}
        >
          Change
        </NoteCoverPicker>
        <button
          type="button"
          aria-label="Remove cover"
          className={COVER_ACTION_CLASS}
          onClick={() => edit.onChange(null)}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

/**
 * Cover image and icon from reserved frontmatter keys. Absent or unresolvable
 * values render nothing — the keys stay in the file either way.
 */
export function NoteAppearance({
  source,
  resolveImageUrl,
  gutterClassName,
  showIcon = true,
  onIconChange,
  onCoverChange,
  uploadCover,
}: NoteAppearanceProps): ReactElement | null {
  const appearance = useMemo(() => parseNoteAppearanceFromSource(source), [source])
  const coverUrl = appearance.coverSrc !== null ? resolveImageUrl(appearance.coverSrc) : null
  const icon = appearance.icon
  const coverEdit = useMemo<CoverEdit | null>(
    () =>
      onCoverChange === undefined || uploadCover === undefined
        ? null
        : { onChange: onCoverChange, upload: uploadCover },
    [onCoverChange, uploadCover],
  )

  let iconEl: ReactElement | null = null
  if (icon !== null && showIcon) {
    const glyph = <NoteIconGlyph icon={icon} resolveImageUrl={resolveImageUrl} size="block" />
    iconEl =
      onIconChange === undefined ? (
        glyph
      ) : (
        <NoteIconPicker
          value={noteIconValue(icon)}
          onChange={onIconChange}
          label="Change icon"
          className="-m-1 block p-1"
        >
          {glyph}
        </NoteIconPicker>
      )
  }

  // Hidden, not absent, until the note is hovered: the row keeps its height
  // so the title never jumps under the pointer, and focus reveals it for
  // keyboard users. An open picker keeps it visible.
  const addIcon = onIconChange !== undefined && icon === null
  const addCover = coverEdit !== null && coverUrl === null
  const addRow =
    addIcon || addCover ? (
      <div
        className={cn(
          'flex h-7 items-center gap-1 opacity-0 transition-opacity duration-100 group-hover/note:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100',
          gutterClassName,
        )}
      >
        {addIcon ? (
          <NoteIconPicker
            value={null}
            onChange={onIconChange}
            label="Add icon"
            className={HOVER_ACTION_CLASS}
          >
            <Smile aria-hidden className="size-3.5" />
            Add icon
          </NoteIconPicker>
        ) : null}
        {addCover ? (
          <NoteCoverPicker
            onChange={coverEdit.onChange}
            upload={coverEdit.upload}
            label="Add cover"
            className={HOVER_ACTION_CLASS}
          >
            <Image aria-hidden className="size-3.5" />
            Add cover
          </NoteCoverPicker>
        ) : null}
      </div>
    ) : null

  if (coverUrl === null && iconEl === null) {
    return addRow
  }

  if (coverUrl !== null) {
    return (
      <div className={cn('relative', iconEl !== null ? 'mb-10' : 'mb-3')}>
        <NoteCover url={coverUrl} edit={coverEdit} />
        {iconEl !== null ? (
          <div className={cn('absolute -bottom-6', gutterClassName)}>{iconEl}</div>
        ) : null}
        {addRow === null ? null : <div className="mt-2">{addRow}</div>}
      </div>
    )
  }

  return (
    <>
      <div className={cn('mb-2', gutterClassName)}>{iconEl}</div>
      {addRow}
    </>
  )
}
