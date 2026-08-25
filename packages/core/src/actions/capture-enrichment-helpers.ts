import { describePage, isDescriptionRejected, type PageEnrichment } from '../ai/describe-page'
import { isAppError } from '../errors'
import { captureLinkPreview, readAsset } from '../graph/commands'
import type { AiProviderConfig } from '../settings/schema'
import { capturePageTextFromBody, type CaptureNoteMeta } from './capture-note'
import type { PageMeta } from './meta-scrape'

/**
 * Per-capture helpers for the enrichment pass (`capture-enrichment`): the
 * one-shot AI provider call and the screenshot / link-preview asset reads
 * that feed it.
 */

/** Inputs for {@link generateEnrichment} — one capture's AI call. */
export interface GenerateEnrichmentInput {
  config: AiProviderConfig
  apiKey: string
  fetchFn?: typeof fetch | undefined
  /** The pending capture's frontmatter keys (URL, screenshot asset). */
  meta: CaptureNoteMeta
  /** The note's current display title. */
  title: string
  scraped: PageMeta | null
  /** The raw drain-written body (page text is extracted from it). */
  body: string
  screenshotBase64?: string | undefined
}

/**
 * The AI leg of one capture's enrichment: make the one-shot provider call and
 * treat a provider refusal as "no enrichment" (`null`) — the scraped meta is
 * the fallback. Transient failures (`auth`, `network`) propagate for retry.
 */
export async function generateEnrichment(
  input: GenerateEnrichmentInput,
): Promise<PageEnrichment | null> {
  try {
    return await describePage({
      config: input.config,
      apiKey: input.apiKey,
      fetchFn: input.fetchFn,
      url: input.meta.captureUrl,
      title: input.title,
      metaTitle: input.scraped?.title ?? undefined,
      siteName: input.scraped?.siteName ?? undefined,
      metaDescription: input.scraped?.description ?? undefined,
      contentText: capturePageTextFromBody(input.body),
      screenshotBase64: input.screenshotBase64,
    })
  } catch (cause) {
    if (!isDescriptionRejected(cause)) {
      throw cause
    }
    return null
  }
}

/** The capture's stored screenshot for the AI call; a missing asset reads as absent. */
export async function readCaptureScreenshot(
  meta: CaptureNoteMeta,
  generation: number,
): Promise<string | undefined> {
  if (!meta.captureScreenshot) {
    return undefined
  }
  try {
    return await readAsset(meta.captureScreenshot, generation)
  } catch (cause) {
    if (!isAppError(cause) || cause.kind !== 'notFound') {
      throw cause
    }
    return undefined
  }
}

/** A link-preview image for screenshot-less captures; any failure reads as none. */
export async function fetchLinkPreviewImage(meta: CaptureNoteMeta): Promise<string | null> {
  if (meta.captureScreenshot) {
    return null
  }
  try {
    return await captureLinkPreview(meta.captureUrl)
  } catch {
    return null
  }
}
