import { useState, type ReactElement, type ReactNode } from 'react'
import { isCalendarDate, type CollectionValue, type TagProperty } from '@kore/core'
import { readCellValue } from '@/components/all-notes/collection-cell'
import { ChevronDown } from '@/components/icons'
import { selectOptionBadgeClass, selectOptionDotClass } from '@/components/tags/select-colors'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { NoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { hapticImpactLight } from '@/mobile/haptics'
import { useSettings } from '@/providers/settings-provider'

/** Last segment of a nested tag (`Domain/ai` → `ai`): the phone row is narrow. */
function tagLeaf(tag: string): string {
  const parts = tag.split('/')
  return parts[parts.length - 1] || tag
}

const TAG_TINTS = [
  'bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]',
  'bg-[color-mix(in_oklab,#34c759_16%,transparent)]',
  'bg-[color-mix(in_oklab,#ff9500_16%,transparent)]',
  'bg-[color-mix(in_oklab,#ff2d55_14%,transparent)]',
]

interface SummaryPreview {
  key: string
  property: TagProperty
  text: string
}

function summaryPreview(
  property: TagProperty,
  value: CollectionValue | undefined,
  dateFormat: 'mdy' | 'dmy' | 'iso',
): SummaryPreview | null {
  const reading = readCellValue(property, value)
  if (reading.mismatch) {
    return null
  }
  if (property.type === 'checkbox') {
    return reading.checked ? { key: property.key, property, text: property.name } : null
  }
  if (reading.text === '') {
    return null
  }
  const text =
    (property.type === 'date' || property.type === 'created' || property.type === 'updated') &&
    isCalendarDate(reading.text)
      ? formatShortDate(reading.text, dateFormat)
      : reading.text
  return { key: property.key, property, text }
}

interface NoteFieldSummaryProps {
  fields: NoteTypedProperties
  /** The full, editable field list shown when the row is expanded. */
  children: ReactNode
}

/**
 * Phone-only folded properties: shows the note's tags and its first filled
 * schema values as crisp pills, and smoothly animates open/closed (`grid-rows`)
 * so expanding properties feels fluid instead of snapping abruptly.
 */
export function NoteFieldSummary({ fields, children }: NoteFieldSummaryProps): ReactElement {
  const { settings } = useSettings()
  const [open, setOpen] = useState(false)
  const [rendered, setRendered] = useState(false)
  const previews = fields.properties
    .filter((property) => fields.ownerTagOf(property.key) !== null)
    .map((property) => summaryPreview(property, fields.values?.[property.key], settings.dateFormat))
    .filter((item): item is SummaryPreview => item !== null)
    .slice(0, 2)

  return (
    <section aria-label="Properties" className="mb-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          hapticImpactLight()
          setOpen((value) => {
            const next = !value
            if (next) {
              setRendered(true)
            }
            return next
          })
        }}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg py-1 text-left text-[13px] font-medium text-text-muted active:opacity-70"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {fields.tags.map((entry, index) => (
            <span
              key={entry.tagKey}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[12px] font-medium text-text',
                TAG_TINTS[index % TAG_TINTS.length],
              )}
            >
              # {tagLeaf(entry.tag)}
            </span>
          ))}
          {!open &&
            previews.map((item) =>
              item.property.type === 'status' ? (
                <span
                  key={item.key}
                  className={cn(
                    'inline-flex max-w-[10rem] items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium',
                    selectOptionBadgeClass(item.text, item.property),
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      selectOptionDotClass(item.text, item.property),
                    )}
                  />
                  <span className="truncate">{item.text}</span>
                </span>
              ) : item.property.type === 'select' ? (
                <span
                  key={item.key}
                  className={cn(
                    'max-w-[10rem] truncate rounded-[5px] px-2 py-0.5 text-[12px] font-medium',
                    selectOptionBadgeClass(item.text, item.property),
                  )}
                >
                  {item.text}
                </span>
              ) : (
                <span key={item.key} className="max-w-[9rem] truncate text-[12px] text-text-muted">
                  {item.text}
                </span>
              ),
            )}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-text-muted transition-transform duration-200 ease-swift motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !open) {
            setRendered(false)
          }
        }}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-swift motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden" aria-hidden={!open} inert={!open}>
          {rendered ? <div className="mt-2 border-b border-border pb-3">{children}</div> : null}
        </div>
      </div>
    </section>
  )
}
