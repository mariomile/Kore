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
 *
 * pi (`pi-cli`) is the odd one out: it is installed and signed in like the
 * others, but it is a harness, not an agent with its own file tools — it
 * runs Kore's chat tools (see {@link isFileAgentProvider}).
 */

/** Providers whose chat runs through a local CLI (no API key). */
export type CliAgentProviderId = 'claude-cli' | 'codex-cli' | 'cursor-cli' | 'pi-cli'

export function isCliAgentProvider(id: AiProviderId): id is CliAgentProviderId {
  return id === 'claude-cli' || id === 'codex-cli' || id === 'cursor-cli' || id === 'pi-cli'
}

/** The CLI engines that read (and may write) the vault with their own tools. */
export type FileAgentProviderId = Exclude<CliAgentProviderId, 'pi-cli'>

/**
 * Whether the provider is a CLI agent that works on the vault's files
 * itself — every CLI engine but pi. pi is key-less and binary-backed like
 * the rest, but it is a bare harness: its turn is the chat engine's
 * (`streamChat`), with the same tools, privacy gate and proposal cards, so
 * the file-agent seams (the private-note deny list, edit mode, MCP, the
 * post-run Changes ledger, routines) do not apply to it.
 */
export function isFileAgentProvider(id: AiProviderId): id is FileAgentProviderId {
  return isCliAgentProvider(id) && id !== 'pi-cli'
}

/**
 * Whether the engine's write path is verified enough to join edit mode and
 * automations. Cursor stays read-only until its write grants are proven
 * against the real CLI — chat and grounding work, the vault stays untouched.
 * pi never writes files itself: its edits are the chat tools' proposals.
 */
export function cliProviderSupportsEdits(id: CliAgentProviderId): boolean {
  return id === 'claude-cli' || id === 'codex-cli'
}

/**
 * Whether the engine can mount the app's MCP servers on a run. Cursor cannot:
 * its per-run `.cursor/cli.json` denies MCP by design (read-only posture),
 * and BYOK engines never reach this predicate. Chat tools and Full Access use
 * this predicate before mounting configured MCP servers.
 */
export function cliProviderSupportsMcp(id: CliAgentProviderId): boolean {
  return id === 'claude-cli' || id === 'codex-cli'
}

/**
 * How the engine takes a message while a turn is streaming (bb's steer-mode
 * capability): 'inject' delivers it into the live session — context
 * preserved, no cancel-and-relaunch — while 'queue' engines can only wait
 * for the turn to settle. Claude Code injects via its stream-json input
 * session; Codex injects via app-server `turn/steer`; pi via its RPC
 * `steer` command. Cursor stays
 * queue-only: its ACP `session/prompt` is blocking until the turn ends.
 */
export function cliProviderSteerMode(id: CliAgentProviderId): 'inject' | 'queue' {
  return id === 'cursor-cli' ? 'queue' : 'inject'
}

/**
 * Whether a message sent while this provider's turn streams can steer the
 * live reply, rather than only wait for it to finish. Every BYOK engine can
 * (the chat engine restarts its generation on the combined history — see
 * `streamChatTurn`); CLI engines can when they inject
 * ({@link cliProviderSteerMode}). Hosts use this to decide what Enter does
 * mid-turn and what the composer promises.
 */
export function chatProviderCanSteer(id: AiProviderId): boolean {
  return !isCliAgentProvider(id) || cliProviderSteerMode(id) === 'inject'
}

/** The binary each provider's CLI check runs. */
const CLI_AGENT_BINARY: Record<CliAgentProviderId, AgentCliBinary> = {
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'cursor-cli': 'cursor-agent',
  'pi-cli': 'pi',
}

/** Verify the provider's CLI is installed; resolves with its version. */
export async function checkCliAgentProvider(id: CliAgentProviderId): Promise<string> {
  return await checkAgentCli(CLI_AGENT_BINARY[id])
}

/** Run one chat turn through a file-agent CLI engine. */
export function streamCliAgentChat(
  id: FileAgentProviderId,
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
