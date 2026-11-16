import {
  parseBaseEmbeds,
  type BaseEmbed,
  formatNoteTransclusion,
  parseNoteTransclusions,
  type NoteTransclusion,
} from '@kore/core'

/**
 * The embeds a note pane renders below the editor, parsed from the body.
 * ` ```embed ` fences are not here: the editor draws them where they sit.
 */
export interface BodyEmbeds {
  readonly transclusions: readonly NoteTransclusion[]
  /** `![[Name.base#View]]` embeds, rendered as live base views. */
  readonly bases: readonly BaseEmbed[]
}

/** Parse a note body's note transclusions and base embeds. */
export function parseBodyEmbeds(markdown: string): BodyEmbeds {
  return {
    transclusions: parseNoteTransclusions(markdown),
    bases: parseBaseEmbeds(markdown),
  }
}

/** Equal when both would render the same embeds, compared by their Markdown. */
export function sameBodyEmbeds(first: BodyEmbeds, second: BodyEmbeds): boolean {
  return (
    first.transclusions.length === second.transclusions.length &&
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
