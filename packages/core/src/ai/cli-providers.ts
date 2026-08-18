import type { AiProviderId } from '../settings/schema'
import type { ChatStreamEvent } from './chat/stream-chat'
import { checkClaudeCli, streamClaudeCliChat, type StreamCliChatOptions } from './claude-cli'
import { checkCodexCli, streamCodexCliChat } from './codex-cli'

/**
 * The "subscription" AI providers — chat engines backed by a locally
 * installed coding-agent CLI instead of a keyed provider API. One dispatch
 * seam so hosts branch on a single predicate rather than enumerating the
 * CLI-backed ids at every call site.
 */

/** Providers whose chat runs through a local CLI (no API key). */
export type CliAgentProviderId = 'claude-cli' | 'codex-cli'

export function isCliAgentProvider(id: AiProviderId): id is CliAgentProviderId {
  return id === 'claude-cli' || id === 'codex-cli'
}

/** Verify the provider's CLI is installed; resolves with its version. */
export async function checkCliAgentProvider(id: CliAgentProviderId): Promise<string> {
  return id === 'claude-cli' ? await checkClaudeCli() : await checkCodexCli()
}

/** Run one chat turn through the provider's CLI engine. */
export function streamCliAgentChat(
  id: CliAgentProviderId,
  options: StreamCliChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  return id === 'claude-cli' ? streamClaudeCliChat(options) : streamCodexCliChat(options)
}
