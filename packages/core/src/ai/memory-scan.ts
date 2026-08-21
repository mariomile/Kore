/**
 * The memory-write scanner: the anti-injection rules live in every prompt,
 * but prompts only *ask* — nothing verified what actually lands in the
 * memory files agents write. This scans memory content for the two things
 * that must never be stored: text that reads like instructions to a future
 * agent session (a durable prompt injection — memory is injected into every
 * later turn, so a planted directive outlives the note that carried it) and
 * secrets (keys, tokens, credentials — memory files ride into cloud
 * prompts).
 *
 * Heuristics, deliberately: a scanner that flags for review, not a filter
 * that silently rewrites. Findings surface in the approval UI and as a
 * notice on the turn that wrote them; the user stays the judge.
 */

export interface MemoryScanFinding {
  kind: 'injection' | 'secret'
  /** 1-based line number in the scanned content. */
  line: number
  /** The offending line, trimmed and capped for display. */
  excerpt: string
  reason: string
}

interface Rule {
  kind: MemoryScanFinding['kind']
  pattern: RegExp
  reason: string
}

const RULES: Rule[] = [
  // --- durable prompt injection ---
  {
    kind: 'injection',
    pattern:
      /\b(?:ignore|disregard|forget)\b[^.\n]{1,40}\b(?:previous|prior|earlier|above|all)\b[^.\n]{1,30}\b(?:instructions|rules|prompts?)\b/i,
    reason: 'tells a future agent session to ignore its instructions',
  },
  {
    kind: 'injection',
    pattern:
      /\b(?:reveal|expose|print|leak)\b[^.\n]{1,40}\b(?:system prompt|instructions|memory files?)\b/i,
    reason: 'tells the agent to reveal its instructions or memory',
  },
  {
    kind: 'injection',
    pattern:
      /\b(?:without|do not|don['’]t|never)\b[^.\n]{1,30}\b(?:tell(?:ing)?|inform(?:ing)?|ask(?:ing)?|mention(?:ing)?)\b[^.\n]{1,20}\bthe user\b/i,
    reason: 'tells the agent to act behind the user’s back',
  },
  {
    kind: 'injection',
    pattern: /\b(?:you must|from now on,? (?:you|always)|new instructions?:|always obey)\b/i,
    reason: 'reads like standing orders to a future agent session',
  },
  {
    kind: 'injection',
    pattern: /\b(?:send|upload|post|forward|exfiltrate)\b[^.\n]{1,50}\b(?:to|at)\s+https?:\/\//i,
    reason: 'tells the agent to send content to an external address',
  },
  // --- secrets ---
  {
    kind: 'secret',
    pattern: /\bsk-[\w-]{16,}\b/,
    reason: 'looks like an API secret key',
  },
  {
    kind: 'secret',
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_\w{16,}\b/,
    reason: 'looks like a GitHub token',
  },
  {
    kind: 'secret',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    reason: 'looks like an AWS access key id',
  },
  {
    kind: 'secret',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    reason: 'looks like a Slack token',
  },
  {
    kind: 'secret',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    reason: 'contains a private key block',
  },
  {
    kind: 'secret',
    pattern: /\beyJ[\w-]{14,}\.[\w-]{8,}\.[\w-]{8,}\b/,
    reason: 'looks like a signed JWT',
  },
  {
    kind: 'secret',
    pattern:
      /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[^\s"']{8,}/i,
    reason: 'looks like a stored credential',
  },
]

const EXCERPT_MAX = 120

/** Scan one memory file's content. Empty result = nothing suspicious. */
export function scanMemoryContent(content: string): MemoryScanFinding[] {
  const findings: MemoryScanFinding[] = []
  const lines = content.split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === '') {
      continue
    }
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          kind: rule.kind,
          line: index + 1,
          excerpt: line.length > EXCERPT_MAX ? `${line.slice(0, EXCERPT_MAX)}…` : line,
          reason: rule.reason,
        })
        break // one finding per line keeps the report readable
      }
    }
  }
  return findings
}

/** Whether a graph path is one of the agent memory surfaces worth scanning. */
export function isMemoryPath(path: string): boolean {
  return (
    path === 'agents/user.md' ||
    path.startsWith('agents/memory/') ||
    /^agents\/[^/]+\/(?:memory|soul)\.md$/.test(path)
  )
}

/** Findings per file kept short — the warning is a pointer, not a report. */
const MAX_FINDINGS_PER_FILE = 5

/**
 * Scan the memory files among a run's changed paths and format one warning
 * line per finding. Used at the end of every edit-mode run (chat turns and
 * routines alike): the run's ledger says which files it touched, this says
 * whether anything that landed in memory deserves the user's eyes.
 */
export async function scanChangedMemoryPaths(
  changedPaths: string[],
  readNoteFn: (path: string) => Promise<string>,
): Promise<string[]> {
  const warnings: string[] = []
  for (const path of changedPaths) {
    if (!isMemoryPath(path)) {
      continue
    }
    let content: string
    try {
      content = await readNoteFn(path)
    } catch {
      continue
    }
    for (const finding of scanMemoryContent(content).slice(0, MAX_FINDINGS_PER_FILE)) {
      warnings.push(`${path}:${finding.line} — ${finding.reason}: “${finding.excerpt}”`)
    }
  }
  return warnings
}
