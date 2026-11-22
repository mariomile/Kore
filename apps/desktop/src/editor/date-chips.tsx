import { useMemo } from 'react'
import { Priority } from '@meowdown/core'
import { useExtension } from '@meowdown/react'
import { defineMarkView, definePlugin, union } from '@prosekit/core'
import type { DateFormat } from '@kore/core'
import { formatDateChip, isIsoDate } from '@/lib/dates'
import { createDateChipPlugin } from './date-chip-plugin'

interface DateChipsProps {
  /** How a date reads (the user's `dateFormat` setting). */
  dateFormat: DateFormat
}

/**
 * Dates in a note's text read as chips: `Mon, Nov 16` (or `Mon 16 Nov`; `iso`
 * keeps the key), the weekday giving way to the year away from the current
 * one. Both shapes a date takes in markdown get one: a `[[2026-11-16]]` link
 * (which still opens that day) and a date typed as plain text
 * (`date-chip-plugin`). The markdown never changes, and a link with its own
 * `|label` keeps the label.
 *
 * The link chip is Meowdown's wikilink mark view (`createWikilinkMarkView`)
 * with one change, the label: Meowdown draws `display || target` and exposes
 * no hook for it, so Kore installs its own view under the same name at high
 * priority (the first `mdWikilink` view registered wins).
 */
export function DateChips({ dateFormat }: DateChipsProps): null {
  useExtension(
    useMemo(() => {
      const label = (date: string): string => formatDateChip(date, dateFormat)
      return union(
        defineMarkView({
          name: 'mdWikilink',
          constructor: (mark) => {
            const attrs = mark.attrs as {
              target?: string
              display?: string | null
            }
            const target = attrs.target ?? ''
            const dom = document.createElement('span')
            dom.className = 'md-wikilink-view md-atom-view'
            const preview = document.createElement('span')
            preview.className = 'md-wikilink-view-preview md-atom-view-preview'
            preview.contentEditable = 'false'
            preview.dataset['testid'] = 'wikilink'
            dom.appendChild(preview)
            const text = document.createElement('span')
            text.className = 'md-wikilink-view-label'
            text.contentEditable = 'false'
            const display = attrs.display ?? ''
            const isDate = display === '' && isIsoDate(target)
            if (isDate) {
              text.classList.add('kore-date-chip')
              text.dataset['dateLink'] = ''
            }
            text.textContent = display !== '' ? display : isDate ? label(target) : target
            preview.appendChild(text)
            const contentDOM = document.createElement('span')
            contentDOM.className = 'md-wikilink-view-content md-atom-view-content'
            dom.appendChild(contentDOM)
            return {
              dom,
              contentDOM,
              ignoreMutation: (mutation) => !contentDOM.contains(mutation.target),
            }
          },
        }),
        definePlugin(createDateChipPlugin(label)),
      )
    }, [dateFormat]),
    { priority: Priority.high },
  )
  return null
}
