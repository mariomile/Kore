import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  embedPlayer,
  linkKindInfo,
  loadLinkPreview,
  type EmbedLayout,
  type LinkKind,
  type LinkPreview,
  type UrlEmbed,
} from '@kore/core'
import {
  Book,
  Chat,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Microphone,
  Note,
  Play,
  Terminal,
} from '@/components/icons'
import type { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { linkCardElement, requestLinkLayout } from '@/editor/link-card-dom'
import { openExternalUrl } from '@/editor/open-external-link'

interface EmbeddedLinkCardProps {
  block: UrlEmbed
}

const KIND_GLYPH: Record<LinkKind, Icon> = {
  article: Book,
  video: Play,
  image: ImageIcon,
  audio: Microphone,
  repo: Terminal,
  document: Note,
  social: Chat,
  link: Globe,
}

/** Two stacked cards: the same appearance glyph the rich card draws. */
function LayoutGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16v8H4z" />
      <path d="M4 17h16" />
      <path d="M4 20h10" />
    </svg>
  )
}

/** `https://github.com/mariomile/Kore` → `github.com/mariomile/Kore`. */
function readableUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '')
    return `${parsed.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

/**
 * Everything a player frame may do: run its own scripts in its own origin,
 * open the provider in a new window, go fullscreen. Never navigate the app.
 */
const PLAYER_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms'

/**
 * The page's own preview (title, description, image, favicon) for a link
 * that has no player, or null while it loads or when the page cannot
 * describe itself. Core keeps one lookup per URL for the session, so a
 * re-render or a second card for the same link never refetches. The caller
 * only renders this card for a note that is not private.
 */
function useRichPreview(url: string | null): LinkPreview | null {
  const [preview, setPreview] = useState<{ url: string; preview: LinkPreview } | null>(null)
  useEffect(() => {
    if (url === null) {
      return
    }
    let live = true
    void loadLinkPreview(url).then((found) => {
      if (live && found !== null) {
        setPreview({ url, preview: found })
      }
    })
    return () => {
      live = false
    }
  }, [url])
  return preview !== null && preview.url === url ? preview.preview : null
}

/**
 * The rich card: the same DOM the editor's pasted-link cards draw
 * (`link-card-dom`), so a bookmark looks one way wherever it came from. Its
 * open button opens the page; a press elsewhere is left to the fence, which
 * puts the caret on the URL.
 */
function RichLinkCard({
  preview,
  layout,
}: {
  preview: LinkPreview
  layout: EmbedLayout
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (host === null) {
      return
    }
    const card = linkCardElement(preview, layout)
    const open = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-link-card-open]')) {
        event.preventDefault()
        openExternalUrl(preview.url)
      }
    }
    card.addEventListener('click', open)
    host.replaceChildren(card)
    return () => {
      card.removeEventListener('click', open)
      host.replaceChildren()
    }
  }, [preview, layout])
  return <div ref={hostRef} data-testid="rich-link-card" />
}

/**
 * A typed remote URL card that loads image or player content only on request.
 * It is drawn in the note where its fence sits, on a soft filled surface
 * (no border, the Craft way). A plain page becomes a rich card once its
 * preview arrives; until then, and when it never does, it is this compact
 * row.
 * A link with a known player (a video, a song, a Figma file, a pen) names
 * its service and holds the player behind Play or Show.
 */
export function EmbeddedLinkCard({ block }: EmbeddedLinkCardProps): ReactElement {
  const [loaded, setLoaded] = useState(false)
  const info = linkKindInfo(block.linkKind)
  const Glyph = KIND_GLYPH[block.linkKind]
  const player = block.linkKind === 'image' ? null : embedPlayer(block.url)
  const preview = useRichPreview(block.linkKind !== 'image' && player === null ? block.url : null)

  if (preview !== null) {
    return <RichLinkCard preview={preview} layout={block.layout} />
  }
  const eyebrow = player?.provider ?? (block.linkKind === 'link' ? null : info.label)

  if (block.linkKind === 'image' && loaded) {
    return (
      <figure className="my-1 overflow-hidden rounded-xl bg-surface-hover">
        <img
          src={block.url}
          alt={readableUrl(block.url)}
          className="max-h-[32rem] w-full bg-surface-sunken object-contain"
        />
        <figcaption className="px-3 py-2 text-xs text-text-muted">
          {readableUrl(block.url)}
        </figcaption>
      </figure>
    )
  }

  if (loaded && player !== null) {
    return (
      <div className="my-1 overflow-hidden rounded-xl bg-surface-hover">
        <iframe
          src={player.url}
          title={`${player.provider}: ${readableUrl(block.url)}`}
          allow="autoplay; accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          // Scripts plus same-origin only unsandbox a frame of the app's own
          // origin; a player is always a third-party https host from core.
          // eslint-disable-next-line @eslint-react/dom-no-unsafe-iframe-sandbox
          sandbox={PLAYER_SANDBOX}
          className={player.height === null ? 'block aspect-video w-full' : 'block w-full'}
          style={player.height === null ? undefined : { height: player.height }}
        />
      </div>
    )
  }

  return (
    <section className="my-1 flex cursor-text items-center gap-3 rounded-xl bg-surface-hover px-3 py-2.5 select-none active:bg-surface-active">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-text-muted">
        <Glyph aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        {/* A plain web page needs no "Link" eyebrow: the address says it. */}
        {eyebrow !== null ? (
          <span className="block text-2xs font-medium tracking-wide text-text-muted uppercase">
            {eyebrow}
          </span>
        ) : null}
        <span className="block truncate text-sm text-text">{readableUrl(block.url)}</span>
      </span>
      {player !== null ? (
        <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>
          {player.playable ? (
            <>
              <Play aria-hidden data-icon="inline-start" />
              Play
            </>
          ) : (
            'Show'
          )}
        </Button>
      ) : null}
      {block.linkKind === 'image' ? (
        <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>
          Show
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Link appearance"
        onClick={(event) =>
          requestLinkLayout(event.currentTarget, {
            url: block.url,
            title: null,
            layout: block.layout,
          })
        }
      >
        <LayoutGlyph />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Open ${readableUrl(block.url)}`}
        onClick={() => openExternalUrl(block.url)}
      >
        <ExternalLink aria-hidden />
      </Button>
    </section>
  )
}
