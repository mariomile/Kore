import { useLayoutEffect, type RefObject } from 'react'
import type { DateFormat } from '@kore/core'
import { formatDateChip, isIsoDate } from '@/lib/dates'

/** The hidden source of a plain link, `[[target]]`, capturing the target. */
const LINK_SOURCE = /^\[\[([^\]|#]+)\]\]$/

/**
 * Draw the date links of a read-only rendering (`MarkdownView`) as the
 * editor's date chips (`date-chips.tsx`), so a day drawn statically in the
 * daily stream reads its dates the way the editor does. The label's text node is edited in place, as `callout-dom.ts` does,
 * so the renderer's own tree stays intact; the view is never editable, so
 * nothing reaches the disk.
 */
function decorateDateLinks(host: Element, label: (date: string) => string): void {
  for (const link of host.querySelectorAll('.md-wikilink-view')) {
    const text = link.querySelector('.md-wikilink-view-label')
    const source = link.querySelector('.md-atom-view-content')?.textContent ?? ''
    const target = LINK_SOURCE.exec(source)?.[1]
    const date = target !== undefined && isIsoDate(target) ? target : undefined
    if (text === null || text.firstChild === null) {
      continue
    }
    text.classList.toggle('kore-date-chip', date !== undefined)
    text.toggleAttribute('data-date-link', date !== undefined)
    const wanted = date === undefined ? null : label(date)
    if (wanted !== null && text.firstChild.nodeValue !== wanted) {
      text.firstChild.nodeValue = wanted
    }
  }
}

/**
 * Keep the date links under `hostRef` drawn as chips in `dateFormat` for as
 * long as it is mounted; without a format they keep the plain key. The host wraps a `MarkdownView`, which may re-render after this
 * commit; the observer catches that, and our own edit is a no-op on the
 * second pass.
 */
export function useDateChipDom(
  hostRef: RefObject<HTMLElement | null>,
  dateFormat: DateFormat | undefined,
): void {
  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null || dateFormat === undefined) {
      return
    }
    const label = (date: string): string => formatDateChip(date, dateFormat)
    decorateDateLinks(host, label)
    const observer = new MutationObserver(() => {
      decorateDateLinks(host, label)
    })
    observer.observe(host, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
    }
  }, [hostRef, dateFormat])
}
