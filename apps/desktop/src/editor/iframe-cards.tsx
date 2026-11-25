import { useMemo } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { createIframeCardPlugin } from './iframe-card-plugin'
import { useOpenCardLink } from './use-open-card-link'

/**
 * Draw pasted iframes as cards that load the frame only on Show
 * (`iframe-card-plugin`). Nothing reaches the framed host before that, so
 * private notes get them too. Mounted as a NoteEditor child.
 */
export function IframeCards(): null {
  const open = useOpenCardLink()
  const extension = useMemo(() => definePlugin(createIframeCardPlugin({ open })), [open])
  useExtension(extension)
  return null
}
