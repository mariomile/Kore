import {
  formatEmbedBlock,
  parseBaseEmbeds,
  type BaseEmbed,
  formatNoteTransclusion,
  parseEmbedBlocks,
  parseNoteTransclusions,
  type EmbedBlock,
  type NoteTransclusion,
} from '@reflect/core'

/** The embeds a note pane renders below the editor, parsed from the body. */
export interface BodyEmbeds {
  readonly media: readonly EmbedBlock[]
  readonly transclusions: readonly NoteTransclusion[]
  /** `![[Name.base#View]]` embeds, rendered as live base views. */
  readonly bases: readonly BaseEmbed[]
}

/** Parse a note body's media embeds and note transclusions. */
export function parseBodyEmbeds(markdown: string): BodyEmbeds {
  return {
    media: parseEmbedBlocks(markdown),
    transclusions: parseNoteTransclusions(markdown),
    bases: parseBaseEmbeds(markdown),
  }
}

/** Equal when both would render the same embeds, compared by their Markdown. */
export function sameBodyEmbeds(first: BodyEmbeds, second: BodyEmbeds): boolean {
  return (
    first.media.length === second.media.length &&
    first.transclusions.length === second.transclusions.length &&
    first.media.every((block, index) => {
      const other = second.media[index]
      return other !== undefined && formatEmbedBlock(block) === formatEmbedBlock(other)
    }) &&
    first.transclusions.every((embed, index) => {
      const other = second.transclusions[index]
      return other !== undefined && formatNoteTransclusion(embed) === formatNoteTransclusion(other)
    }) &&
    first.bases.length === second.bases.length &&
    first.bases.every((embed, index) => {
      const other = second.bases[index]
      return other !== undefined && embed.target === other.target && embed.view === other.view
    })
  )
}
