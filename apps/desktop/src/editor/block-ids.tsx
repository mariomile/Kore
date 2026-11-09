import { useMemo, useRef, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { Priority } from '@meowdown/core'
import { useExtension } from '@meowdown/react'
import { createBlockIdPlugin } from './block-id-plugin'
import { defineBlockLinkLabels } from './block-link-label'

interface BlockIdsProps {
  /**
   * The wiki target other notes link this note by (its title, or its date for
   * a daily note); null hides "Copy link to line" until the note has one.
   */
  readonly linkTarget?: string | null
}

/**
 * Obsidian `^id` line references in the live editor (Plan 33 C3): hidden
 * markers, `[[Note#^id]]` labels without the id, the arrival flash of a followed `[[Note#^id]]`, and the note's
 * link target for "Copy link to line". Mounted as a NoteEditor child.
 */
export function BlockIds({ linkTarget = null }: BlockIdsProps): ReactElement | null {
  const latest = useRef(linkTarget)
  latest.current = linkTarget
  useExtension(
    useMemo(() => definePlugin(createBlockIdPlugin({ linkTarget: () => latest.current })), []),
    // High: Enter, Delete and → at a line's visible end must be seen before
    // the list and paragraph keymaps act on the hidden id.
    { priority: Priority.high },
  )
  useExtension(
    useMemo(() => defineBlockLinkLabels(), []),
    { priority: Priority.high },
  )
  return null
}
