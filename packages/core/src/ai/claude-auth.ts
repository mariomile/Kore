import { z } from 'zod'
import { agentCliFailureMessage, isAgentCliRuntimeFailure } from './agent-cli-failure'
import { runAgentCliCommand, runAgentCliLogin, type AgentCliAuthStatus } from './agent-cli'

/**
 * Claude account sign-in for the Claude Code provider, driven through the
 * CLI's own `claude auth` commands. Anthropic allows a Claude subscription
 * only through the unmodified `claude` binary with the user's own login, so
 * the app never touches the OAuth flow or the credentials: it starts the
 * CLI's flow, relays the URL the CLI prints, and reads the CLI's status.
 */

/** The subset of `claude auth status --json` the app shows. */
const claudeAuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  email: z.string().nullable().optional(),
  subscriptionType: z.string().nullable().optional(),
})

const SUBSCRIPTION_LABELS: Readonly<Record<string, string>> = {
  pro: 'Claude Pro',
  max: 'Claude Max',
  team: 'Claude Team',
  enterprise: 'Claude Enterprise',
}

/** The one status line for a parsed `claude auth status`. */
function claudeAuthDetail(status: z.infer<typeof claudeAuthStatusSchema>): string {
  if (!status.loggedIn) {
    return 'Not signed in'
  }
  if (status.authMethod === 'api_key') {
    return 'Claude Code uses an API key, not your Claude subscription.'
  }
  const plan = SUBSCRIPTION_LABELS[status.subscriptionType ?? ''] ?? null
  const email = status.email ?? null
  if (email !== null && plan !== null) {
    return `Signed in as ${email} · ${plan}`
  }
  if (email !== null) {
    return `Signed in as ${email}`
  }
  return plan === null ? 'Signed in with your Claude account.' : `Signed in · ${plan}`
}

/** Whether the Claude Code CLI holds a login (`claude auth status --json`). */
export async function claudeLoginStatus(): Promise<AgentCliAuthStatus> {
  const result = await runAgentCliCommand({ binary: 'claude', args: ['auth', 'status', '--json'] })
  if (result.code === null || isAgentCliRuntimeFailure(result)) {
    throw new Error(agentCliFailureMessage(result) ?? 'could not run Claude Code')
  }
  let json: unknown = null
  try {
    json = JSON.parse(result.lines.join('\n'))
  } catch {
    json = null
  }
  const parsed = claudeAuthStatusSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error('this Claude Code version can’t report its sign-in, update it')
  }
  return { loggedIn: parsed.data.loggedIn, detail: claudeAuthDetail(parsed.data) }
}

/** The sign-in URL the CLI prints under "If the browser didn't open, visit:". */
const CLAUDE_AUTH_URL_RE = /https:\/\/(?:claude\.ai|claude\.com|platform\.claude\.com)\/\S*oauth\S*/

/**
 * Run the Claude sign-in flow (`claude auth login --claudeai`, see
 * `runAgentCliLogin`). The CLI opens the browser itself; the printed URL is
 * relayed as a fallback.
 */
export async function runClaudeLogin(options: {
  onAuthUrl: (url: string) => void
  signal?: AbortSignal | undefined
}): Promise<{ success: boolean; message: string | null }> {
  return await runAgentCliLogin({
    binary: 'claude',
    args: ['auth', 'login', '--claudeai'],
    authUrlPattern: CLAUDE_AUTH_URL_RE,
    ...options,
  })
}

/** Drop the CLI's stored Claude login (`claude auth logout`). */
export async function claudeLogout(): Promise<void> {
  await runAgentCliCommand({ binary: 'claude', args: ['auth', 'logout'] })
}

/** The install command the app points to when `claude` is missing. */
export const CLAUDE_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'

/** What chat shows when Claude Code has no usable login. */
export const CLAUDE_SIGNED_OUT_MESSAGE =
  'Claude Code isn’t signed in, or its login expired. Sign in from Settings → AI, or run `claude auth login` in Terminal.'

/** What chat shows when the `claude` binary can't be found. */
export const CLAUDE_MISSING_MESSAGE = `Claude Code isn’t installed. Install it with \`${CLAUDE_INSTALL_COMMAND}\` in Terminal, then sign in from Settings → AI.`

/**
 * Chat copy for a Claude Code error. The CLI's own auth errors all end in
 * "run /login" (a slash command of its interactive UI, meaningless inside
 * Kore), and a missing binary surfaces as the native "was not found": both
 * become a pointer to what fixes them. Anything else passes through.
 */
export function claudeCliErrorMessage(raw: string): string {
  if (/\brun \/login\b/i.test(raw)) {
    return CLAUDE_SIGNED_OUT_MESSAGE
  }
  if (/\(`claude`\) was not found/.test(raw)) {
    return CLAUDE_MISSING_MESSAGE
  }
  return raw
}
