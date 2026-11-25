import { isBasePath, isCanvasPath, isHtmlPath } from '@kore/core'
import type { Route } from './route'

/**
 * The screen of its own a vault file opens as (a base, a canvas, an HTML
 * page), or null for a file that opens in the viewer or the OS. The one
 * place that decides it, for a file card and a wiki link alike. `view` is a
 * base's named view.
 */
export function fileScreenRoute(path: string, view: string | null = null): Route | null {
  if (isBasePath(path)) {
    return { kind: 'base', path, view }
  }
  if (isCanvasPath(path)) {
    return { kind: 'canvas', path }
  }
  if (isHtmlPath(path)) {
    return { kind: 'html', path }
  }
  return null
}
