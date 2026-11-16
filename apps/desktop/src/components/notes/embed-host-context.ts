import { createContext, use } from 'react'
import type { EmbedHostNote } from '@kore/core'

/**
 * The note a collection fence is rendered inside, so a `key = this` filter
 * can point at it. Null outside a note (a base, a preview), where "this note"
 * matches nothing.
 */
export const EmbedHostContext = createContext<EmbedHostNote | null>(null)

export function useEmbedHost(): EmbedHostNote | null {
  return use(EmbedHostContext)
}
