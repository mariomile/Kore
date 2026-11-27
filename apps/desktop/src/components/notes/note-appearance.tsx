import { useMemo, type ReactElement } from 'react'
import { noteFolderCrumbs, noteIconValue, parseNoteAppearanceFromSource } from '@kore/core'
import { Image, Smile } from '@/components/icons'
import { NoteFolderBreadcrumb } from '@/components/note-folder-breadcrumb'
import { cn } from '@/lib/utils'
import { COVER_GLASS_CLASS, NoteCover, type CoverEdit } from './note-cover'
import { NoteCoverPicker, type CoverUpload } from './note-cover-picker'
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
  /** Saves the cover's vertical position; the cover shows Reposition when set. */
  onCoverPositionChange?: ((coverY: number) => void) | undefined
  /**
   * The note's path, to show its folder breadcrumb at the top of the header:
   * in a frosted pill on the cover, or above the icon and title without one.
   * Omitted, no breadcrumb.
   */
  breadcrumbPath?: string | undefined
  /**
   * The header opens the page: the cover bleeds up through the page's top
   * inset (`--note-page-inset-top`, set by the hosting view) to its edge.
   */
  flushCover?: boolean
}

const ADD_ACTION_CLASS =
  'flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:bg-surface-hover focus-visible:text-text focus-visible:outline-none'

/**
 * The note's header: folder breadcrumb, then the cover image and icon from
 * reserved frontmatter keys. Absent or unresolvable values render nothing —
 * the keys stay in the file either way.
 */
export function NoteAppearance({
  source,
  resolveImageUrl,
  gutterClassName,
  showIcon = true,
  onIconChange,
  onCoverChange,
  uploadCover,
  onCoverPositionChange,
  breadcrumbPath,
  flushCover = false,
}: NoteAppearanceProps): ReactElement {
  const appearance = useMemo(() => parseNoteAppearanceFromSource(source), [source])
  const coverUrl = appearance.coverSrc !== null ? resolveImageUrl(appearance.coverSrc) : null
  const icon = appearance.icon
  const coverEdit = useMemo<CoverEdit | null>(
    () =>
      onCoverChange === undefined || uploadCover === undefined
        ? null
        : { onChange: onCoverChange, upload: uploadCover, onPositionChange: onCoverPositionChange },
    [onCoverChange, uploadCover, onCoverPositionChange],
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

  const addIcon = onIconChange !== undefined && icon === null
  const addCover = coverEdit !== null && coverUrl === null
  const hasBreadcrumb = breadcrumbPath !== undefined && noteFolderCrumbs(breadcrumbPath).length > 0
  // Round icon buttons at the right end of the breadcrumb's line, so adding
  // an icon or a cover costs the page no row of its own. Hidden until the
  // note is hovered; focus reveals them for keyboard users, and an open
  // picker keeps them up. On a cover they sit in a frosted pill opposite the
  // breadcrumb's; with no breadcrumb they float in the page's top inset.
  const addActions =
    addIcon || addCover ? (
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 flex justify-end',
          coverUrl !== null ? 'top-3' : hasBreadcrumb ? '-top-1' : 'bottom-full mb-2',
          gutterClassName,
        )}
      >
        <div
          className={cn(
            'pointer-events-auto flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover/note:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100',
            coverUrl !== null && cn('rounded-full p-0.5', COVER_GLASS_CLASS),
          )}
        >
          {addIcon ? (
            <NoteIconPicker
              value={null}
              onChange={onIconChange}
              label="Add icon"
              hint="Add icon"
              align="end"
              className={ADD_ACTION_CLASS}
            >
              <Smile aria-hidden className="size-4" />
            </NoteIconPicker>
          ) : null}
          {addCover ? (
            <NoteCoverPicker
              onChange={coverEdit.onChange}
              upload={coverEdit.upload}
              label="Add cover"
              hint="Add cover"
              align="end"
              className={ADD_ACTION_CLASS}
            >
              <Image aria-hidden className="size-4" />
            </NoteCoverPicker>
          ) : null}
        </div>
      </div>
    ) : null

  if (coverUrl !== null) {
    return (
      <div
        className={cn(
          'relative',
          iconEl !== null ? 'mb-10' : 'mb-3',
          flushCover && 'kore-note-cover-flush',
        )}
      >
        <NoteCover url={coverUrl} position={appearance.coverY} edit={coverEdit} />
        {breadcrumbPath === undefined ? null : (
          // Click-through outside the pill, so the cover keeps its hover
          // actions and drop target under the empty band.
          <div className={cn('pointer-events-none absolute inset-x-0 top-4', gutterClassName)}>
            <NoteFolderBreadcrumb
              path={breadcrumbPath}
              onCover
              className="pointer-events-auto max-w-full"
            />
          </div>
        )}
        {iconEl !== null ? (
          <div className={cn('absolute -bottom-6', gutterClassName)}>{iconEl}</div>
        ) : null}
        {addActions}
      </div>
    )
  }

  const breadcrumb =
    breadcrumbPath === undefined ? null : (
      <NoteFolderBreadcrumb path={breadcrumbPath} className={gutterClassName} />
    )
  return (
    <div className="relative">
      {breadcrumb}
      {iconEl === null ? null : <div className={cn('mb-2', gutterClassName)}>{iconEl}</div>}
      {addActions}
    </div>
  )
}
