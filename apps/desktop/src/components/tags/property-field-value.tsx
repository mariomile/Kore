import { Fragment, type ReactElement } from 'react'
import type { CollectionValue, TagProperty } from '@reflect/core'
import {
  CheckboxFace,
  readCellValue,
  readRelationLinks,
} from '@/components/all-notes/collection-cell'
import { cn } from '@/lib/utils'

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
  const reading = readCellValue(property, value)
  if (property.type === 'checkbox' && !reading.mismatch) {
    return <CheckboxFace checked={reading.checked} />
  }
  const links = onOpenRelation === undefined ? null : readRelationLinks(property, value)
  if (links !== null && onOpenRelation !== undefined) {
    return (
      <span className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-[13px] transition-colors hover:bg-surface-hover">
        {links.map((link, index) => (
          <Fragment key={`${link.target}:${index}`}>
            {index > 0 ? <span className="text-text-muted">, </span> : null}
            {/* A span, not a button: the whole value already sits inside the
                editor's trigger button. The editor's "Open" entry is the
                keyboard path to the same note. */}
            <span
              role="link"
              title={`Open ${link.label}`}
              className="cursor-pointer text-accent hover:underline"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenRelation(link.target)
              }}
            >
              {link.label}
            </span>
          </Fragment>
        ))}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'min-w-0 flex-1 truncate rounded px-1 py-0.5 text-[13px] transition-colors hover:bg-surface-hover',
        reading.mismatch
          ? 'text-amber-700 dark:text-amber-300'
          : reading.text === ''
            ? 'text-text-muted'
            : 'text-text-secondary',
      )}
    >
      {reading.text === '' ? 'Empty' : reading.text}
    </span>
  )
}
