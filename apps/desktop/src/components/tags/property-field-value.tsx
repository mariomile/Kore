import type { ReactElement } from 'react'
import {
  decodeStoredList,
  isCalendarDate,
  type CollectionValue,
  type RelationLink,
  type TagProperty,
} from '@kore/core'
import {
  CheckboxFace,
  PersonBadge,
  readCellValue,
  readRelationLinks,
} from '@/components/all-notes/collection-cell'
import { Note } from '@/components/icons'
import { selectOptionBadgeClass, selectOptionDotClass } from '@/components/tags/select-colors'
import { formatShortDate } from '@/lib/dates'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

interface PropertyFieldValueProps {
  property: TagProperty
  value: CollectionValue | undefined
  /**
   * Follows a link inside a relation value. When given, each `[[link]]` in
   * the value draws as a clickable note chip; clicking beside the chips still
   * opens the editor.
   */
  onOpenRelation?: ((target: string) => void) | undefined
}

function readMultiselectItems(value: CollectionValue | undefined): string[] | null {
  if (value === undefined) {
    return null
  }
  if (value.valueType === 'list') {
    const entries = decodeStoredList(value.value)
    return entries !== null && entries.length > 0 ? entries : null
  }
  return value.value === '' ? null : [value.value]
}

/**
 * A property field's read-only face inside its editor trigger — shared by the
 * context rail's Properties section and the note's properties header, giving
 * every property type clear Notion-grade visual identity (colored status/select
 * pills, multiselect badges, note chips for relations, person discs, formatted
 * dates, and crisp contrast between filled values and `Empty`).
 */
export function PropertyFieldValue({
  property,
  value,
  onOpenRelation,
}: PropertyFieldValueProps): ReactElement {
  const { settings } = useSettings()
  const mobile = isMobileSurface()
  const reading = readCellValue(property, value)
  const textSize = mobile ? 'text-[14px] leading-5' : 'text-[13px] leading-5'
  // The box is as tall as the label beside it (Mac 28px, iPhone 36px), so a
  // one-line value sits on the label's line and a long one wraps downward.
  const rowBox = cn(
    'flex min-w-0 flex-1 items-center rounded-md px-1.5 transition-colors hover:bg-surface-hover',
    mobile ? 'min-h-9 py-2 active:bg-surface-hover' : 'min-h-7 py-1',
  )

  if (property.type === 'checkbox' && !reading.mismatch) {
    return (
      <span className={rowBox}>
        <CheckboxFace checked={reading.checked} />
      </span>
    )
  }

  if (onOpenRelation !== undefined) {
    const links = readRelationLinks(property, value)
    if (links !== null) {
      return (
        <span className={cn(rowBox, 'flex-wrap gap-1')}>
          <RelationChips links={links} onOpen={onOpenRelation} />
        </span>
      )
    }
  }

  if (property.type === 'status' && !reading.mismatch && reading.text !== '') {
    return (
      <span className={rowBox}>
        <span
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-tight',
            selectOptionBadgeClass(reading.text, property),
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              selectOptionDotClass(reading.text, property),
            )}
          />
          <span className="truncate">{reading.text}</span>
        </span>
      </span>
    )
  }

  if (property.type === 'select' && !reading.mismatch && reading.text !== '') {
    return (
      <span className={rowBox}>
        <span
          className={cn(
            'truncate rounded-[5px] px-2 py-0.5 text-xs font-medium leading-tight',
            selectOptionBadgeClass(reading.text, property),
          )}
        >
          {reading.text}
        </span>
      </span>
    )
  }

  if (property.type === 'multiselect' && !reading.mismatch) {
    const items = readMultiselectItems(value)
    if (items !== null) {
      return (
        <span className={cn(rowBox, 'flex-wrap gap-1')}>
          {items.map((item) => (
            <span
              key={item}
              className={cn(
                'truncate rounded-[5px] px-2 py-0.5 text-xs font-medium leading-tight',
                selectOptionBadgeClass(item, property),
              )}
            >
              {item}
            </span>
          ))}
        </span>
      )
    }
  }

  if (property.type === 'person' && !reading.mismatch && reading.text !== '') {
    return (
      <span className={cn(rowBox, 'gap-1.5')}>
        <PersonBadge name={reading.text} />
        <span className={cn('truncate text-text', textSize)}>{reading.text}</span>
      </span>
    )
  }

  const formattedText =
    (property.type === 'date' || property.type === 'created' || property.type === 'updated') &&
    !reading.mismatch &&
    isCalendarDate(reading.text)
      ? formatShortDate(reading.text, settings.dateFormat)
      : reading.text

  return (
    <span className={rowBox}>
      <span
        className={cn(
          // Wrapped, never cut: a description or a tldr is read in full, the
          // way Notion and Craft show long text properties.
          'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]',
          textSize,
          (property.type === 'number' || property.type === 'rating') &&
            !reading.mismatch &&
            'tabular-nums',
          property.type === 'url' &&
            !reading.mismatch &&
            formattedText !== '' &&
            'underline decoration-border-strong underline-offset-2',
          reading.mismatch
            ? 'text-warning'
            : formattedText === ''
              ? 'text-text-muted/60'
              : 'text-text',
        )}
      >
        {formattedText === '' ? 'Empty' : formattedText}
      </span>
    </span>
  )
}

/**
 * A relation value drawn as subtle note chips. Each chip is a span (`role="link"`),
 * not a nested button, because the value sits inside the editor's trigger button:
 * clicking a chip navigates to that note while clicking beside it opens the picker.
 */
function RelationChips({
  links,
  onOpen,
}: {
  links: readonly RelationLink[]
  onOpen: (target: string) => void
}): ReactElement {
  return (
    <>
      {links.map((link, index) => (
        <span
          key={`${link.target}:${index}`}
          role="link"
          title={`Open ${link.label}`}
          className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-[5px] bg-surface-hover px-1.5 py-0.5 text-xs font-medium text-text transition-colors hover:bg-surface-active"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpen(link.target)
          }}
        >
          <Note aria-hidden className="size-3 shrink-0 text-text-muted" />
          <span className="truncate">{link.label}</span>
        </span>
      ))}
    </>
  )
}
