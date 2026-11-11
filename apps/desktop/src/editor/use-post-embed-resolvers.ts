import { useEffect, useMemo, useState } from 'react'
import { resolveXPostEmbed, resolveYouTubeEmbed } from '@kore/core'

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
  /** Settles once the note's privacy is first known. */
  readonly decided: Promise<void>
  /** Whether fetching is allowed right now; follows every later change. */
  allowed: boolean
  set: (value: boolean) => void
}

/**
 * A yes/no that resolvers can await before it is first decided, and that
 * keeps tracking the latest answer after: a note locked mid-session must
 * stop fetching at once, and the editor is not remounted for it.
 */
function createGate(): Gate {
  const { promise, resolve } = Promise.withResolvers<void>()
  const gate: Gate = {
    decided: promise,
    allowed: false,
    set: (value) => {
      gate.allowed = value
      resolve()
    },
  }
  return gate
}

/**
 * Stable X post / YouTube resolvers for one editor, routed through core's
 * Rust-bounded fetch (meowdown's defaults `fetch()` from the webview, which
 * the CSP blocks). Fetching reaches X or YouTube, so it waits on `allowed`:
 * cards asked for before the note's privacy is known hold their loading
 * state until it is, and a private note never fetches, including one made
 * private after it was opened.
 */
export function usePostEmbedResolvers(allowed: boolean | undefined): PostEmbedResolvers {
  const [gate] = useState(createGate)

  useEffect(() => {
    if (allowed !== undefined) {
      gate.set(allowed)
    }
  }, [allowed, gate])

  return useMemo(() => {
    const permitted = async (): Promise<boolean> => {
      await gate.decided
      return gate.allowed
    }
    return {
      resolveXPost: async (url) => ((await permitted()) ? await resolveXPostEmbed(url) : undefined),
      resolveYouTubeVideo: async (url) =>
        (await permitted()) ? await resolveYouTubeEmbed(url) : undefined,
    }
  }, [gate])
}
