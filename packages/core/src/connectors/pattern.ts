import { KoreError } from '../errors'
import { cleanStem } from './markdown'
import type { Connector } from './types'

/**
 * Where a connector note lands inside its folder is the user's choice: a
 * path pattern such as `{title}`, `{category}/{title}` or
 * `{month}/{title}, {date}`. `/` separates subfolders, `{name}` inserts one
 * of the connector's fields, and every segment is cleaned to a safe
 * filename, so no field value can escape the folder.
 */

/** Shared only with `matchAll`/`replaceAll`, which never read its `lastIndex`. */
const TOKEN_RE = /\{([a-z]+)\}/g

/** A rendered pattern: subfolders inside the connector folder, and the stem. */
export interface NotePlacement {
  readonly dir: string
  readonly stem: string
}

/**
 * Validate a user-entered pattern for `connector`, returning it trimmed;
 * throws a `parse` error naming the problem.
 */
export function normalizeConnectorPattern(pattern: string, connector: Connector): string {
  const trimmed = pattern.trim().replaceAll(/^\/+|\/+$/g, '')
  if (trimmed === '') {
    throw new KoreError('parse', 'The file name pattern can’t be empty')
  }
  const tokens = Array.from(trimmed.matchAll(TOKEN_RE), (match) => match[1] ?? '')
  for (const name of tokens) {
    if (!connector.patternFields.includes(name)) {
      throw new KoreError(
        'parse',
        `{${name}} isn’t a ${connector.label} field; use ${connector.patternFields.map((field) => `{${field}}`).join(', ')}`,
      )
    }
  }
  if (tokens.length === 0) {
    throw new KoreError(
      'parse',
      'Use at least one field, like {title}, or every note gets the same name',
    )
  }
  return trimmed
}

/** Render `pattern` with `fields`; a segment that renders empty is dropped. */
export function renderNotePlacement(
  pattern: string,
  fields: Readonly<Record<string, string>>,
  fallbackStem: string,
): NotePlacement {
  const segments = pattern.split('/').map((segment) =>
    // An empty field leaves its separator behind ("{author} - {title}").
    cleanStem(segment.replaceAll(TOKEN_RE, (_, name: string) => fields[name] ?? '')).replaceAll(
      /^[\s,;–—_-]+|[\s,;–—_-]+$/g,
      '',
    ),
  )
  const stem = segments.pop() || fallbackStem
  return { dir: segments.filter((segment) => segment !== '').join('/'), stem }
}

/** Parse a comma-separated tag list as typed in settings (`#` optional). */
export function parseConnectorTags(text: string): string[] {
  const tags = text
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, '').replaceAll(/\s+/g, '-'))
    .filter((tag) => tag !== '')
  return Array.from(new Set(tags))
}

/**
 * Where a typical item would land with this folder and pattern, as a
 * graph-relative path: the settings preview. An unusable pattern previews
 * the connector's default.
 */
export function connectorPathPreview(
  connector: Connector,
  folder: string,
  pattern: string,
): string {
  let usable = connector.defaultPattern
  try {
    usable = normalizeConnectorPattern(pattern, connector)
  } catch {
    // Keep the default: the field shows its own error.
  }
  const { dir, stem } = renderNotePlacement(usable, connector.exampleFields, connector.label)
  const cleanFolder = folder.trim().replaceAll(/^\/+|\/+$/g, '')
  return [cleanFolder, dir, `${stem}.md`].filter((part) => part !== '').join('/')
}

/**
 * The daily-note heading as typed in settings, stored form: leading `#`s
 * dropped, and `null` (the connector's default) when empty or the default.
 */
export function normalizeDailyHeading(text: string, connector: Connector): string | null {
  const heading = text.trim().replace(/^#+\s*/, '')
  return heading === '' || heading === connector.dailyHeading ? null : heading
}
