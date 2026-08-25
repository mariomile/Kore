import { splitFrontmatter } from '../markdown/frontmatter'

/**
 * The pending-memory queue (see `AGENT_PENDING_MEMORY_PATH` in
 * `./agent-profiles`): parsing the staged proposal sections agents append
 * when memory writes need the user's approval, and the write-back that
 * removes one proposal once it is applied or discarded.
 */

/** One staged memory write awaiting approval. */
export interface PendingMemoryProposal {
  /** The exact heading line (the proposal's identity in the file). */
  heading: string
  /** Target file the proposal wants to append to. */
  target: string
  /** The proposal's body lines (what approval appends). */
  body: string
}

const PENDING_HEADING_RE = /^##\s+(.*?)→\s*(\S+)\s*$/

/** Parse the pending-memory file into its proposal sections. */
export function parsePendingMemory(source: string): PendingMemoryProposal[] {
  const body = splitFrontmatter(source).body
  const proposals: PendingMemoryProposal[] = []
  let current: { heading: string; target: string; lines: string[] } | null = null
  for (const line of body.split('\n')) {
    const match = PENDING_HEADING_RE.exec(line.trim())
    if (match !== null) {
      if (current !== null) {
        proposals.push(finishProposal(current))
      }
      current = { heading: line.trim(), target: match[2] ?? '', lines: [] }
      continue
    }
    current?.lines.push(line)
  }
  if (current !== null) {
    proposals.push(finishProposal(current))
  }
  return proposals.filter((proposal) => proposal.target !== '' && proposal.body !== '')
}

function finishProposal(section: {
  heading: string
  target: string
  lines: string[]
}): PendingMemoryProposal {
  return {
    heading: section.heading,
    target: section.target,
    body: section.lines.join('\n').trim(),
  }
}

/**
 * `source` with exactly one proposal section removed — the **first** whose
 * heading line matches — the write-back for both approve and discard.
 * First-only matters: agents are told to head proposals with date + agent +
 * target, so two same-day proposals to one target share a heading, and
 * removing every match would silently discard a proposal that was never
 * applied. Approval separately appends the proposal's body to its target.
 */
export function withoutPendingProposal(source: string, heading: string): string {
  const lines = source.split('\n')
  const result: string[] = []
  let skipping = false
  let removed = false
  for (const line of lines) {
    const isHeading = PENDING_HEADING_RE.test(line.trim())
    if (skipping && isHeading) {
      skipping = false
    }
    if (!skipping && !removed && line.trim() === heading) {
      skipping = true
      removed = true
      continue
    }
    if (!skipping) {
      result.push(line)
    }
  }
  return result.join('\n').replaceAll(/\n{3,}/g, '\n\n')
}
