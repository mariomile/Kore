import { useLayoutEffect, type RefObject } from 'react'
import { decorateCallouts } from '@/editor/callout-dom'

/**
 * Keep the callouts under `hostRef` stamped for as long as it is mounted
 * (`callout-dom.ts`). The host wraps a `MarkdownView`, which may re-render its
 * tree after this commit; our own text edits re-trigger the observer too, and
 * `decorateCallouts` skips what it already stamped.
 */
export function useCalloutDom(hostRef: RefObject<HTMLElement | null>, folding: boolean): void {
  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) {
      return
    }
    const options = { folding }
    decorateCallouts(host, options)
    const observer = new MutationObserver(() => {
      decorateCallouts(host, options)
    })
    observer.observe(host, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
    }
  }, [hostRef, folding])
}
