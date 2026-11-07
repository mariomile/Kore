import { useEffect, useMemo, useState } from 'react'
import { resolveXPostEmbed, resolveYouTubeEmbed } from '@reflect/core'

/** The card data resolvers meowdown's post-embed cards call. */
export interface PostEmbedResolvers {
  resolveXPost: (url: string) => ReturnType<typeof resolveXPostEmbed>
  resolveYouTubeVideo: (url: string) => ReturnType<typeof resolveYouTubeEmbed>
}

/** Resolvers that never fetch: every card shows its own "unavailable" state. */
export const NO_POST_EMBEDS: PostEmbedResolvers = {
  resolveXPost: () => Promise.resolve(undefined),
  resolveYouTubeVideo: () => Promise.resolve(undefined),
}

interface Gate {
  readonly decided: Promise<boolean>
  open: (value: boolean) => void
}

/** A one-shot yes/no that resolvers can await before it is decided. */
function createGate(): Gate {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  return { decided: promise, open: resolve }
}

/**
 * Stable X post / YouTube resolvers for one editor, routed through core's
 * Rust-bounded fetch (meowdown's defaults `fetch()` from the webview, which
 * the CSP blocks). Fetching reaches X or YouTube, so it waits on `allowed`:
 * cards asked for before the note's privacy is known hold their loading
 * state until it is, and a private note never fetches.
 */
export function usePostEmbedResolvers(allowed: boolean | undefined): PostEmbedResolvers {
  const [gate] = useState(createGate)

  useEffect(() => {
    if (allowed !== undefined) {
      gate.open(allowed)
    }
  }, [allowed, gate])

  return useMemo(
    () => ({
      resolveXPost: async (url) =>
        (await gate.decided) ? await resolveXPostEmbed(url) : undefined,
      resolveYouTubeVideo: async (url) =>
        (await gate.decided) ? await resolveYouTubeEmbed(url) : undefined,
    }),
    [gate],
  )
}
