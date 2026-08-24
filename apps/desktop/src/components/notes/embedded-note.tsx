import { useQuery } from '@tanstack/react-query'
import { useCallback, type ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import {
  parseNote,
  resolveExistingWikiTarget,
  transclusionMarkdown,
  type NoteTransclusion,
} from '@reflect/core'
import { ExternalLink } from '@/components/icons'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useWikiLinkNavigation } from '@/editor/use-wiki-link-navigation'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'

interface EmbeddedNoteProps {
  embed: NoteTransclusion
  /** The note that contains this embed — used to refuse a self-transclusion. */
  sourcePath: string
  resolveImageUrl: (src: string) => string | null
}

interface TransclusionPayload {
  readonly path: string
  readonly title: string
  readonly markdown: string | null
  readonly missingHeading: boolean
}

async function loadTransclusion(
  embed: NoteTransclusion,
  generation: number,
): Promise<TransclusionPayload | { kind: 'missing' } | { kind: 'ambiguous' }> {
  const resolution = await resolveExistingWikiTarget(embed.target, generation)
  if (resolution.kind === 'missing' || resolution.kind === 'unavailable') {
    return { kind: 'missing' }
  }
  if (resolution.kind === 'ambiguous') {
    return { kind: 'ambiguous' }
  }
  const source = await readExistingNoteSource(resolution.path, generation)
  const parsed = parseNote({ path: resolution.path, source })
  const markdown = transclusionMarkdown(source, embed.heading)
  return {
    path: resolution.path,
    title: parsed.title,
    markdown: markdown ?? '',
    missingHeading: embed.heading !== null && markdown === null,
  }
}

/**
 * Live body of one `![[Note]]` / `![[Note#Heading]]` embed. The markdown
 * stays the portable source of truth; this widget renders underneath the
 * editor the way collection fences do. Attachment embeds are not handled
 * here — meowdown renders those in-editor.
 */
export function EmbeddedNote({
  embed,
  sourcePath,
  resolveImageUrl,
}: EmbeddedNoteProps): ReactElement {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const generation = graph?.generation ?? null
  const navigateNoteLink = useNoteLinkNavigation()
  const onWikiLinkClick = useWikiLinkNavigation(generation)

  const { data, isPending } = useQuery({
    queryKey: [
      INDEX_QUERY_SCOPE,
      graph?.root,
      'note-transclusion',
      embed.target,
      embed.heading,
      generation,
    ],
    queryFn: () => loadTransclusion(embed, generation!),
    enabled: bridgeReady && generation !== null,
  })

  const openNote = useCallback(
    (path: string, openInNewWindow: boolean) => {
      navigateNoteLink({ target: routeForPath(path), openInNewWindow })
    },
    [navigateNoteLink],
  )

  const label = embed.heading === null ? embed.target : `${embed.target} #${embed.heading}`

  let body: ReactElement
  if (data === undefined || isPending) {
    body = <p className="px-3 py-6 text-sm text-text-muted">Loading note…</p>
  } else if ('kind' in data && data.kind === 'missing') {
    body = (
      <p className="px-3 py-6 text-sm text-text-muted">
        [[{embed.target}]] doesn’t match a note in this graph.
      </p>
    )
  } else if ('kind' in data && data.kind === 'ambiguous') {
    body = (
      <p className="px-3 py-6 text-sm text-text-muted">
        [[{embed.target}]] matches more than one note.
      </p>
    )
  } else if (data.path === sourcePath) {
    body = <p className="px-3 py-6 text-sm text-text-muted">This note can’t embed itself.</p>
  } else if (data.missingHeading) {
    body = (
      <p className="px-3 py-6 text-sm text-text-muted">
        No heading “{embed.heading}” in {data.title}.
      </p>
    )
  } else {
    body = (
      <div className="max-h-[min(28rem,70vh)] overflow-auto px-3 py-3">
        <MarkdownPreview
          content={data.markdown ?? ''}
          resolveImageUrl={resolveImageUrl}
          onWikiLinkClick={({ target, openInNewWindow }) => {
            onWikiLinkClick({ target, openInNewWindow })
          }}
        />
      </div>
    )
  }

  const resolvedPath = data !== undefined && !('kind' in data) ? data.path : null

  return (
    <section
      aria-label={`Embed ${label}`}
      data-testid="note-embed"
      data-embed-target={embed.target}
      data-embed-heading={embed.heading ?? ''}
      className="mt-6 overflow-hidden rounded-lg border border-border"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium text-text">
          {data !== undefined && !('kind' in data) ? data.title : label}
        </p>
        {resolvedPath !== null ? (
          <button
            type="button"
            aria-label={`Open ${label}`}
            className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
            onClick={(event) => {
              openNote(resolvedPath, isModEvent(event))
            }}
          >
            <ExternalLink aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className={cn('min-h-24')}>{body}</div>
    </section>
  )
}
