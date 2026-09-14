import { useCallback } from 'react'
import { dispatchDeepLink } from '@/lib/deep-links/intake'

/** Follow one in-app `reflect://` link. */
export type FollowDeepLink = (options: { href: string; openInSplit: boolean }) => void

/**
 * Follow an in-app deep link by dispatching it in place. Note links carry
 * the split-pane convention through {@link useNoteLinkNavigation} instead;
 * a deep link always dispatches regardless of `openInSplit`, so the
 * graph-scoped handler can write a capture link or navigate an address-like
 * one.
 */
export function useFollowDeepLink(): FollowDeepLink {
  return useCallback(({ href }: { href: string; openInSplit: boolean }) => {
    dispatchDeepLink(href)
  }, [])
}
