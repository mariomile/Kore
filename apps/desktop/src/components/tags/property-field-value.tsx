import type { ReactElement } from 'react'
import type { CollectionValue, TagProperty } from '@reflect/core'
import { CheckboxFace, readCellValue } from '@/components/all-notes/collection-cell'
import { cn } from '@/lib/utils'

interface PropertyFieldValueProps {
  property: TagProperty
  value: CollectionValue | undefined
}

/**
 * A property field's read-only face inside its editor trigger — shared by the
 * context rail's Properties section and the note's properties header, so a
 * value reads identically wherever the row shows itself.
 */
export function PropertyFieldValue({ property, value }: PropertyFieldValueProps): ReactElement {
  const reading = readCellValue(property, value)
  if (property.type === 'checkbox' && !reading.mismatch) {
    return <CheckboxFace checked={reading.checked} />
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
