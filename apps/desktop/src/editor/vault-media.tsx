import { useEffect, useMemo, useRef } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { createVaultMediaPlugin } from './vault-media-plugin'

interface VaultMediaProps {
  /** The webview URL of a vault file (`resolveImageUrl` serves any file). */
  resolveUrl: (href: string) => string | null
}

/**
 * Play vault video and audio inline: a line that is one embedded media file
 * draws its player (`vault-media-plugin`). Unlike link cards nothing leaves
 * the device, so private notes get players too. Mounted as a NoteEditor
 * child.
 */
export function VaultMedia({ resolveUrl }: VaultMediaProps): null {
  const resolveRef = useRef(resolveUrl)
  useEffect(() => {
    resolveRef.current = resolveUrl
  }, [resolveUrl])
  const extension = useMemo(
    () => definePlugin(createVaultMediaPlugin({ resolveUrl: (href) => resolveRef.current(href) })),
    [],
  )
  useExtension(extension)
  return null
}
