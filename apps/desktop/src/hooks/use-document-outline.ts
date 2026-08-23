import { useCallback, useEffect, useState } from 'react'

export interface OutlineEntry {
  /** Heading depth, 1–6, as rendered. */
  level: number
  /** The heading's visible text. */
  text: string
  /** Position among the surface's headings — stable enough to key a list. */
  index: number
}

/** The editor surface whose headings the outline describes. */
const SURFACE = '.reflect-note-surface .ProseMirror'

/**
 * Only *direct* children of the editor root. A `## Meetings` nested in a
 * blockquote or a list item is quoted prose, not a section — the same rule
 * `topLevelHeadings` applies to the parsed model, expressed here as a
 * child combinator instead.
 */
const HEADINGS = `${SURFACE} > :is(h1, h2, h3, h4, h5, h6)`

function readHeadings(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(HEADINGS)]
}

function toEntries(elements: readonly HTMLElement[]): OutlineEntry[] {
  return elements.map((element, index) => ({
    level: Number.parseInt(element.tagName.slice(1), 10),
    text: element.textContent?.trim() ?? '',
    index,
  }))
}

function sameEntries(a: readonly OutlineEntry[], b: readonly OutlineEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.level === b[index]?.level && entry.text === b[index]?.text)
  )
}

export interface DocumentOutline {
  entries: OutlineEntry[]
  /** Scroll the heading at `index` into view. */
  reveal: (index: number) => void
}

/**
 * The open note's heading outline, read from the rendered document rather
 * than from a parse of its source.
 *
 * That is a deliberate choice, not a shortcut. The editor is ProseMirror-backed,
 * so its positions are document nodes, not markdown character offsets — a
 * heading's `from` from `parseNote` cannot be handed to the editor to scroll
 * to. Reading the DOM sidesteps the mapping entirely, stays correct about
 * nesting by construction (a heading inside a blockquote simply isn't a direct
 * child), and is always in step with what the user is looking at, including
 * text they are typing right now.
 *
 * A MutationObserver keeps it current; entries are compared before publishing
 * so keystrokes inside a paragraph don't re-render the panel.
 */
export function useDocumentOutline(): DocumentOutline {
  const [entries, setEntries] = useState<OutlineEntry[]>([])

  useEffect(() => {
    const sync = (): void => {
      const next = toEntries(readHeadings())
      // Functional update + bail on an identical reference: typing inside a
      // paragraph re-runs the read but never re-renders the panel.
      setEntries((previous) => (sameEntries(previous, next) ? previous : next))
    }
    // Coalesce to one read per frame: the observer fires for every mutation
    // batch anywhere in the document (toasts, spinners, unrelated panels),
    // and a keystroke burst would otherwise re-query the DOM per batch.
    let pending = 0
    const schedule = (): void => {
      if (pending !== 0) {
        return
      }
      pending = requestAnimationFrame(() => {
        pending = 0
        sync()
      })
    }
    sync()
    // The surface mounts after this hook on a note switch, so observe the
    // document and let the selector do the narrowing rather than waiting for
    // an element that may not exist yet.
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      if (pending !== 0) {
        cancelAnimationFrame(pending)
      }
    }
  }, [])

  const reveal = useCallback((index: number) => {
    // Re-read at click time: the outline can be a frame behind an edit, and
    // scrolling the wrong heading is worse than scrolling none.
    readHeadings()[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  return { entries, reveal }
}
