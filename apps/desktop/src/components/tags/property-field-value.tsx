import { Fragment, type ReactElement } from 'react'
import {
  isCalendarDate,
  type CollectionValue,
  type RelationLink,
  type TagProperty,
} from '@kore/core'
import {
  CheckboxFace,
  readCellValue,
  readRelationLinks,
} from '@/components/all-notes/collection-cell'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

interface PropertyFieldValueProps {
  property: TagProperty
  value: CollectionValue | undefined
  /**
   * Follows a link inside a relation value. When given, each `[[link]]` in
   * the value draws as a link that opens its note; clicking beside the links
   * still opens the editor.
   */
  onOpenRelation?: ((target: string) => void) | undefined
}

/**
 * A property field's read-only face inside its editor trigger — shared by the
 * context rail's Properties section and the note's properties header, so a
 * value reads identically wherever the row shows itself.
 */
export function PropertyFieldValue({
  property,
  value,
  onOpenRelation,
}: PropertyFieldValueProps): ReactElement {
  const { settings } = useSettings()
  const reading = readCellValue(property, value)
  if (property.type === 'checkbox' && !reading.mismatch) {
    return <CheckboxFace checked={reading.checked} />
  }
  if (onOpenRelation !== undefined) {
    const links = readRelationLinks(property, value)
    if (links !== null) {
      return <RelationLinks links={links} onOpen={onOpenRelation} />
    }
  }
  return (
    <span
      className={cn(
        'min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-[13px] transition-colors hover:bg-surface-hover',
        reading.mismatch
          ? 'text-warning'
          : reading.text === ''
            ? 'text-text-muted'
            : 'text-text-secondary',
      )}
    >
      {reading.text === ''
        ? 'Empty'
        : property.type === 'date' && !reading.mismatch && isCalendarDate(reading.text)
          ? formatShortDate(reading.text, settings.dateFormat)
          : reading.text}
    </span>
  )
}

/**
 * A relation value drawn as links, comma-separated. Each is a span, not a
 * button: the whole value already sits inside the editor's trigger button, so
 * a click on a link opens its note and a click beside the links still opens
 * the editor. The editor's "Open" entry is the keyboard path to the same note.
 */
function RelationLinks({
  links,
  onOpen,
}: {
  links: readonly RelationLink[]
  onOpen: (target: string) => void
}): ReactElement {
  return (
    <span className="min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-[13px] transition-colors hover:bg-surface-hover">
      {links.map((link, index) => (
        <Fragment key={`${link.target}:${index}`}>
          {index > 0 ? <span className="text-text-muted">, </span> : null}
          <span
            role="link"
            title={`Open ${link.label}`}
            className="cursor-pointer text-accent hover:underline"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpen(link.target)
            }}
          >
            {link.label}
          </span>
        </Fragment>
      ))}
    </span>
  )
}
