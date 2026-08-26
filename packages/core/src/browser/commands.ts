import { z } from 'zod'
import { getBridge, type Unlisten } from '../ipc/bridge'
import { call } from '../ipc/invoke'

/**
 * Typed bindings for the embedded in-app browser: a child webview the shell
 * docks over a host element the frontend renders (a browser tab or the
 * context rail). All rectangles are logical CSS pixels relative to the
 * window's viewport — exactly what `getBoundingClientRect` reports in the
 * main webview, which fills the window.
 */

const voidSchema = z.null()

const browserNavigatedSchema = z.object({
  url: z.string().min(1),
})

export type BrowserNavigatedEvent = z.infer<typeof browserNavigatedSchema>

/** The host rectangle the embedded page should cover, in logical CSS px. */
export interface BrowserEmbedRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Show the embedded browser over `rect`, creating the child webview on first
 * use. Passing a `url` navigates only when it differs from the current page,
 * so re-showing a mounted pane never reloads. Desktop-only.
 */
export async function browserEmbedShow(url: string | null, rect: BrowserEmbedRect): Promise<void> {
  await call('browser_embed_show', { url, ...rect }, voidSchema)
}

/** Follow the host element as it moves or resizes. */
export async function browserEmbedBounds(rect: BrowserEmbedRect): Promise<void> {
  await call('browser_embed_bounds', { ...rect }, voidSchema)
}

/** Close the embedded browser and release the remote page's resources. */
export async function browserEmbedClose(): Promise<void> {
  await call('browser_embed_close', {}, voidSchema)
}

/** Load a new page. Web (http/https) URLs only — anything else errors. */
export async function browserEmbedNavigate(url: string): Promise<void> {
  await call('browser_embed_navigate', { url }, voidSchema)
}

/** History back, like a browser chrome's back button. */
export async function browserEmbedBack(): Promise<void> {
  await call('browser_embed_back', {}, voidSchema)
}

/** History forward. */
export async function browserEmbedForward(): Promise<void> {
  await call('browser_embed_forward', {}, voidSchema)
}

/** Reload the current page. */
export async function browserEmbedReload(): Promise<void> {
  await call('browser_embed_reload', {}, voidSchema)
}

const browserPageReadSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  truncated: z.boolean(),
})

/** One extracted page: final URL, title, visible text, and whether it was cut. */
export type BrowserPageRead = z.infer<typeof browserPageReadSchema>

/**
 * Extract the current page's visible text, waiting (bounded) for the
 * document to finish loading. `expectUrl` tightens the wait right after a
 * navigation so the previous page is not read as the new one.
 */
export function browserEmbedRead(options?: {
  expectUrl?: string
  maxChars?: number
}): Promise<BrowserPageRead> {
  return call(
    'browser_embed_read',
    { expectUrl: options?.expectUrl ?? null, maxChars: options?.maxChars ?? null },
    browserPageReadSchema,
  )
}

/**
 * Load and extract a web page as one lifecycle operation. Background-only
 * webviews are released before this resolves; a visible Browser pane remains.
 */
export function browserEmbedOpen(
  url: string,
  options?: { maxChars?: number },
): Promise<BrowserPageRead> {
  return call(
    'browser_embed_open',
    { url, maxChars: options?.maxChars ?? null },
    browserPageReadSchema,
  )
}

/** The embedded page navigated (link click, redirect, or a navigate call). */
export function subscribeBrowserNavigated(
  handler: (event: BrowserNavigatedEvent) => void,
): Promise<Unlisten> {
  return getBridge().listen('browser:navigated', (payload) => {
    const parsed = browserNavigatedSchema.safeParse(payload)
    if (parsed.success) {
      handler(parsed.data)
    } else {
      console.error('invalid browser:navigated payload:', parsed.error)
    }
  })
}
