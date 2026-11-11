import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { isAppError, loadLinkPreview, readNote } from '@kore/core'
import { BacklinksPanel } from '@/components/backlinks-panel'
import { NoteChildrenPanel } from '@/components/note-children-panel'
import { NotePane, type NotePaneProps } from '@/components/note-pane'
import { UnlinkedMentionsPanel } from '@/components/unlinked-mentions-panel'
import { editorBodyWithDefaultBullet } from '@/editor/default-bullet'
import { linkCardElement } from '@/editor/link-card-dom'
import { MarkdownPreview } from '@/editor/markdown-preview'
import type { NoteEditorHandle } from '@/editor/note-editor'
import { cacheNoteContent, getCachedNoteContent } from '@/editor/note-content-cache'
import { staticDayBody } from '@/editor/static-day'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useNoteRow } from '@/hooks/use-note-row'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

interface DailyDayProps extends NotePaneProps {
  /** Whether this day runs its editor now. */
  live: boolean
  /** A press on the static drawing: the day wants its editor, caret there. */
  onActivate: (date: string, point: { x: number; y: number }) => void
}

/** `null` is a day with no file yet: it draws as an empty note. */
async function readDay(path: string): Promise<string | null> {
  try {
    const content = await readNote(path)
    cacheNoteContent(path, content)
    return content
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') {
      return null
    }
    throw cause
  }
}

/** How long a day's editor may take to match the static drawing under it. */
const HANDOVER_LIMIT_MS = 400

/**
 * One day of the daily stream. A whole editor per day is what a scroll pays
 * for: every day that enters the viewport mounted one, in the middle of the
 * gesture. So a day that is not `live` draws its markdown as static text in
 * the editor's own classes, and the stream turns the days on screen live once
 * the scroll rests (or at once on a press).
 *
 * Only days the static view draws exactly like the editor take this path
 * ({@link staticDayBody}); the rest mount their editor as before.
 *
 * Going live is a handover, not a swap: the editor mounts unseen over the
 * static drawing, which stays up until the editor is as tall as it is (its
 * note read, its link cards in). A swap would show the editor's loading and
 * card-less frames, and their shorter rows would move every day below.
 */
export const DailyDay = memo(function DailyDay({
  live,
  onActivate,
  registerHandle,
  ...pane
}: DailyDayProps): ReactElement {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { path, dailyDate } = pane
  // With markdown syntax always shown the editor prints the marks the static
  // view hides, so those users keep the editor on every day.
  const staticAllowed = settings.editorMarkdownSyntax !== 'show'
  // `settled` is the editor having taken over from the static drawing. A day
  // that leaves `live` starts over as static.
  const [settled, setSettled] = useState(false)
  if (!live && settled) {
    setSettled(false)
  }
  const wantsStatic = staticAllowed && !(live && settled)
  // The session's own cache first: it holds what an editor on this day last
  // read or wrote, so a day leaving its editor redraws its latest text.
  const cached = wantsStatic ? getCachedNoteContent(path) : undefined
  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'daily-static', path],
    queryFn: () => readDay(path),
    enabled: wantsStatic && !live && graph !== null,
    ...(cached !== undefined ? { initialData: cached } : {}),
    // Nothing outlives the row: the next mount asks the content cache again.
    gcTime: 0,
  })
  const loading = wantsStatic && !isError && data === undefined
  // Deciding parses the note, so once per content, not once per render.
  const drawable = useMemo(() => (data === undefined ? null : staticDayBody(data ?? '')), [data])
  const body = wantsStatic && !isError ? drawable : null
  // A day asked to go live before its static text arrived has nothing to
  // hand over from: it mounts its editor in the open, as it always did.
  const showStatic = body !== null || (loading && !live)
  const showPane = live || (!loading && body === null)
  const handover = showStatic && showPane
  if (live && !settled && !showStatic) {
    // Nothing to hand over from: the editor is the day from here on.
    setSettled(true)
  }

  const staticRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  // The stream focuses a day through its handle. During a handover the
  // editor is not laid out where the user sees it yet, so the stream learns
  // of the handle only once the editor has taken over.
  const heldHandle = useRef<NoteEditorHandle | null>(null)
  const handoverRef = useRef(handover)
  useLayoutEffect(() => {
    handoverRef.current = handover
    const held = heldHandle.current
    if (!handover && held !== null && dailyDate !== undefined) {
      heldHandle.current = null
      registerHandle?.(dailyDate, held)
    }
  }, [handover, dailyDate, registerHandle])
  const [editorBound, setEditorBound] = useState(false)
  if (!handover && editorBound) {
    setEditorBound(false)
  }
  const registerDayHandle = useCallback(
    (date: string, handle: NoteEditorHandle | null) => {
      if (handle !== null && handoverRef.current) {
        heldHandle.current = handle
        setEditorBound(true)
        return
      }
      heldHandle.current = null
      registerHandle?.(date, handle)
    },
    [registerHandle],
  )
  useEffect(() => {
    if (!handover) {
      return
    }
    if (!editorBound) {
      // No editor yet. A pane that never binds one (a read error) still
      // takes over at the limit.
      const limit = setTimeout(() => setSettled(true), HANDOVER_LIMIT_MS * 5)
      return () => clearTimeout(limit)
    }
    let frame = 0
    const deadline = performance.now() + HANDOVER_LIMIT_MS
    const check = (): void => {
      const drawn = staticRef.current?.offsetHeight
      const mounted = paneRef.current?.offsetHeight
      if (drawn === mounted || performance.now() > deadline) {
        setSettled(true)
        return
      }
      frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(check)
    return () => cancelAnimationFrame(frame)
  }, [handover, editorBound])

  return (
    <div className="relative">
      {showStatic ? (
        <div
          ref={staticRef}
          onPointerDown={(event) => {
            if (event.button === 0 && dailyDate !== undefined) {
              onActivate(dailyDate, { x: event.clientX, y: event.clientY })
            }
          }}
        >
          {body === null ? (
            <div
              data-static-day="loading"
              className={cn(
                'reflect-editor reflect-note-surface',
                pane.gutterClassName,
                pane.editorClassName,
              )}
            />
          ) : (
            <StaticDay
              path={path}
              body={editorBodyWithDefaultBullet(body, settings.editorDefaultBullet)}
              gutterClassName={pane.gutterClassName}
              editorClassName={pane.editorClassName}
            />
          )}
        </div>
      ) : null}
      {showPane ? (
        <div
          ref={paneRef}
          // Unseen and out of the flow while the static drawing is still up.
          {...(handover
            ? { className: 'pointer-events-none absolute inset-x-0 top-0 opacity-0' }
            : {})}
        >
          <NotePane {...pane} registerHandle={registerDayHandle} />
        </div>
      ) : null}
    </div>
  )
})

interface StaticDayProps {
  path: string
  body: string
  gutterClassName: string | undefined
  editorClassName: string | undefined
}

const BARE_URL = /^https?:\/\/\S+$/i

function StaticDay({ path, body, gutterClassName, editorClassName }: StaticDayProps): ReactElement {
  const { graph } = useGraph()
  const { resolveImageUrl } = useAssetPersistence(graph?.generation ?? null, path)
  const hostRef = useRef<HTMLDivElement>(null)
  // The editor draws a line holding only a URL as a preview card
  // (link-card-plugin). Same rule here, from the same session cache, and only
  // for a note known to be public: a preview reaches the linked host.
  const cardsAllowed = useNoteRow(path)?.isPrivate === false
  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null || !cardsAllowed) {
      return
    }
    let current = true
    for (const paragraph of host.querySelectorAll<HTMLElement>('.reflect-editor > p')) {
      const url = (paragraph.textContent ?? '').trim()
      if (!BARE_URL.test(url) || paragraph.classList.contains('kore-link-card-source')) {
        continue
      }
      void loadLinkPreview(url).then((preview) => {
        if (!current || preview === null || !paragraph.isConnected) {
          return
        }
        paragraph.before(linkCardElement(preview))
        paragraph.classList.add('kore-link-card-source')
      })
    }
    return () => {
      current = false
    }
  }, [cardsAllowed, body])
  return (
    <div ref={hostRef} data-static-day="ready" className="relative">
      <MarkdownPreview
        content={body}
        resolveImageUrl={resolveImageUrl}
        interactive={false}
        className={cn('reflect-note-surface', gutterClassName, editorClassName)}
      />
      <div className={gutterClassName}>
        <NoteChildrenPanel key={path} path={path} />
        <BacklinksPanel path={path} />
        <UnlinkedMentionsPanel path={path} />
      </div>
    </div>
  )
}
