import { wikiLinkSafe } from '../markdown/edit'
import { splitFrontmatter } from '../markdown/frontmatter'
import type { ResourceKind } from './resource-collection'

/**
 * The Markdown body of a resource card: written once by the collector, and
 * retitled in place when a link's page names itself. Pure, so both callers
 * share one template.
 */

/** The heading a card of each kind falls back to, and its collection's title. */
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  link: 'Links',
  image: 'Images',
  pdf: 'PDFs',
  file: 'Files',
}

/** A card's H1 and link label for `title`, as the card writes them. */
function cardTitle(kind: ResourceKind, title: string): { heading: string; label: string } {
  const heading = wikiLinkSafe(title).replaceAll(/[\r\n]/g, ' ') || RESOURCE_LABELS[kind]
  return { heading, label: heading.replaceAll(/[[\]]/g, '') }
}

export function cardBody(kind: ResourceKind, title: string, target: string): string {
  const { heading, label } = cardTitle(kind, title)
  const destination = target.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29')
  return `# ${heading}\n\n#${kind}\n\n${kind === 'image' ? '!' : ''}[${label}](${destination})\n`
}

/**
 * Swap a link card's placeholder title (`from`, what the card was created
 * with) for `to`, in the H1 and the link label, as {@link cardBody} wrote
 * them. A card whose H1 the user already changed comes back unchanged, and
 * so does one when `to` has nothing printable.
 */
export function retitleLinkCard(source: string, from: string, to: string): string {
  if (wikiLinkSafe(to) === '') return source
  const old = cardTitle('link', from)
  const next = cardTitle('link', to)
  const { bodyOffset } = splitFrontmatter(source)
  const body = source.slice(bodyOffset)
  if (!body.startsWith(`# ${old.heading}\n`)) return source
  return (
    source.slice(0, bodyOffset) +
    body
      .replace(`# ${old.heading}\n`, `# ${next.heading}\n`)
      .replace(`[${old.label}](`, `[${next.label}](`)
  )
}
