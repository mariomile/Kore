/**
 * Progressive-disclosure memory digests (bb's catalog model): instead of
 * injecting every memory file whole up to a cap — every turn paying for all
 * of it whether the question needs it or not — a file that outgrows its
 * budget contributes a deterministic *skeleton*: its headings, the first
 * line under each, and a count of what was left out. The prompt then points
 * the agent at the file itself for details (read_notes / the CLI's Read),
 * so depth is paid for only when a turn actually needs it.
 *
 * Deterministic on purpose: no model call, no cache, same input → same
 * digest — the prompt stays reproducible and testable.
 */

/** A digested file body: complete, or a skeleton of a larger file. */
export interface MemoryDigest {
  text: string
  /** True when `text` is a summary skeleton, not the whole body. */
  summarized: boolean
}

const HEADING = /^#{1,6}\s/

/**
 * Digest a curated memory file (facts, profiles, working memory): whole
 * while it fits the budget; past it, headings plus the first content line
 * under each, with elision counts — enough shape to know what to read.
 */
export function memoryDigest(body: string, budget: number): MemoryDigest {
  if (body.length <= budget) {
    return { text: body, summarized: false }
  }
  const kept: string[] = []
  let elided = 0
  const flushElided = (): void => {
    if (elided > 0) {
      kept.push(`  … +${elided} more line${elided === 1 ? '' : 's'}`)
      elided = 0
    }
  }
  // Take the first content line of the preamble and of every section.
  let sectionLineTaken = false
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    if (HEADING.test(trimmed)) {
      flushElided()
      kept.push(trimmed)
      sectionLineTaken = false
      continue
    }
    if (!sectionLineTaken) {
      kept.push(line.trimEnd())
      sectionLineTaken = true
    } else {
      elided += 1
    }
  }
  flushElided()
  const text = kept.join('\n')
  return { text: text.length > budget ? text.slice(0, budget) : text, summarized: true }
}

/**
 * Digest an append-only journal: recency wins, so keep whole trailing `##`
 * entries while they fit the budget. When even the newest entry alone is
 * over budget, its tail is kept — the newest lines are the point.
 */
export function journalTailDigest(body: string, budget: number): MemoryDigest {
  if (body.length <= budget) {
    return { text: body, summarized: false }
  }
  const lines = body.split('\n')
  // Section starts: every `## ` heading (the per-session entry marker).
  const starts: number[] = []
  for (const [index, line] of lines.entries()) {
    if (/^##\s/.test(line.trim())) {
      starts.push(index)
    }
  }
  for (const start of starts) {
    const tail = lines.slice(start).join('\n').trim()
    if (tail.length <= budget) {
      return { text: tail, summarized: true }
    }
  }
  return { text: body.slice(-budget), summarized: true }
}
