import { memo, type CSSProperties, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isModEvent } from '@meowdown/core'
import {
  canvasDisplayName,
  isBasePath,
  isCanvasPath,
  parseNote,
  stripLeadingHeading,
  transclusionMarkdown,
  wikiEmbedKind,
  type CanvasNode,
} from '@kore/core'
import { ExternalLink, Link, Paperclip } from '@/components/icons'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useOpenExternalLink } from '@/editor/open-external-link'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { canvasColor } from './canvas-colors'

/** What a card can do outside the board: all navigation, no writes. */
export interface CanvasCardActions {
  openNote: (path: string, openInSplit: boolean) => void
  openWikiLink: (options: { target: string; openInSplit: boolean }) => void
  /** Open a non-note file: a canvas or base in Kore, anything else in its app. */
  openFile: (path: string) => void
  resolveImageUrl: (src: string) => string | null
}

/** Below this zoom a note card shows only its title: the preview is unreadable there. */
export const PREVIEW_MIN_ZOOM = 0.25

function placement(node: CanvasNode): CSSProperties {
  return { left: node.x, top: node.y, width: node.width, height: node.height }
}

function tinted(color: string | null, percent: number): CSSProperties {
  const css = canvasColor(color)
  return css === null
    ? {}
    : {
        borderColor: css,
        backgroundColor: `color-mix(in srgb, ${css} ${percent}%, var(--color-surface))`,
      }
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

interface CanvasCardProps {
  node: CanvasNode
  /**
   * Whether note cards show their preview (the zoom is past
   * {@link PREVIEW_MIN_ZOOM}). A flag, not the zoom: zooming then redraws
   * no card until it crosses the line.
   */
  preview: boolean
  actions: CanvasCardActions
  /** Whether the node can be pressed to select, drag and resize it (the Mac). */
  editable: boolean
  /** This text card's text is open for editing. */
  editingText: boolean
  /** End text editing: the new text, or null to keep it. Stable across renders. */
  onCommitText: (id: string, text: string | null) => void
}

/**
 * One canvas node, placed in canvas coordinates. Memoised: a drag redraws
 * only the cards it moves. A card's body (a group's label) carries
 * `data-canvas-node-id`, the handle the board's drag starts from.
 */
export const CanvasCard = memo(function CanvasCard({
  node,
  preview,
  actions,
  editable,
  editingText,
  onCommitText,
}: CanvasCardProps): ReactElement {
  const handle = editable ? node.id : undefined
  if (node.type === 'group') {
    return (
      <div
        data-testid="canvas-group"
        className="absolute rounded-xl border-2 border-border bg-surface/40"
        style={{ ...placement(node), ...tinted(node.color, 6) }}
      >
        {node.label !== null ? (
          <span
            data-canvas-node-id={handle}
            className={cn(
              'absolute bottom-full left-0 mb-1.5 whitespace-nowrap text-lg font-medium text-text-secondary',
              editable && 'cursor-move',
            )}
          >
            {node.label}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div
      data-canvas-card
      data-canvas-node-id={handle}
      data-testid="canvas-card"
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-lg border-2 border-border bg-surface shadow-sm',
        editable ? 'cursor-default' : 'cursor-auto',
      )}
      style={{ ...placement(node), ...tinted(node.color, 8) }}
    >
      {node.type === 'text' && editingText ? (
        <Textarea
          autoFocus
          aria-label="Card text"
          defaultValue={node.text}
          onBlur={(event) => {
            const text = event.currentTarget.value
            onCommitText(node.id, text === node.text ? null : text)
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' ||
              (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
            ) {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          placeholder="Write in Markdown"
          className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3 text-sm text-text placeholder:text-text-muted md:text-sm dark:bg-transparent"
        />
      ) : node.type === 'text' ? (
        <div data-canvas-scroll className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <MarkdownPreview
            content={node.text}
            resolveImageUrl={actions.resolveImageUrl}
            onWikiLinkClick={actions.openWikiLink}
          />
        </div>
      ) : node.type === 'link' ? (
        <LinkCard url={node.url} />
      ) : (
        <FileCard file={node.file} subpath={node.subpath} preview={preview} actions={actions} />
      )}
    </div>
  )
})

function LinkCard({ url }: { url: string }): ReactElement {
  const openLink = useOpenExternalLink()
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // Not a parseable URL: show it as written.
  }
  // Nothing remote loads on open (no live page preview): opening is a click.
  return (
    <a
      href={url}
      onClick={(event) => {
        openLink({ href: url, event: event.nativeEvent, mod: isModEvent(event) })
      }}
      className="flex min-h-0 flex-1 flex-col justify-center gap-1 px-4 py-3 hover:bg-surface-hover"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Link aria-hidden className="size-3.5 shrink-0 text-text-muted" />
        <span className="truncate">{host}</span>
      </span>
      <span className="truncate text-xs text-text-muted">{url}</span>
    </a>
  )
}

function FileCard({
  file,
  subpath,
  preview,
  actions,
}: {
  file: string
  subpath: string | null
  preview: boolean
  actions: CanvasCardActions
}): ReactElement {
  const kind = wikiEmbedKind(file)
  if (kind === 'image') {
    const src = actions.resolveImageUrl(file)
    return src === null ? (
      <p className="px-4 py-3 text-sm text-text-muted">{fileName(file)}</p>
    ) : (
      <img src={src} alt={fileName(file)} className="size-full object-contain" draggable={false} />
    )
  }
  if (kind === 'file') {
    const name = isCanvasPath(file) ? canvasDisplayName(file) : fileName(file)
    return (
      <button
        type="button"
        onClick={() => {
          actions.openFile(file)
        }}
        className="flex min-h-0 flex-1 items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover"
      >
        <Paperclip aria-hidden className="size-4 shrink-0 text-text-muted" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text">{name}</span>
          <span className="block truncate text-xs text-text-muted">
            {isCanvasPath(file) ? 'Canvas' : isBasePath(file) ? 'Base' : file}
          </span>
        </span>
      </button>
    )
  }
  return <NoteCard path={file} subpath={subpath} preview={preview} actions={actions} />
}

function NoteCard({
  path,
  subpath,
  preview,
  actions,
}: {
  path: string
  subpath: string | null
  preview: boolean
  actions: CanvasCardActions
}): ReactElement {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const generation = graph?.generation ?? null
  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'canvas-note', path, subpath, generation],
    queryFn: async () => {
      const source = await readExistingNoteSource(path, generation!)
      const markdown = transclusionMarkdown(source, subpath)
      return {
        title: parseNote({ path, source }).title,
        markdown:
          markdown === null ? null : subpath === null ? stripLeadingHeading(markdown) : markdown,
      }
    },
    enabled: preview && bridgeReady && generation !== null,
    retry: false,
  })
  const fallbackTitle = fileName(path).replace(/\.md$/i, '')
  const title = data?.title ?? fallbackTitle
  const label = subpath === null ? title : `${title} › ${subpath}`
  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-text">{label}</span>
        <button
          type="button"
          aria-label={`Open ${title}`}
          title={`Open ${title}`}
          onClick={(event) => {
            actions.openNote(path, isModEvent(event))
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </button>
      </header>
      {!preview ? null : isError ? (
        <p className="px-4 py-3 text-sm text-text-muted">This note isn’t in the vault.</p>
      ) : data === undefined ? null : data.markdown === null ? (
        <p className="px-4 py-3 text-sm text-text-muted">No heading “{subpath}” in this note.</p>
      ) : (
        <div data-canvas-scroll className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <MarkdownPreview
            content={data.markdown}
            resolveImageUrl={actions.resolveImageUrl}
            onWikiLinkClick={actions.openWikiLink}
          />
        </div>
      )}
    </>
  )
}
