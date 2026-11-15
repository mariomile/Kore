import type { WikilinkResolver } from '@meowdown/core'
import { wikilinkLabel } from '@kore/core'

/**
 * Meowdown's wikilink hook for every Kore surface (editor, previews,
 * backlinks). Meowdown reads no syntax inside the brackets, so Kore decides
 * the label: an aliased link `[[Notes/Luca|Luca]]` shows "Luca" (Obsidian
 * vaults are full of them), and a block reference `[[Note#^id]]` shows the
 * note's name instead of its id (Plan 33 C3). The target is unchanged, so a
 * click still lands where it did; any other link keeps Meowdown's default.
 * Pure, as the parse cache requires.
 */
export const resolveWikilink: WikilinkResolver = ({ target }) => {
  const display = wikilinkLabel(target)
  return display === null ? undefined : { display }
}
