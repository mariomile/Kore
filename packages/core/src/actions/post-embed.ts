import { fromSyndication } from '@post-embed/exporter/x/syndication'
import type { XPost, YouTubeVideo } from '@post-embed/types'
import { captureOEmbedFetch } from '../graph/commands'
import { xPostId, xSyndicationUrl } from './link-preview-providers'
import { oembedRequestURL } from './oembed'

/**
 * Data for Meowdown's post-embed cards (`![](https://x.com/…/status/…)` and
 * YouTube links). Meowdown's own default resolvers `fetch()` from the
 * webview — X through react-tweet's hosted proxy, YouTube from its oEmbed
 * endpoint — and the app's CSP blocks both, so every card fell back to
 * "This post is unavailable". These read the same answers through the
 * bounded Rust `capture_oembed_fetch` primitive instead, with no third-party
 * proxy in between.
 *
 * Both resolve `undefined` (the card's own "unavailable" state) for links
 * they do not recognize, posts that are gone, and network failures.
 */

/** One settled-or-pending answer per URL for the session; failures are retried. */
function cached<T>(
  load: (url: string) => Promise<T | undefined>,
): (url: string) => Promise<T | undefined> {
  const answers = new Map<string, Promise<T | undefined>>()
  return (url) => {
    const known = answers.get(url)
    if (known !== undefined) {
      return known
    }
    const pending = load(url).then(
      (value) => {
        if (value === undefined) {
          answers.delete(url)
        }
        return value
      },
      (): undefined => {
        answers.delete(url)
      },
    )
    answers.set(url, pending)
    return pending
  }
}

/** The X post behind an embed URL, read from X's syndication endpoint. */
export const resolveXPostEmbed = cached(async (url: string): Promise<XPost | undefined> => {
  const id = xPostId(url)
  if (id === null) {
    return undefined
  }
  const json: unknown = JSON.parse(await captureOEmbedFetch(xSyndicationUrl(id)))
  const result = fromSyndication(json)
  return result.issues === undefined ? result.value : undefined
})

/** The YouTube video behind an embed URL, read from YouTube's oEmbed endpoint. */
export const resolveYouTubeEmbed = cached(
  async (url: string): Promise<YouTubeVideo | undefined> => {
    const request = oembedRequestURL(url)
    if (request === null) {
      return undefined
    }
    const answer: unknown = JSON.parse(await captureOEmbedFetch(request))
    if (typeof answer !== 'object' || answer === null || !('title' in answer)) {
      return undefined
    }
    return { ...(answer as Omit<YouTubeVideo, 'url'>), url }
  },
)
