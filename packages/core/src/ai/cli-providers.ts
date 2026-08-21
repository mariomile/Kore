import type { AiProviderId } from '../settings/schema'
import type { ChatStreamEvent } from './chat/stream-chat'
import { checkClaudeCli, streamClaudeCliChat, type StreamCliChatOptions } from './claude-cli'
import { checkCodexCli, streamCodexCliChat } from './codex-cli'
import { checkCursorCli, streamCursorCliChat } from './cursor-cli'

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

/** Verify the provider's CLI is installed; resolves with its version. */
export async function checkCliAgentProvider(id: CliAgentProviderId): Promise<string> {
  switch (id) {
    case 'claude-cli':
      return await checkClaudeCli()
    case 'codex-cli':
      return await checkCodexCli()
    case 'cursor-cli':
      return await checkCursorCli()
  }
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
