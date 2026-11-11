import { toAppError } from '../errors'
import { captureMetaFetch, readNote, writeNote } from '../graph/commands'
import { appendHeadingSection } from '../markdown/append-section'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import type { XPost } from '@post-embed/types'
import { extractArticleFromHtml } from './article-text'
import { isLinkedInUrl, xPostId } from './link-preview-providers'
import { youtubeVideoId } from './oembed'
import { retitleLinkCard } from './resource-card'
import { resolveXPostEmbed } from './post-embed'
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

async function youtubeTranscript(videoId: string): Promise<LinkText | null> {
  const transcript = await fetchYouTubeTranscript(videoId)
  if (transcript === null) return null
  return {
    kind: 'transcript',
    title: transcript.title,
    markdown: bounded(`*Captions: ${transcript.trackName}*\n\n${transcript.markdown}`),
  }
}

async function articleText(url: string): Promise<LinkText | null> {
  const article = extractArticleFromHtml(await captureMetaFetch(url), url)
  if (article.markdown.length < MIN_ARTICLE_CHARS) return null
  return { kind: 'article', title: article.title, markdown: bounded(article.markdown) }
}

/**
 * The sites whose links keep something other than the page's article text,
 * checked in order: `text` is `null` for a site with nothing to fetch. X
 * posts keep their words in the embed snapshot, and LinkedIn answers a
 * sign-in wall. Any other link keeps its article.
 */
const LINK_TEXT_SITES: readonly {
  readonly matches: (url: URL) => boolean
  readonly text: ((url: URL) => Promise<LinkText | null>) | null
}[] = [
  { matches: (url) => xPostId(url.href) !== null, text: null },
  { matches: (url) => isLinkedInUrl(url.href), text: null },
  {
    matches: (url) => youtubeVideoId(url) !== null,
    text: async (url) => {
      const videoId = youtubeVideoId(url)
      return videoId === null ? null : await youtubeTranscript(videoId)
    },
  },
]

/**
 * Fetch the text one link should keep, or `null` when there is none worth
 * keeping (see {@link LINK_TEXT_SITES}). Propagates the transport's typed
 * errors (`network` is transient).
 */
export async function fetchLinkText(url: string): Promise<LinkText | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const site = LINK_TEXT_SITES.find((candidate) => candidate.matches(parsed))
  if (site === undefined) return await articleText(url)
  return site.text === null ? null : await site.text(parsed)
}

const SAVED_TEXT_HEADING = new RegExp(
  `^## (?:${PAGE_TEXT_HEADING}|${TRANSCRIPT_HEADING})[ \t]*$`,
  'm',
)

/**
 * Swap the card's placeholder title (the link's host, which a card starts
 * with) for the page's own. A title the user already changed stays.
 */
function retitled(source: string, url: string, title: string | null): string {
  return title === null ? source : retitleLinkCard(source, new URL(url).hostname, title)
}

/** How much of a post's text an X card's title keeps before it trails off. */
const X_TITLE_TEXT_CHARS = 60

/**
 * An X post's card title: its author, then the start of what they wrote, cut
 * on a word — `Leo: Shipped my first agent-native app…`. A card would
 * otherwise keep its placeholder (`x.com`) for good, since an X post keeps
 * its words in the embed snapshot and has no page text to save.
 */
export function xPostTitle(post: XPost): string | null {
  const author = post.author.name.trim() || `@${post.author.handle}`
  const words = post.body
    .map((segment) => segment.text)
    .join('')
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (words === '') return author === '@' ? null : author
  if (words.length <= X_TITLE_TEXT_CHARS) return `${author}: ${words}`
  const cut = words.lastIndexOf(' ', X_TITLE_TEXT_CHARS)
  const start = words.slice(0, cut > X_TITLE_TEXT_CHARS / 2 ? cut : X_TITLE_TEXT_CHARS)
  return `${author}: ${start.replace(/[\s.,;:!?-]+$/, '')}…`
}

/** How many tried cards the session remembers; the oldest is forgotten first. */
const MAX_ATTEMPTED = 500

/** Cards already tried this session, so a dead page is not refetched on every paste. */
const attempted = new Set<string>()

function markAttempted(key: string): void {
  attempted.add(key)
  if (attempted.size > MAX_ATTEMPTED) {
    const oldest = attempted.values().next().value
    if (oldest !== undefined) attempted.delete(oldest)
  }
}

/**
 * Save the text behind one `#link` card into the card, once. Skips private
 * cards, cards that already keep text, and cards edited while the page was
 * fetched. A transient network failure leaves the card to be tried on the
 * next paste. Resolves `true` when the card was written.
 */
export async function saveLinkText(cardPath: string, generation: number): Promise<boolean> {
  const key = `${generation}:${cardPath}`
  if (attempted.has(key)) return false
  markAttempted(key)
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
  if (xPostId(url) !== null) {
    return await saveXPostTitle(cardPath, generation, key, source, url)
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

/**
 * Give an X post's card the post's title in place of its host placeholder.
 * The post is read the way its embed card reads it, so nothing new leaves
 * the app. A title the user already changed stays.
 */
async function saveXPostTitle(
  cardPath: string,
  generation: number,
  key: string,
  source: string,
  url: string,
): Promise<boolean> {
  let post: XPost | undefined
  try {
    post = await resolveXPostEmbed(url)
  } catch {
    post = undefined
  }
  if (post === undefined) {
    // A gone post and a dropped connection look alike here: try again on a later paste.
    attempted.delete(key)
    return false
  }
  const current = await readNote(cardPath, generation)
  if (current !== source) return false
  const next = retitled(current, url, xPostTitle(post))
  if (next === current) return false
  await writeNote(cardPath, next, generation)
  return true
}
