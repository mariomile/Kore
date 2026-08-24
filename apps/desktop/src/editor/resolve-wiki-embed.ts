import type { ParsedWikiEmbed, WikiEmbedResolution } from '@meowdown/core'
import { wikiEmbedKind } from '@reflect/core'

function fileOf(target: string): string {
  return target.split('#')[0] ?? target
}

/**
 * Classify one `![[target]]` for meowdown: images and other attachments
 * render in-editor; notes return undefined so the source stays editable and
 * the host can transclude the body underneath the editor.
 */
export function resolveWikiEmbed(embed: ParsedWikiEmbed): WikiEmbedResolution | undefined {
  const kind = wikiEmbedKind(embed.target)
  const file = fileOf(embed.target)
  if (kind === 'image') {
    return embed.display === ''
      ? { kind: 'image', src: file }
      : { kind: 'image', src: file, alt: embed.display }
  }
  if (kind === 'file') {
    return embed.display === ''
      ? { kind: 'file', href: file }
      : { kind: 'file', href: file, name: embed.display }
  }
  return undefined
}
