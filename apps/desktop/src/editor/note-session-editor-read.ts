/**
 * How long after the last editor change the session reads the document out
 * of the editor, and the longest a change stays unread while typing goes on.
 * Serializing a long note takes milliseconds, which on every keystroke was a
 * visible part of typing lag.
 */
const SETTLE_MS = 150
const SETTLE_MAX_MS = 1000

/** Serializes the editor's document, or `null` once that editor is gone. */
export type EditorRead = () => string | null

/**
 * The editor change a note session has been told about but not read yet.
 * `onRead` receives the markdown when it is read, on the settle timer or when
 * a caller needs the buffer to be current and calls {@link settle}.
 */
export interface PendingEditorRead {
  /** Remember `read` as the latest change and (re)arm the settle timer. */
  note: (read: EditorRead) => void
  /** Read the remembered change now, if any. */
  settle: () => void
  /** Forget the remembered change without reading it. */
  drop: () => void
}

export function createPendingEditorRead(onRead: (markdown: string) => void): PendingEditorRead {
  let pending: EditorRead | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** When the oldest unread change arrived, for the ceiling. */
  let since = 0

  function drop(): void {
    pending = null
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function settle(): void {
    const read = pending
    drop()
    const markdown = read?.() ?? null
    if (markdown !== null) {
      onRead(markdown)
    }
  }

  function note(read: EditorRead): void {
    const now = Date.now()
    if (pending === null) {
      since = now
    }
    pending = read
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(settle, Math.max(0, Math.min(SETTLE_MS, since + SETTLE_MAX_MS - now)))
  }

  return { note, settle, drop }
}
