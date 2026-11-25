import {
  CLAUDE_INSTALL_COMMAND,
  claudeLoginStatus,
  claudeLogout,
  codexLoginStatus,
  codexLogout,
  runClaudeLogin,
  runCodexLogin,
  type AgentCliAuthStatus,
} from '@kore/core'

/**
 * One subscription CLI's sign-in, as the settings UI drives it. The flow
 * itself, and the credentials, belong to the CLI; the app only starts it,
 * relays the URL it prints and reads its status.
 */
export interface CliSignInFlow {
  /** React Query key for the status probe. */
  readonly queryKey: readonly string[]
  /** The CLI as people know it ("Claude Code"). */
  readonly cliName: string
  /** The account the subscription belongs to ("Claude", "ChatGPT"). */
  readonly accountName: string
  /** What installs the CLI, shown when it can't be run. */
  readonly installCommand: string
  /**
   * The CLI opens the browser on its own: the app keeps the printed URL as
   * a fallback instead of opening a second tab.
   */
  readonly cliOpensBrowser: boolean
  readonly status: () => Promise<AgentCliAuthStatus>
  readonly login: (options: {
    onAuthUrl: (url: string) => void
    signal?: AbortSignal | undefined
  }) => Promise<{ success: boolean; message: string | null }>
  readonly logout: () => Promise<void>
}

export const CLAUDE_SIGN_IN: CliSignInFlow = {
  queryKey: ['claude-auth-status'],
  cliName: 'Claude Code',
  accountName: 'Claude',
  installCommand: CLAUDE_INSTALL_COMMAND,
  cliOpensBrowser: true,
  status: claudeLoginStatus,
  login: runClaudeLogin,
  logout: claudeLogout,
}

export const CODEX_SIGN_IN: CliSignInFlow = {
  queryKey: ['codex-auth-status'],
  cliName: 'Codex',
  accountName: 'ChatGPT',
  installCommand: 'npm install -g @openai/codex',
  cliOpensBrowser: false,
  status: codexLoginStatus,
  login: runCodexLogin,
  logout: codexLogout,
}

/** The in-app sign-in for each subscription provider that has one. */
export function cliSignInFlow(providerId: string): CliSignInFlow | null {
  if (providerId === 'claude-cli') {
    return CLAUDE_SIGN_IN
  }
  if (providerId === 'codex-cli') {
    return CODEX_SIGN_IN
  }
  return null
}
