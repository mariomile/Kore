import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  displayNoteTitle,
  getNote,
  noteFileStem,
  splitFrontmatter,
  stripLeadingHeading,
} from '@reflect/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { passivePreviewImageResolver } from '@/editor/preview-image-url'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useWikiLinkNavigation } from '@/editor/use-wiki-link-navigation'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { routeForPath } from '@/routing/route'
import { NotePropertiesSection } from './note-properties-section'

interface NotePeekProps {
  /** Graph-relative path of the row a list is pointing at. */
  path: string
}

/**
 * The side peek: a selected row read in the context rail without leaving
 * the table — title, its typed fields (editable, the same section the open
 * note gets), and the body rendered read-only. "Open" is the full page.
 */
export function NotePeek({ path }: NotePeekProps): ReactElement {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const { navigate } = useRouter()
  const onWikiLinkClick = useWikiLinkNavigation(generation)
  const { resolveImageUrl, resolveAssetOpenPath } = useAssetPersistence(generation)
  const previewImageUrl = useMemo(
    () => passivePreviewImageResolver({ resolveImageUrl, resolveAssetOpenPath }),
    [resolveAssetOpenPath, resolveImageUrl],
  )

  const { data: row } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note', path],
    queryFn: async () => (await getNote(path)) ?? null,
    enabled: graph !== null,
  })
  const { data: body } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-peek', path, row?.mtime ?? 0],
    queryFn: async () => {
      if (generation === null) {
        return null
      }
      const source = await readExistingNoteSource(path, generation)
      return stripLeadingHeading(splitFrontmatter(source).body)
    },
    enabled: generation !== null,
    retry: false,
  })
  const title = displayNoteTitle(row?.title ?? noteFileStem(path))

  return (
    <div aria-label={`Peek: ${title}`} className="flex flex-col gap-4 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-base font-semibold text-text">{title}</h2>
        <button
          type="button"
          onClick={() => navigate(routeForPath(path))}
          className="shrink-0 rounded-full bg-surface-hover px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text"
        >
          Open
        </button>
      </div>
      <NotePropertiesSection path={path} />
      {body === undefined || body === null ? null : body.trim() === '' ? (
        <p className="text-xs text-text-muted">Nothing written yet.</p>
      ) : (
        <MarkdownPreview
          content={body}
          resolveImageUrl={previewImageUrl}
          onWikiLinkClick={onWikiLinkClick}
          className="text-sm leading-relaxed text-text-secondary"
        />
      )}
    </div>
  )
}
