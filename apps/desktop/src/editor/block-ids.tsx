import { useMemo, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { createBlockIdPlugin } from './block-id-plugin'

/**
 * Obsidian `^id` line references in the live editor (Plan 33 C3): the arrival
 * flash of a followed `[[Note#^id]]`. Mounted as a NoteEditor child.
 */
export function BlockIds(): ReactElement | null {
  useExtension(useMemo(() => definePlugin(createBlockIdPlugin()), []))
  return null
}
