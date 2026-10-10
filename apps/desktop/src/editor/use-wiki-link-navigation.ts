import { useCallback } from 'react'
import {
  errorMessage,
  noteLinkHeading,
  normalizeWikiTarget,
  resolveExistingWikiTarget,
  resolveOrCreateNoteWithTitle,
  resolveWikiTarget,
  wikiNoteReference,
} from '@reflect/core'
import { reportAmbiguousNoteTitle } from '@/editor/ambiguous-note-feedback'
import { revealNoteHeading } from '@/editor/editor-handle-registry'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { startOperation } from '@/lib/operations'
import { useLinkIntentGuard } from '@/lib/windows/use-link-intent-guard'
import { routeForPath, type NoteRoute } from '@/routing/route'

function reportUnavailableNoteTitle(title: string): void {
  startOperation('Opening link').fail(
    `Couldn’t open “${title}” because a matching note is currently unavailable. Try again when it is available on this device.`,
  )
}

/**
 * Navigation for a clicked `[[wiki link]]`. Calendar-valid ISO dates preserve
 * ordinary resolution precedence, then open their lazy daily route on a miss.
 * Every other writable title goes through the ambiguity-preserving index +
 * disk resolver before it opens or creates, so an indexed duplicate cannot
 * bypass the same guard used for an index miss. With no graph generation
 * available, existing titles still use the read-only index resolver and
 * unresolved titles are a no-op.
 *
 * An `openInSplit` request (a ⌘-click or a spare-`mod` keyboard follow,
 * decided at the editor boundary from meowdown's `mod` flag) opens the
 * resolved target in the pane beside this one instead, falling back to
 * in-place navigation on surfaces without panes, so the request never makes
 * a link do nothing.
 *
 * A `#Heading` fragment (`[[Plan#Next steps]]`) scrolls the opened note to
 * that heading once its editor is on screen. A bare `[[#Next steps]]` never
 * leaves `sourcePath`: it scrolls the note it is written in, and is a no-op on
 * surfaces that pass no source note.
 *
 * Resolution is async, and the host pane can unmount or the user can act
 * again while it's in flight — a late navigate would yank the user somewhere
 * they've already left, so every navigation is gated on the shared link
 * intent ({@link useLinkIntentGuard}).
 *
 * @param generation the open graph's write generation (`GraphInfo.generation`),
 *   or `null` when no graph is writable.
 * @param sourcePath the note the links are written in, when the surface is
 *   that note's own editor.
 * @returns a stable-per-`generation` click handler for the editor's wiki-link
 *   extension.
 */
export function useWikiLinkNavigation(
  generation: number | null,
  sourcePath?: string,
): (options: { target: string; openInSplit: boolean }) => void {
  const navigateNoteLink = useNoteLinkNavigation()
  const beginLinkIntent = useLinkIntentGuard()

  return useCallback(
    ({ target, openInSplit }: { target: string; openInSplit: boolean }) => {
      const heading = noteLinkHeading(target)
      if (wikiNoteReference(target)?.kind === 'self') {
        if (heading !== null && sourcePath !== undefined) {
          revealNoteHeading(sourcePath, heading)
        }
        return
      }
      const isStale = beginLinkIntent()
      const open = (route: NoteRoute, path?: string): void => {
        navigateNoteLink({ target: route, openInSplit })
        if (heading !== null && path !== undefined) {
          revealNoteHeading(path, heading)
        }
      }
      void (async () => {
        try {
          const normalized = normalizeWikiTarget(target)
          if (normalized.raw === '') {
            return
          }
          if (normalized.date !== undefined) {
            if (generation === null) {
              const resolution = await resolveWikiTarget(normalized.raw)
              if (isStale()) {
                return
              }
              if (resolution.kind === 'resolved') {
                open(routeForPath(resolution.ref), resolution.ref)
              } else {
                open({ kind: 'daily', date: normalized.date })
              }
              return
            }

            const resolution = await resolveExistingWikiTarget(normalized.raw, generation)
            if (isStale()) {
              return
            }
            if (resolution.kind === 'resolved') {
              open(routeForPath(resolution.path), resolution.path)
            } else if (resolution.kind === 'missing') {
              open({ kind: 'daily', date: normalized.date })
            } else if (resolution.kind === 'ambiguous') {
              reportAmbiguousNoteTitle('Opening link', normalized.raw)
            } else {
              reportUnavailableNoteTitle(normalized.raw)
            }
            return
          }
          if (generation !== null) {
            const outcome = await resolveOrCreateNoteWithTitle(normalized.raw, generation)
            if (isStale()) {
              return
            }
            if (outcome.kind === 'ambiguous') {
              reportAmbiguousNoteTitle('Opening link', normalized.raw)
            } else if (outcome.kind === 'unavailable') {
              reportUnavailableNoteTitle(normalized.raw)
            } else {
              open(routeForPath(outcome.path), outcome.path)
            }
            return
          }

          const resolution = await resolveWikiTarget(normalized.raw)
          if (isStale()) {
            return
          }
          if (resolution.kind === 'resolved') {
            // Deliberately no focus request: on mobile, focusing mid-arrival
            // raises the keyboard through the stack animation. Desktop
            // autofocuses note arrivals on its own.
            open(routeForPath(resolution.ref), resolution.ref)
          }
        } catch (err) {
          console.error('wiki-link resolution failed:', err)
          startOperation('Opening link').fail(errorMessage(err))
        }
      })()
    },
    [beginLinkIntent, generation, navigateNoteLink, sourcePath],
  )
}
