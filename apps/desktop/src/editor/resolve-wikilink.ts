import type { WikilinkResolver } from '@meowdown/core'
import { blockLinkLabel } from '@reflect/core'

/**
 * Meowdown's wikilink hook for every Kore surface (editor, previews,
 * backlinks): a block reference `[[Note#^id]]` shows the note's name instead
 * of its id (Plan 33 C3). The target is unchanged, so a click still lands on
 * the line; any other link keeps Meowdown's default. Pure, as the parse cache
 * requires.
 */
export const resolveWikilink: WikilinkResolver = ({ target }) => {
  const display = blockLinkLabel(target)
  return display === null ? undefined : { display }
}
