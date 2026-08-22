import { useState, type ReactElement } from 'react'
import type { UnlinkedMention } from '@reflect/core'
import { ChevronRight, Link as LinkIcon } from '@/components/icons'
import { useBacklinkNavigation } from '@/hooks/use-backlink-navigation'
import { useUnlinkedMentions } from '@/hooks/use-unlinked-mentions'

interface UnlinkedMentionsPanelProps {
  /** Graph-relative path of the note whose unlinked mentions to show. */
  path: string
}

/**
 * Unlinked mentions below the backlinks: notes whose prose names this note's
 * title without linking to it. Each row shows the source title and the
 * mention in one line of context, with a hover-revealed "Link" action that
 * converts the mention into a real `[[wiki link]]` — the index write-echo
 * then moves the row up into Incoming backlinks. Renders nothing when there
 * are no mentions; collapsed rows still count in the header. Private notes
 * never appear here (the query excludes them at the source).
 */
export function UnlinkedMentionsPanel({ path }: UnlinkedMentionsPanelProps): ReactElement | null {
  const { mentions, isLoading, link, linking, linkFailed } = useUnlinkedMentions(path)
  const [expanded, setExpanded] = useState(true)
  const { openSource } = useBacklinkNavigation()

  if (isLoading || mentions.length === 0) {
    return null
  }

  return (
    <section aria-label="Unlinked mentions" className="mt-8">
      <h3 className="text-xs font-medium text-text-muted">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded)
          }}
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={`size-3 shrink-0 text-text-muted transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span>
            Unlinked mention{mentions.length === 1 ? '' : 's'} ({mentions.length})
          </span>
        </button>
      </h3>

      {expanded ? (
        <ul className="mt-4 flex flex-col gap-1 pl-5">
          {mentions.map((mention) => (
            <li
              key={`${path}:${mention.sourcePath}`}
              className="group -ml-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    openSource(mention.sourcePath, event)
                  }}
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium text-text hover:text-accent"
                >
                  {mention.sourceTitle}
                </button>
                <button
                  type="button"
                  disabled={linking.has(mention.sourcePath)}
                  onClick={() => {
                    void link(mention)
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent-soft hover:text-accent-soft-text focus-visible:opacity-100 disabled:opacity-50"
                >
                  <LinkIcon aria-hidden className="size-3" />
                  {linking.has(mention.sourcePath) ? 'Linking…' : 'Link'}
                </button>
              </div>
              <p className="mt-0.5 truncate text-xs text-text-secondary">
                <MentionSnippet mention={mention} />
              </p>
              {linkFailed.has(mention.sourcePath) ? (
                <p role="alert" className="mt-0.5 text-2xs text-red-600 dark:text-red-400">
                  Couldn’t link this mention — try again.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** The context line with the mention itself emphasized. */
function MentionSnippet({ mention }: { mention: UnlinkedMention }): ReactElement {
  const { snippet, matchStart, matchEnd } = mention
  if (matchStart < 0 || matchEnd > snippet.length || matchStart >= matchEnd) {
    return <>{snippet}</>
  }
  return (
    <>
      {snippet.slice(0, matchStart)}
      <mark className="rounded-sm bg-accent-soft px-0.5 text-accent-soft-text">
        {snippet.slice(matchStart, matchEnd)}
      </mark>
      {snippet.slice(matchEnd)}
    </>
  )
}
