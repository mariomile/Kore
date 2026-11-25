import { parseIframeEmbed, type IframeEmbed, type PageLinkPreview } from '@kore/core'
import type { Plugin } from '@prosekit/pm/state'
import { createBlockWidgetPlugin } from './block-widget-plugin'
import { handleCardPress } from './card-press'
import { linkCardElement } from './link-card-dom'
import { memoByNode } from './node-memo'

/**
 * Pasted iframes in the live editor: a paragraph that is one `<iframe>` (a
 * map, a chart, a form, copied from Obsidian or a site's Embed button) draws
 * as a link card for the framed page, whose Show loads the frame in place,
 * sandboxed and one at a time like every other player. Until then nothing
 * reaches the page's host, so private notes get these cards too.
 */

export interface IframeCardOptions {
  /** Open the framed page (its open button, or a mod-click). */
  open: (url: string, event: MouseEvent) => void
}

/** The iframe a paragraph is, or null. */
export const paragraphIframe = memoByNode((paragraph): IframeEmbed | null =>
  paragraph.type.name === 'paragraph' ? parseIframeEmbed(paragraph.textContent) : null,
)

/** The card's copy: what the frame calls itself, and where it comes from. */
function framePreview({ player, title }: IframeEmbed): PageLinkPreview {
  return {
    kind: 'page',
    url: player.url,
    title: title ?? player.provider,
    description: 'Embedded page. Nothing loads until you open it.',
    siteName: player.provider,
    provider: null,
    imageUrl: null,
    iconUrl: null,
  }
}

/** The ProseMirror plugin behind `IframeCards`. */
export function createIframeCardPlugin(options: IframeCardOptions): Plugin {
  return createBlockWidgetPlugin<IframeEmbed>({
    name: 'kore-iframe-cards',
    match: paragraphIframe,
    identity: ({ player }) => player.url,
    render: (embed, view) => {
      const card = linkCardElement(framePreview(embed), 'card', {
        player: embed.player,
        appearance: false,
      })
      handleCardPress(card, view, {
        url: embed.player.url,
        open: options.open,
        drawn: (paragraph) => paragraphIframe(paragraph)?.player.url === embed.player.url,
      })
      return card
    },
    sourceClass: 'kore-link-card-source',
  })
}
