import { useMemo, useRef, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { createBlockIdPlugin } from './block-id-plugin'

interface BlockIdsProps {
  /**
   * The wiki target other notes link this note by (its title, or its date for
   * a daily note); null hides "Copy link to line" until the note has one.
   */
  readonly linkTarget?: string | null
}

/**
 * Obsidian `^id` line references in the live editor (Plan 33 C3): muted
 * markers, the arrival flash of a followed `[[Note#^id]]`, and the note's
 * link target for "Copy link to line". Mounted as a NoteEditor child.
 */
export function BlockIds({ linkTarget = null }: BlockIdsProps): ReactElement | null {
  const latest = useRef(linkTarget)
  latest.current = linkTarget
  useExtension(
    useMemo(() => definePlugin(createBlockIdPlugin({ linkTarget: () => latest.current })), []),
  )
  return null
}
