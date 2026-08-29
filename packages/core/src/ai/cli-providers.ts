import type { AiProviderId } from '../settings/schema'
import type { ChatStreamEvent } from './chat/stream-chat'
import { checkAgentCli, type AgentCliBinary } from './agent-cli'
import { streamClaudeCliChat, type StreamCliChatOptions } from './claude-cli'
import { streamCodexCliChat } from './codex-cli'
import { streamCursorCliChat } from './cursor-cli'

/**
 * The "subscription" AI providers — chat engines backed by a locally
 * installed coding-agent CLI instead of a keyed provider API. One dispatch
 * seam so hosts branch on a single predicate rather than enumerating the
 * CLI-backed ids at every call site.
 */

/** Providers whose chat runs through a local CLI (no API key). */
export type CliAgentProviderId = 'claude-cli' | 'codex-cli' | 'cursor-cli'

export function isCliAgentProvider(id: AiProviderId): id is CliAgentProviderId {
  return id === 'claude-cli' || id === 'codex-cli' || id === 'cursor-cli'
}

/**
 * Whether the engine's write path is verified enough to join edit mode and
 * automations. Cursor stays read-only until its write grants are proven
 * against the real CLI — chat and grounding work, the vault stays untouched.
 */
export function cliProviderSupportsEdits(id: CliAgentProviderId): boolean {
  return id === 'claude-cli' || id === 'codex-cli'
}

/**
 * How the engine takes a message while a turn is streaming (bb's steer-mode
 * capability): 'inject' delivers it into the live session — context
 * preserved, no cancel-and-relaunch — while 'queue' engines can only wait
 * for the turn to settle. Claude Code injects via its stream-json input
 * session; Codex injects via app-server `turn/steer`. Cursor stays
 * queue-only: its ACP `session/prompt` is blocking until the turn ends.
 */
export function cliProviderSteerMode(id: CliAgentProviderId): 'inject' | 'queue' {
  return id === 'cursor-cli' ? 'queue' : 'inject'
}

/** The binary each provider's CLI check runs. */
const CLI_AGENT_BINARY: Record<CliAgentProviderId, AgentCliBinary> = {
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'cursor-cli': 'cursor-agent',
}

/** Verify the provider's CLI is installed; resolves with its version. */
export async function checkCliAgentProvider(id: CliAgentProviderId): Promise<string> {
  return await checkAgentCli(CLI_AGENT_BINARY[id])
}

/** Run one chat turn through the provider's CLI engine. */
export function streamCliAgentChat(
  id: CliAgentProviderId,
  options: StreamCliChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  switch (id) {
    case 'claude-cli':
      return streamClaudeCliChat(options)
    case 'codex-cli':
      return streamCodexCliChat(options)
    case 'cursor-cli':
      // Edit mode never reaches Cursor (see cliProviderSupportsEdits); the
      // engine itself also runs --mode ask with writes denied.
      return streamCursorCliChat(options)
  }
}
