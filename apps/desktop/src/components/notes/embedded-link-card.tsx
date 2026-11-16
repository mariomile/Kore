import { useState, type ReactElement } from 'react'
import { embedPlayer, linkKindInfo, type LinkKind, type UrlEmbed } from '@kore/core'
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
 * A typed remote URL card that loads image or player content only on request.
 * It is drawn in the note where its fence sits, on a soft filled surface
 * (no border, the Craft way).
 * A link with a known player (a video, a song, a Figma file, a pen) names
 * its service and holds the player behind Play or Show.
 */
export function EmbeddedLinkCard({ block }: EmbeddedLinkCardProps): ReactElement {
  const [loaded, setLoaded] = useState(false)
  const info = linkKindInfo(block.linkKind)
  const Glyph = KIND_GLYPH[block.linkKind]
  const player = block.linkKind === 'image' ? null : embedPlayer(block.url)
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
        aria-label={`Open ${readableUrl(block.url)}`}
        onClick={() => openExternalUrl(block.url)}
      >
        <ExternalLink aria-hidden />
      </Button>
    </section>
  )
}
