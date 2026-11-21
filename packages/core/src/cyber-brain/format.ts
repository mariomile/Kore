/**
 * Pure cyber-brain format helpers, zero I/O and safe for both `@kore/core` and
 * the Cloudflare Worker in `@kore/cloud`. Mirrors `cyber-brain/scripts/core.mjs`
 * (v0.2): transit entries, exclusions, secret patterns, and run records.
 */

export const CYBER_BRAIN_TRANSIT_KINDS = [
  'fact',
  'loop',
  'decision',
  'block',
  'observation',
  'skill',
] as const

export type CyberBrainTransitKind = (typeof CYBER_BRAIN_TRANSIT_KINDS)[number]

/** Secret patterns refused before writing any cyber-brain memory line. */
export const CYBER_BRAIN_SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bsk-[\w-]{20,}/, 'API key (sk-)'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_\w{30,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
]

export interface MemoryExclusion {
  readonly topic: string
  readonly reason: string | null
  readonly since: string | null
}

export interface MemoryTransitEntry {
  readonly path: string
  readonly agent: string
  readonly kind: string
  readonly text: string
  readonly target: string
  readonly source: string | null
  readonly since: string | null
  readonly was: string | null
}

/** Collapse newlines and excess whitespace into one line. */
export function collapseOneLine(value: string): string {
  return value
    .replaceAll(/[\r\n]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/** Return the matched secret label, or null when clean. */
export function findCyberBrainSecret(text: string): string | null {
  for (const [pattern, label] of CYBER_BRAIN_SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return label
    }
  }
  return null
}

const EXCLUSION_META_RE = /^[-*]\s+(.+?)\s*\[([^\]]*)\]\s*$/

/** Parse `System/memory/exclusions.md` body into exclusion entries. */
export function parseMemoryExclusions(body: string): MemoryExclusion[] {
  const entries: MemoryExclusion[] = []
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^[-*]\s+/.test(line)) continue
    const withMeta = EXCLUSION_META_RE.exec(line)
    if (withMeta !== null) {
      const meta: Record<string, string> = {}
      for (const part of withMeta[2]!.split(/;\s*/)) {
        const kv = /^([a-z_]+):\s*(.*)$/.exec(part.trim())
        if (kv !== null) meta[kv[1]!] = kv[2]!.trim()
      }
      const topic = collapseOneLine(withMeta[1]!)
      if (topic !== '') {
        entries.push({
          topic,
          reason: meta['reason'] || null,
          since: meta['since'] || null,
        })
      }
      continue
    }
    const topic = collapseOneLine(line.replace(/^[-*]\s+/, ''))
    if (topic !== '') {
      entries.push({ topic, reason: null, since: null })
    }
  }
  return entries
}

/** Return the first active exclusion matching `text`, or null. */
export function matchMemoryExclusion(
  text: string,
  exclusions: readonly MemoryExclusion[],
): MemoryExclusion | null {
  const haystack = collapseOneLine(text).toLowerCase()
  if (haystack === '') return null
  for (const exclusion of exclusions) {
    const needle = collapseOneLine(exclusion.topic).toLowerCase()
    if (needle.length >= 2 && haystack.includes(needle)) {
      return exclusion
    }
  }
  return null
}

/** Format one transit entry: `- [kind] text -> target [source: ...; since: YYYY-MM-DD; was: ...]`. */
export function formatCyberBrainTransit(input: {
  readonly kind: CyberBrainTransitKind
  readonly text: string
  readonly target?: string
  readonly source: string
  readonly since: string
  readonly replaces?: string
}): string {
  const target = collapseOneLine(input.target ?? '') || '?'
  const was = input.replaces ? `; was: ${collapseOneLine(input.replaces)}` : ''
  return `- [${input.kind}] ${collapseOneLine(input.text)} -> ${target} [source: ${collapseOneLine(input.source)}; since: ${input.since}${was}]`
}

const TRANSIT_LINE_RE = /^\s*-\s+\[([a-z]+)\]\s+(.+?)\s+->\s+(.+?)\s+\[(source:[^\]]*)\]\s*$/

/** Parse all transit lines from one `System/memory/inbox/<agent>/YYYY-MM-DD.md` file. */
export function parseMemoryTransitFile(
  path: string,
  agent: string,
  body: string,
): MemoryTransitEntry[] {
  const entries: MemoryTransitEntry[] = []
  for (const line of body.split(/\r?\n/)) {
    const match = TRANSIT_LINE_RE.exec(line)
    if (match === null) continue
    const meta: Record<string, string> = {}
    for (const part of match[4]!.split(/;\s*/)) {
      const kv = /^([a-z_]+):\s*(.*)$/.exec(part.trim())
      if (kv !== null) meta[kv[1]!] = kv[2]!.trim()
    }
    entries.push({
      path,
      agent,
      kind: match[1]!,
      text: match[2]!.trim(),
      target: match[3]!.trim(),
      source: meta['source'] || null,
      since: meta['since'] || null,
      was: meta['was'] || null,
    })
  }
  return entries
}

/** Format one run-log block appended to `System/runs/YYYY-MM.md`. */
export function formatCyberBrainRunRecord(input: {
  readonly iso: string
  readonly agent: string
  readonly skill: string
  readonly by?: string
  readonly outcome?: 'ok' | 'failed' | 'refused'
  readonly summary: string
  readonly writes: readonly string[]
}): string {
  const summary = collapseOneLine(input.summary).slice(0, 180)
  const lines = [
    `## ${input.iso} ${input.agent} ${input.skill}`,
    `- agent: ${input.agent}`,
    `- skill: ${input.skill}`,
    `- by: ${input.by ?? 'user'}`,
    `- outcome: ${input.outcome ?? 'ok'}`,
    `- summary: ${summary}`,
    ...input.writes.map((write) => `- write: ${write}`),
  ]
  return lines.join('\n')
}
