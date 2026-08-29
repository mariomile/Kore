import { useState, type ReactElement } from 'react'
import {
  linkKindInfo,
  videoPlayerUrl,
  type EmbedBlock,
  type HtmlEmbed,
  type LinkKind,
  type UrlEmbed,
} from '@reflect/core'
import {
  Book,
  Chat,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Layers,
  Microphone,
  Note,
  Play,
  Terminal,
} from '@/components/icons'
import type { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { openExternalUrl } from '@/editor/open-external-link'

interface EmbeddedMediaProps {
  block: EmbedBlock
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
 * One ` ```embed ` fence, rendered underneath the editor.
 *
 * Nothing remote loads on open. A note is opened constantly, and a card that
 * fetched a third-party player or widget on render would tell that provider
 * every time — so a video and a raw-HTML embed show a card first and load the
 * frame on an explicit click. An image is the exception: it *is* the content,
 * and a plain `![](url)` in the same note already loads it.
 */
export function EmbeddedMedia({ block }: EmbeddedMediaProps): ReactElement {
  return block.kind === 'html' ? <HtmlFrame block={block} /> : <LinkCard block={block} />
}

function LinkCard({ block }: { block: UrlEmbed }): ReactElement {
  const [playing, setPlaying] = useState(false)
  const info = linkKindInfo(block.linkKind)
  const Glyph = KIND_GLYPH[block.linkKind]
  const player = block.linkKind === 'video' ? videoPlayerUrl(block.url) : null

  if (block.linkKind === 'image') {
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

  if (playing && player !== null) {
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
        <Button variant="ghost" size="sm" onClick={() => setPlaying(true)}>
          <Play aria-hidden data-icon="inline-start" />
          Play
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

/**
 * Raw markup in a frame that cannot reach the app: no `allow-same-origin`, so
 * scripts run in an opaque origin with no access to the app's DOM, storage or
 * cookies, and the markup is served through `srcDoc` rather than a URL. Held
 * behind a click for the same reason a video is — a widget that phones home
 * should do it when the reader asks, not when the note opens.
 */
function HtmlFrame({ block }: { block: HtmlEmbed }): ReactElement {
  const [loaded, setLoaded] = useState(false)

  if (!loaded) {
    return (
      <section className="mt-6 flex items-center gap-3 rounded-lg border border-border border-dashed px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-muted">
          <Layers aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-2xs font-medium tracking-wide text-text-muted uppercase">
            HTML embed
          </span>
          <span className="block text-sm text-text-muted">
            Runs in a sandboxed frame. Nothing loads until you show it.
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>
          Show
        </Button>
      </section>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-border">
      <iframe
        srcDoc={block.html}
        title="HTML embed"
        sandbox="allow-scripts allow-popups allow-forms"
        referrerPolicy="no-referrer"
        className="h-96 w-full bg-surface"
      />
    </div>
  )
}
