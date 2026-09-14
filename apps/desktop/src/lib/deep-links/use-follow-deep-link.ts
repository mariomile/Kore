import { useCallback } from 'react'
import { dispatchDeepLink } from '@/lib/deep-links/intake'

/** Follow one in-app `reflect://` link. */
export type FollowDeepLink = (options: { href: string }) => void

/**
 * Follow an in-app deep link by dispatching it in place. A deep link is not
 * always a place: a capture link (append, task) is a write, so the graph-scoped
 * handler always gets it whatever modifier the click held. Note links carry the
 * split-pane convention instead, through `useNoteLinkNavigation`.
 */
export function useFollowDeepLink(): FollowDeepLink {
  return useCallback(({ href }: { href: string }) => {
    dispatchDeepLink(href)
  }, [])
}
