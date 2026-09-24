import {
  formatEmbedBlock,
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
}

/** Parse a note body's media embeds and note transclusions. */
export function parseBodyEmbeds(markdown: string): BodyEmbeds {
  return { media: parseEmbedBlocks(markdown), transclusions: parseNoteTransclusions(markdown) }
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
    })
  )
}
