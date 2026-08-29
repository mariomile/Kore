import { useCallback, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { listPrivateNotePaths, searchNotes, type SearchHit } from '@reflect/core'

/**
 * The composer's @-mention autocomplete: typing `@query` after a word
 * boundary searches note titles and bodies, and picking a hit inserts
 * `[[Title]]` in its place — the send then resolves the mention to the
 * note's current content (see `resolveNoteMentions`). Private notes never
 * appear in the suggestions: mentioning one by hand is possible, but the
 * resolution refuses it, so the popup doesn't tempt what the send denies.
 *
 * The popup only shows while the query has hits, so an `@` used in prose
 * ("meet @ 9") stops suggesting as soon as nothing matches.
 */

export interface NoteMentionSuggestion {
  path: string
  title: string
}

export interface NoteMentionAutocomplete {
  /** Whether the suggestion popup is showing. */
  open: boolean
  suggestions: NoteMentionSuggestion[]
  activeIndex: number
  /**
   * Give the popup first claim on a keydown (arrows, Enter/Tab, Escape).
   * Returns true when consumed — the composer must then not handle it.
   */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Re-scan the query around the caret. Call after the draft or caret moved. */
  refresh: () => void
  /** Insert `[[Title]]` for one suggestion, replacing the `@query`. */
  pick: (suggestion: NoteMentionSuggestion) => void
  close: () => void
}

/** `@query` looking back from the caret: at start or after whitespace. */
const ACTIVE_MENTION = /(^|\s)@([^\n@]{0,60})$/

export function useNoteMentionAutocomplete(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setDraft: (text: string) => void,
): NoteMentionAutocomplete {
  const [suggestions, setSuggestions] = useState<NoteMentionSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  // Index of the active mention's `@` in the draft; null = no active mention.
  const [anchor, setAnchor] = useState<number | null>(null)
  // Private notes are excluded from suggestions; the list loads once per
  // session of the popup and is cheap enough to refresh on each activation.
  const privatePathsRef = useRef<Set<string> | null>(null)
  const searchSeq = useRef(0)

  const close = useCallback(() => {
    searchSeq.current += 1
    setAnchor(null)
    setSuggestions([])
    setActiveIndex(0)
  }, [])

  const refresh = useCallback(() => {
    const element = textareaRef.current
    if (element === null) {
      close()
      return
    }
    const caret = element.selectionStart ?? element.value.length
    const match = ACTIVE_MENTION.exec(element.value.slice(0, caret))
    const query = match?.[2]?.trim() ?? ''
    if (match === null || query === '') {
      close()
      return
    }
    setAnchor(caret - match[2]!.length - 1)
    const seq = ++searchSeq.current
    void (async () => {
      try {
        if (privatePathsRef.current === null) {
          // Leave the ref null when the index cannot answer, so the next
          // keystroke asks again instead of caching an empty set for the
          // rest of the session. Suggestions stay unfiltered meanwhile:
          // this list is a convenience, and the hard block is downstream
          // in `resolveNoteMentions`, which refuses a private note's
          // content at send time however it was mentioned.
          const paths = await listPrivateNotePaths().catch(() => null)
          if (paths !== null) {
            privatePathsRef.current = new Set(paths)
          }
        }
        const hits: SearchHit[] = await searchNotes(query, 12)
        if (seq !== searchSeq.current) {
          return
        }
        setSuggestions(
          hits.filter((hit) => !(privatePathsRef.current?.has(hit.path) ?? false)).slice(0, 6),
        )
        setActiveIndex(0)
      } catch {
        if (seq === searchSeq.current) {
          setSuggestions([])
        }
      }
    })()
  }, [close, textareaRef])

  const pick = useCallback(
    (suggestion: NoteMentionSuggestion) => {
      const element = textareaRef.current
      if (element === null || anchor === null) {
        return
      }
      const caret = element.selectionStart ?? element.value.length
      const inserted = `[[${suggestion.title}]] `
      setDraft(`${element.value.slice(0, anchor)}${inserted}${element.value.slice(caret)}`)
      const position = anchor + inserted.length
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(position, position)
      })
      close()
    },
    [anchor, close, setDraft, textareaRef],
  )

  const open = anchor !== null && suggestions.length > 0

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) {
        return false
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((index) => (index + step + suggestions.length) % suggestions.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const active = suggestions[activeIndex]
        if (active !== undefined) {
          pick(active)
        }
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return true
      }
      return false
    },
    [open, suggestions, activeIndex, pick, close],
  )

  return { open, suggestions, activeIndex, onKeyDown, refresh, pick, close }
}
