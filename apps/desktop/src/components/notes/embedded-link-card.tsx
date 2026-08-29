import { useState, type ReactElement } from 'react'
import { linkKindInfo, videoPlayerUrl, type LinkKind, type UrlEmbed } from '@reflect/core'
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

/** A typed remote URL card that loads image or player content only on request. */
export function EmbeddedLinkCard({ block }: EmbeddedLinkCardProps): ReactElement {
  const [loaded, setLoaded] = useState(false)
  const info = linkKindInfo(block.linkKind)
  const Glyph = KIND_GLYPH[block.linkKind]
  const player = block.linkKind === 'video' ? videoPlayerUrl(block.url) : null

  if (block.linkKind === 'image' && loaded) {
    return (
      <figure className="mt-6 overflow-hidden rounded-lg border border-border">
        <img
          src={block.url}
          alt={readableUrl(block.url)}
          className="max-h-[32rem] w-full bg-surface-sunken object-contain"
        />
        <figcaption className="border-t border-border px-3 py-2 text-xs text-text-muted">
          {readableUrl(block.url)}
        </figcaption>
      </figure>
    )
  }

  if (loaded && player !== null) {
    return (
      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <iframe
          src={player}
          title={readableUrl(block.url)}
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="aspect-video w-full"
        />
      </div>
    )
  }

  return (
    <section className="mt-6 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-muted">
        <Glyph aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xs font-medium tracking-wide text-text-muted uppercase">
          {info.label}
        </span>
        <span className="block truncate text-sm text-text">{readableUrl(block.url)}</span>
      </span>
      {player !== null ? (
        <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>
          <Play aria-hidden data-icon="inline-start" />
          Play
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
