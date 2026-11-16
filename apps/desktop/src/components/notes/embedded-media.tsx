import type { ReactElement } from 'react'
import type { EmbedBlock } from '@kore/core'
import { Lock } from '@/components/icons'
import { EmbeddedHtmlFrame } from './embedded-html-frame'
import { EmbeddedLinkCard } from './embedded-link-card'

interface EmbeddedMediaProps {
  block: EmbedBlock
  /** The containing note is private: nothing remote may render. */
  privateNote: boolean
}

/**
 * One ` ```embed ` fence, drawn by the editor where the fence sits.
 *
 * Nothing remote loads on open. A note is opened constantly, and a card that
 * fetched a third-party player or widget on render would tell that provider
 * every time, so images, videos, and raw-HTML embeds all require an explicit
 * click. Private notes block the remote surface entirely.
 */
export function EmbeddedMedia({ block, privateNote }: EmbeddedMediaProps): ReactElement {
  if (privateNote) {
    return (
      <section className="my-1 flex items-center gap-3 rounded-xl bg-surface-hover px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-text-muted">
          <Lock aria-hidden className="size-4" />
        </span>
        <span className="text-sm text-text-muted">
          Remote embeds are disabled for private notes.
        </span>
      </section>
    )
  }
  return block.kind === 'html' ? (
    <EmbeddedHtmlFrame block={block} />
  ) : (
    <EmbeddedLinkCard block={block} />
  )
}
