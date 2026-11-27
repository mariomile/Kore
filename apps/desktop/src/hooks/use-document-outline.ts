import { useEffect, useState, type RefObject } from 'react'
import { findNoteTitle } from '@/editor/note-title-placement'

export interface OutlineEntry {
  /** Heading depth, 1–6, as rendered. */
  level: number
  /** The heading's visible text. */
  text: string
  /** Position among the outline's headings — stable enough to key a list. */
  index: number
}

/**
 * The editor surface whose headings the outline describes. The note pane
 * puts `kore-note-surface` on the ProseMirror root itself; a wrapper that
 * carries it (the daily day) holds the root inside.
 */
const SURFACE = ':is(.ProseMirror.kore-note-surface, .kore-note-surface .ProseMirror)'

/**
 * Only *direct* children of the editor root. A `## Meetings` nested in a
 * blockquote or a list item is quoted prose, not a section — the same rule
 * `topLevelHeadings` applies to the parsed model, expressed here as a walk
 * over the root's children instead.
 */
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/**
 * How far down the view a heading may sit and still be the section the
 * reader is in: once a heading has scrolled into the top third, its section
 * is the one on screen.
 */
const CURRENT_SECTION_LINE = 0.3

/**
 * The note's section headings inside `scope`, in document order. The note's
 * title (its leading `#` line, the same one the fields slot anchors to) is
 * the page's name rather than a section of it, so it stays out — the outline
 * jumps between sections.
 */
function readHeadings(scope: ParentNode): HTMLElement[] {
  const surface = scope.querySelector<HTMLElement>(SURFACE)
  if (surface === null) {
    return []
  }
  const title = findNoteTitle(surface)
  // Walk the root's children rather than querying the subtree: this runs once
  // a frame while typing, and a selector match visits every element of a
  // long note, where the children are only its blocks.
  const headings: HTMLElement[] = []
  for (const child of surface.children) {
    if (child instanceof HTMLElement && HEADING_TAGS.has(child.tagName) && child !== title) {
      headings.push(child)
    }
  }
  return headings
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

/** The last heading that has reached the reading line, else the first. */
function currentIndexOf(headings: readonly HTMLElement[], view: HTMLElement): number {
  // Measured in the view, not the window: a split pane's top third is not
  // the window's.
  const bounds =
    view === document.body ? { top: 0, height: window.innerHeight } : view.getBoundingClientRect()
  const line = bounds.top + bounds.height * CURRENT_SECTION_LINE
  let current = 0
  for (const [index, heading] of headings.entries()) {
    if (heading.getBoundingClientRect().top > line) {
      break
    }
    current = index
  }
  return current
}

export interface DocumentOutline {
  entries: OutlineEntry[]
  /** The entry whose section is on screen now. */
  current: number
  /** Scroll the heading at `index` into view. */
  reveal: (index: number) => void
}

export interface DocumentOutlineOptions {
  /**
   * The element holding the note the outline describes — the view's own
   * root, so a second pane, a pushed iPhone screen, or a stacked screen
   * beneath it never mixes its headings in. Omitted, the whole document.
   */
  scope?: RefObject<HTMLElement | null>
  /**
   * Track {@link DocumentOutline.current} while the note scrolls. Off by
   * default: only a surface that draws the current section pays for it.
   */
  trackCurrent?: boolean
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
 * so keystrokes inside a paragraph don't re-render the panel. The current
 * section is re-read at most once a frame while scrolling, from rects of a
 * clean layout, and publishes only when it changes.
 */
export function useDocumentOutline({
  scope,
  trackCurrent = false,
}: DocumentOutlineOptions = {}): DocumentOutline {
  const [entries, setEntries] = useState<OutlineEntry[]>([])
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const root = scope?.current ?? document.body
    const sync = (): void => {
      const headings = readHeadings(root)
      const next = toEntries(headings)
      // Functional update + bail on an identical reference: typing inside a
      // paragraph re-runs the read but never re-renders the panel.
      setEntries((previous) => (sameEntries(previous, next) ? previous : next))
      if (trackCurrent) {
        setCurrent(currentIndexOf(headings, root))
      }
    }
    // Coalesce to one read per frame: the observer fires for every mutation
    // batch in the scope, and a keystroke burst would otherwise re-query the
    // DOM per batch.
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
    // scope and let the selector do the narrowing rather than waiting for
    // an element that may not exist yet.
    const observer = new MutationObserver(schedule)
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    // `scroll` doesn't bubble, but it does capture: one listener on the
    // scope hears whichever container inside it scrolls the note.
    const onScroll = (): void => schedule()
    if (trackCurrent) {
      root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    }
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', onScroll, { capture: true })
      if (pending !== 0) {
        cancelAnimationFrame(pending)
      }
    }
  }, [scope, trackCurrent])

  const reveal = (index: number): void => {
    // Re-read at click time: the outline can be a frame behind an edit, and
    // scrolling the wrong heading is worse than scrolling none. Where it
    // lands under floating chrome is the heading's `scroll-margin-top`.
    readHeadings(scope?.current ?? document.body)[index]?.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    })
  }

  return { entries, current, reveal }
}
