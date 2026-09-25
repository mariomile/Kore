import { act as reactAct } from 'react'

declare global {
  // React reads this to decide whether `act` is supported here.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/**
 * React's `act`, with the act environment switched on until it settles.
 * `vitest-browser-react` enables it only inside its own `render` / `act`, so
 * calling React's `act` directly makes React warn that the environment "is
 * not configured to support act". Await it before causing further updates:
 * React flushes part of the work after `act` returns.
 */
export function act<T>(callback: () => T | Promise<T>): Promise<Awaited<T>> {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return Promise.resolve(reactAct(callback)).finally(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous
  }) as Promise<Awaited<T>>
}
