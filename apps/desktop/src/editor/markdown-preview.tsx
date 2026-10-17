import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react'
import { MarkdownView } from '@meowdown/react'
import { separateCalloutTitles } from '@reflect/core'
import { PaneErrorBoundary } from '@/components/pane-error-boundary'
import { toggleCalloutFromClick } from '@/editor/callout-dom'
import { useCalloutDom } from '@/editor/use-callout-dom'
import { useOpenExternalLink } from '@/editor/open-external-link'
import { cn } from '@/lib/utils'
import { resolveWikiEmbed } from '@/editor/resolve-wiki-embed'

/**
 * A read-only rendering of note markdown via @meowdown/react's `<MarkdownView>`
 * in `hide` mark mode, so previews look exactly like the note would in the
 * editor (wiki-link chips, images, and headings included) but without mounting a
 * ProseMirror editor. The view is never editable, so this can render any note
 * (protected ones included) without ever writing.
 *
 * `content` is live: changing it re-renders the preview, so one mounted preview
 * can follow a moving selection (the palette's preview pane).
 *
 * Obsidian callouts get their title, icon and color here too
 * (`callout-dom.ts`); an interactive preview folds `[!x]-`/`[!x]+` callouts
 * on a title click, in the view only, and a passive one shows them open.
 */

interface MarkdownPreviewProps {
  /** The markdown body to render (callers strip frontmatter first). */
  content: string
  /** Resolve `![…](…)` sources to displayable URLs; unresolved images are skipped. */
  resolveImageUrl?: (src: string) => string | null
  /**
   * Navigate a clicked `[[wiki link]]` target. Omitted, links render as
   * inert chips (the palette preview's behavior). `openInSplit` carries the
   * ⌘/Ctrl the click held, so the host can open the target in the pane
   * beside this one.
   */
  onWikiLinkClick?: (options: { target: string; openInSplit: boolean }) => void
  /**
   * Whether rendered links, images, and task checkboxes can be activated
   * (default true). A passive preview renders no anchors, focusable controls,
   * or remote embeds.
   */
  interactive?: boolean
  /** Extra classes for the rendered root. */
  className?: string
}

export function MarkdownPreview({
  content,
  resolveImageUrl,
  onWikiLinkClick,
  interactive = true,
  className,
}: MarkdownPreviewProps): ReactElement {
  const openExternalLink = useOpenExternalLink()
  // The resolver and click handler are read through refs so a changing prop
  // never gives MarkdownView a new callback identity (which would re-render its
  // whole tree).
  const resolveRef = useRef(resolveImageUrl)
  const navigateRef = useRef(onWikiLinkClick)
  useEffect(() => {
    resolveRef.current = resolveImageUrl
    navigateRef.current = onWikiLinkClick
  })

  // Hosts either always pass the handler (chat) or never do (palette
  // preview), and a passive preview forces links inert either way. An inert
  // preview omits the handler so a chip click is a no-op rather than a dead
  // navigation.
  const navigates = interactive && onWikiLinkClick != null

  const resolveImageUrlStable = useCallback(
    (src: string) => resolveRef.current?.(src) ?? undefined,
    [],
  )
  const onWikilinkClickStable = useCallback(
    (payload: { target: string; event: MouseEvent | KeyboardEvent; mod: boolean }) =>
      navigateRef.current?.({
        target: payload.target,
        openInSplit: payload.mod,
      }),
    [],
  )

  const markdown = useMemo(() => separateCalloutTitles(content), [content])
  const hostRef = useRef<HTMLDivElement>(null)
  // A passive preview can't be clicked open, so it shows folded callouts open.
  useCalloutDom(hostRef, interactive)

  // Previews float outside the panes (palette, hover cards, chat), so a note
  // that cannot render gets its own boundary here rather than blanking the app.
  return (
    <PaneErrorBoundary
      resetKey={content}
      surface="preview"
      path={null}
      fallback={<p className="text-xs text-text-muted">This preview couldn’t be shown.</p>}
    >
      <div
        ref={hostRef}
        className="contents"
        {...(interactive
          ? {
              onClick: (event) => {
                if (toggleCalloutFromClick(event.target)) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              },
            }
          : {})}
      >
        <MarkdownView
          markdown={markdown}
          markMode="hide"
          interactive={interactive}
          resolveImageUrl={resolveImageUrlStable}
          resolveWikiEmbed={resolveWikiEmbed}
          {...(interactive ? { onLinkClick: openExternalLink } : {})}
          {...(navigates ? { onWikilinkClick: onWikilinkClickStable } : {})}
          className={cn('reflect-editor', className)}
        />
      </div>
    </PaneErrorBoundary>
  )
}
