import { useMemo, useRef, type ReactElement } from 'react'
import { NO_POST_EMBEDS } from '@/editor/use-post-embed-resolvers'
import { MarkdownView } from '@meowdown/react'
import type { WikilinkClickHandler } from '@meowdown/core'
import {
  requoteCalloutBlock,
  separateCalloutTitles,
  withoutBlockIds,
  type SnippetTask,
} from '@kore/core'
import { useOpenExternalLink } from '@/editor/open-external-link'
import { resolveWikilink } from '@/editor/resolve-wikilink'
import { useCalloutDom } from '@/editor/use-callout-dom'
import { useSnippetTaskToggle } from '@/hooks/use-snippet-task-toggle'

interface BacklinkSnippetProps {
  /** The referencing block context's Markdown source (may span several lines). */
  text: string
  /** Graph-relative path of the source note the snippet was read from. */
  notePath: string
  /** The snippet's checkbox tasks anchored to the source note (query-provided). */
  tasks: SnippetTask[]
  /** Navigate a clicked `[[wiki link]]` to its target. Pass a stable function. */
  onWikilinkClick: WikilinkClickHandler
  /** Resolve `![…](…)` sources to displayable URLs. Pass a stable function. */
  resolveImageUrl: (src: string) => string | undefined
}

/**
 * One reference in the incoming-backlinks panel, rendered as rich text through
 * meowdown's editor-free `MarkdownView`: wiki links become the editor's
 * clickable chips and inline marks render instead of raw `[[…]]` / `**…**`
 * source. The context is a whole block (old Reflect's rules — a paragraph, the
 * containing list item with its children, or a heading's section), so it
 * renders unclamped: truncating would cut the nested structure the context
 * exists to show. The source's fold state must not hide it either:
 * `expandCollapsed` renders `+` collapsed items expanded at every depth.
 * Round `+ [ ]` task checkboxes are live — a click writes the
 * toggle through to the source note ({@link useSnippetTaskToggle}), old
 * Kore's backlink-context behavior — while square GFM boxes stay read-only
 * (the `reflect-backlink-snippet` CSS keeps them inert-looking). The
 * `reflect-editor` class shares the editor's chip styling; the
 * `reflect-backlink-snippet` wrapper keeps it in the panel's compact line box.
 * A context lifted out of a callout arrives dedented, so it is quoted again
 * (`requoteCalloutBlock`) and drawn like any preview's callout, always open
 * for the same reason collapsed bullets are.
 */
export function BacklinkSnippet({
  text,
  notePath,
  tasks,
  onWikilinkClick,
  resolveImageUrl,
}: BacklinkSnippetProps): ReactElement {
  const onTaskClick = useSnippetTaskToggle(notePath, tasks)
  const openExternalLink = useOpenExternalLink()
  // `^id` markers are Obsidian anchors, never text a reader sees (Plan 33 C3).
  const markdown = useMemo(
    () => separateCalloutTitles(requoteCalloutBlock(withoutBlockIds(text))),
    [text],
  )
  const hostRef = useRef<HTMLDivElement>(null)
  useCalloutDom(hostRef, false)
  return (
    <div ref={hostRef} className="reflect-backlink-snippet select-text text-xs text-text">
      <MarkdownView
        className="reflect-editor"
        markdown={markdown}
        expandCollapsed
        onWikilinkClick={onWikilinkClick}
        resolveWikilink={resolveWikilink}
        onLinkClick={openExternalLink}
        {...(onTaskClick ? { onTaskClick } : {})}
        resolveImageUrl={resolveImageUrl}
        // Read-only views never fetch embed data: they can show private notes.
        resolveXPost={NO_POST_EMBEDS.resolveXPost}
        resolveYouTubeVideo={NO_POST_EMBEDS.resolveYouTubeVideo}
      />
    </div>
  )
}
