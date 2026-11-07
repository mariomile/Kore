import { toAppError } from '../errors'
import { captureMetaFetch, readNote, writeNote } from '../graph/commands'
import { appendHeadingSection } from '../markdown/append-section'
import { wikiLinkSafe } from '../markdown/edit'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { extractArticleFromHtml } from './article-text'
import { isLinkedInUrl, xPostId } from './link-preview-providers'
import { youtubeVideoId } from './oembed'
import { fetchYouTubeTranscript } from './youtube-transcript'

/**
 * The words behind a pasted link, kept in its `#link` card: an article's
 * text, or a video's transcript. Saved once, as plain Markdown under its own
 * section, so search and agents find the content and it outlives the page.
 *
 * Fetching is an outbound request to the linked host, so a private card (one
 * collected from a `private: true` note) is never fetched.
 */

/** The section an article's text lives under; the same one extension captures use. */
export const PAGE_TEXT_HEADING = 'Page Text'
/** The section a video's transcript lives under. */
export const TRANSCRIPT_HEADING = 'Transcript'

/** Pages shorter than this are a wall (sign-in, "enable JavaScript"), not an article. */
const MIN_ARTICLE_CHARS = 200
/** Bounds what one card keeps; a book-length page is cut at a paragraph. */
const MAX_TEXT_CHARS = 200_000

export interface LinkText {
  readonly kind: 'article' | 'transcript'
  /** The page's or video's own title, when it has one. */
  readonly title: string | null
  /** The Markdown the card keeps under its section. */
  readonly markdown: string
}

function bounded(markdown: string): string {
  if (markdown.length <= MAX_TEXT_CHARS) return markdown
  const cut = markdown.lastIndexOf('\n\n', MAX_TEXT_CHARS)
  return `${markdown.slice(0, cut > 0 ? cut : MAX_TEXT_CHARS)}\n\n*Text cut at ${MAX_TEXT_CHARS} characters.*`
}

/**
 * Fetch the text one link should keep, or `null` when there is none worth
 * keeping. X posts keep theirs in the embed snapshot, and LinkedIn answers
 * a sign-in wall, so neither is fetched. Propagates the transport's typed
 * errors (`network` is transient).
 */
export async function fetchLinkText(url: string): Promise<LinkText | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (xPostId(url) !== null || isLinkedInUrl(url)) return null
  const videoId = youtubeVideoId(parsed)
  if (videoId !== null) {
    const transcript = await fetchYouTubeTranscript(videoId)
    if (transcript === null) return null
    return {
      kind: 'transcript',
      title: transcript.title,
      markdown: bounded(`*Captions: ${transcript.trackName}*\n\n${transcript.markdown}`),
    }
  }
  const article = extractArticleFromHtml(await captureMetaFetch(url), url)
  if (article.markdown.length < MIN_ARTICLE_CHARS) return null
  return { kind: 'article', title: article.title, markdown: bounded(article.markdown) }
}

const SAVED_TEXT_HEADING = new RegExp(
  `^## (?:${PAGE_TEXT_HEADING}|${TRANSCRIPT_HEADING})[ \t]*$`,
  'm',
)

/**
 * Swap the card's placeholder title (the link's host, which a card starts
 * with) for the page's own, in the H1 and the link label. A title the user
 * already changed stays.
 */
function retitled(source: string, url: string, title: string | null): string {
  const placeholder = wikiLinkSafe(new URL(url).hostname)
  const safeTitle = title === null ? '' : wikiLinkSafe(title)
  if (safeTitle === '') return source
  const { bodyOffset } = splitFrontmatter(source)
  const head = source.slice(0, bodyOffset)
  const body = source.slice(bodyOffset)
  if (!body.startsWith(`# ${placeholder}\n`)) return source
  const label = safeTitle.replaceAll(/[[\]]/g, '')
  return (
    head +
    body
      .replace(`# ${placeholder}\n`, `# ${safeTitle}\n`)
      .replace(`[${placeholder}](`, `[${label}](`)
  )
}

/** Cards already tried this session, so a dead page is not refetched on every paste. */
const attempted = new Set<string>()

/**
 * Save the text behind one `#link` card into the card, once. Skips private
 * cards, cards that already keep text, and cards edited while the page was
 * fetched. A transient network failure leaves the card to be tried on the
 * next paste. Resolves `true` when the card was written.
 */
export async function saveLinkText(cardPath: string, generation: number): Promise<boolean> {
  const key = `${generation}:${cardPath}`
  if (attempted.has(key)) return false
  attempted.add(key)
  const source = await readNote(cardPath, generation)
  const { raw, body } = splitFrontmatter(source)
  const frontmatter = parseFrontmatter(raw)
  const url = frontmatter.data['url']
  if (
    frontmatter.warning !== undefined ||
    frontmatter.data.private === true ||
    typeof url !== 'string' ||
    SAVED_TEXT_HEADING.test(body)
  ) {
    return false
  }
  let text: LinkText | null
  try {
    text = await fetchLinkText(url)
  } catch (cause) {
    if (toAppError(cause).kind === 'network') attempted.delete(key)
    return false
  }
  if (text === null) return false
  const current = await readNote(cardPath, generation)
  if (current !== source) return false
  const heading = text.kind === 'transcript' ? TRANSCRIPT_HEADING : PAGE_TEXT_HEADING
  await writeNote(
    cardPath,
    appendHeadingSection(retitled(current, url, text.title), heading, text.markdown),
    generation,
  )
  return true
}
