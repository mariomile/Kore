import type { AgentCliCommandResult } from './agent-cli'

/**
 * Whether the CLI never actually ran — missing interpreter (`env: node:`),
 * or the POSIX "command not found" exit. Distinct from `codex login status`
 * exiting 1 because the user is signed out.
 */
export function isAgentCliRuntimeFailure(result: AgentCliCommandResult): boolean {
  if (result.code === 127) {
    return true
  }
  const text = [result.failure, ...result.lines].join('\n')
  return /env: [^:\n]+: No such file or directory/i.test(text)
}

/**
 * Settings-dialog copy for a CLI spawn failure. Auth and protocol errors
 * pass through; a missing Node interpreter becomes an actionable line.
 */
export function agentCliFailureMessage(result: AgentCliCommandResult): string | null {
  const raw = result.failure ?? result.lines.at(-1)?.trim() ?? null
  if (raw === null || raw === '') {
    return null
  }
  if (/env: node: No such file or directory/i.test(raw) || /(?:^|\b)node: not found\b/i.test(raw)) {
    return 'The CLI needs Node.js on your PATH. Install Node and retry.'
  }
  return raw
}
