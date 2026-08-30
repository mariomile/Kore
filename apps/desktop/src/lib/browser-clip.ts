import { captureEnvelopeSchema, type BrowserPageRead, type CaptureEnvelope } from '@reflect/core'

/**
 * How much of the page's visible text a clip carries. Enough for the drain's
 * raw save and later enrichment to work offline; far under the spool file's
 * defensive size cap.
 */
export const BROWSER_CLIP_MAX_CHARS = 20_000

/**
 * A link-capture envelope for the page the in-app browser is showing — the
 * same shape the Chrome extension and the iOS share sheet spool, so a clip
 * rides the entire existing pipeline: inbox drain, dedup, daily-note
 * placement, and enrichment. Parsing through the schema is the gate: a
 * non-http(s) page (blank tab, restricted scheme) refuses here.
 */
export function buildBrowserClipEnvelope(page: BrowserPageRead): CaptureEnvelope {
  const text = page.text.trim()
  return captureEnvelopeSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    url: page.url,
    title: page.title,
    ...(text === '' ? {} : { contentText: text }),
    capturedAt: new Date().toISOString(),
    source: 'in-app-browser',
  })
}
