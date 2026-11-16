import { useMemo } from 'react'
import { Priority } from '@meowdown/core'
import { useExtension } from '@meowdown/react'
import { defineMarkView } from '@prosekit/core'
import type { DateFormat } from '@kore/core'
import { formatShortDate, isIsoDate } from '@/lib/dates'

/**
 * A `[[2026-11-20]]` link reads as the app's compact date (`Nov 20`, or
 * `20 Nov`; `iso` keeps the key), like every other date chip in Kore. The
 * markdown keeps the daily-note key, and a link with its own `|label` keeps
 * the label.
 *
 * It is Meowdown's wikilink mark view (`createWikilinkMarkView`) with one
 * change, the label: Meowdown draws `display || target` and exposes no hook
 * for it, so Kore installs its own view under the same name at high
 * priority (the first `mdWikilink` view registered wins).
 */
export function DateLinkLabels({ dateFormat }: { dateFormat: DateFormat }): null {
  useExtension(
    useMemo(
      () =>
        defineMarkView({
          name: 'mdWikilink',
          constructor: (mark) => {
            const attrs = mark.attrs as { target?: string; display?: string | null }
            const target = attrs.target ?? ''
            const dom = document.createElement('span')
            dom.className = 'md-wikilink-view md-atom-view'
            const preview = document.createElement('span')
            preview.className = 'md-wikilink-view-preview md-atom-view-preview'
            preview.contentEditable = 'false'
            preview.dataset['testid'] = 'wikilink'
            dom.appendChild(preview)
            const label = document.createElement('span')
            label.className = 'md-wikilink-view-label'
            label.contentEditable = 'false'
            label.textContent =
              attrs.display !== undefined && attrs.display !== null && attrs.display !== ''
                ? attrs.display
                : isIsoDate(target)
                  ? formatShortDate(target, dateFormat)
                  : target
            preview.appendChild(label)
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
      [dateFormat],
    ),
    { priority: Priority.high },
  )
  return null
}
