import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { splitFrontmatter, stripLeadingHeading, tagDefinitionPath } from '@reflect/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { readNoteSource } from '@/lib/note-frontmatter'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

interface TagPageDescriptionProps {
  /** The routed tag, or `null` on the unfiltered All Notes view (renders nothing). */
  tag: string | null
}

/** Query key for a tag's definition body — under the index scope, so a synced
 * edit of `tags/<key>.md` refreshes the preview for free. */
function tagDescriptionQueryKey(
  root: string | undefined,
  tag: string,
): readonly [string, string | undefined, string, string] {
  return [INDEX_QUERY_SCOPE, root, 'tag-description', tag]
}

async function loadTagDescriptionBody(tag: string): Promise<string> {
  const source = await readNoteSource(tagDefinitionPath(tag))
  const { body } = splitFrontmatter(source)
  return stripLeadingHeading(body).trim()
}

/**
 * The tag page's "About" block (Tana's supertag description): the
 * definition note's body, rendered quiet and truncated between the header
 * and the table. Nothing renders when `tags/<name>.md` doesn't exist or its
 * body is empty — no placeholder, no CTA (TDR 0005 Amendment A: the
 * definition note is born lazily, so most tags never have one).
 */
export function TagPageDescription({ tag }: TagPageDescriptionProps): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { navigate } = useRouter()
  const { data: body } = useQuery({
    queryKey: tagDescriptionQueryKey(graph?.root, tag ?? ''),
    queryFn: () => loadTagDescriptionBody(tag ?? ''),
    enabled: bridgeReady && graph !== null && tag !== null,
  })

  if (tag === null || body === undefined || body === '') {
    return null
  }

  return (
    <div className="flex flex-none items-start justify-between gap-3 pb-4 pl-12 pr-7">
      <div
        aria-label={`About #${tag}`}
        className="max-h-24 min-w-0 flex-1 overflow-hidden text-sm text-text-muted [mask-image:linear-gradient(to_bottom,black_80%,transparent)]"
      >
        <MarkdownPreview content={body} interactive={false} />
      </div>
      <button
        type="button"
        onClick={() => navigate({ kind: 'note', path: tagDefinitionPath(tag) })}
        className="flex-none text-sm font-medium text-text-muted transition-colors hover:text-text"
      >
        Edit
      </button>
    </div>
  )
}
