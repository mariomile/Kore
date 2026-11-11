import { useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { noteIconValue, parseNoteAppearanceFromSource } from '@kore/core'
import { NoteIconGlyph } from '@/components/notes/note-icon-glyph'
import { NoteIconPicker } from '@/components/notes/note-icon-picker'
import { createTitleIconPlugin } from './title-icon-plugin'

interface NoteTitleIconProps {
  /** Exact frontmatter bytes, where `icon:` lives. */
  header: string
  resolveImageUrl: (src: string) => string | null
  /** Makes the icon a picker trigger; omitted, it only renders. */
  onIconChange?: ((icon: string | null) => void) | undefined
  /** Whether the note has a `#` title the icon is drawn beside. */
  onTitle: (hasTitle: boolean) => void
}

/**
 * The note icon drawn inline at the start of the title line, left of the
 * title text (`title-icon-plugin` places the slot). Mounted as a NoteEditor
 * child. Renders nothing into the slot while the note has no icon.
 */
export function NoteTitleIcon({
  header,
  resolveImageUrl,
  onIconChange,
  onTitle,
}: NoteTitleIconProps): ReactElement {
  const [mount] = useState(() => {
    const element = document.createElement('span')
    element.className = 'inline-block'
    element.contentEditable = 'false'
    return element
  })
  useExtension(
    useMemo(() => definePlugin(createTitleIconPlugin({ mount, onTitle })), [mount, onTitle]),
  )

  const icon = useMemo(() => parseNoteAppearanceFromSource(header).icon, [header])
  let content: ReactElement | null = null
  if (icon !== null) {
    const glyph = <NoteIconGlyph icon={icon} resolveImageUrl={resolveImageUrl} size="inline" />
    content =
      onIconChange === undefined ? (
        glyph
      ) : (
        <NoteIconPicker
          value={noteIconValue(icon)}
          onChange={onIconChange}
          label="Change icon"
          className="-m-1 flex p-1"
        >
          {glyph}
        </NoteIconPicker>
      )
  }

  return createPortal(
    content === null ? null : (
      <span className="me-[0.3em] inline-flex h-[1lh] items-center align-top">{content}</span>
    ),
    mount,
  )
}
