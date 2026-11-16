import type { ModelMessage } from 'ai'
import { attachmentChannel } from './chat/attachment-types'

/**
 * Flattening a chat's model-facing history into one headless CLI turn: the
 * prompt text plus the binary attachments (images, PDFs) an engine reads
 * natively. Each engine declares the channels it reads (see
 * `./chat/attachment-types`) and how they travel (Claude Code content
 * blocks, Codex image items); this module owns only the transcript and the
 * attachment budget.
 */

/** The binary channels an engine can read natively. */
export type AgentCliChannel = 'image' | 'document'

/** Rough transcript budget: the CLI re-reads notes itself, so history-only. */
const MAX_TRANSCRIPT_CHARS = 60_000

/**
 * One binary attachment (image or PDF) carried into a CLI turn beside the
 * flattened prompt. Text files never appear here: they are already text
 * blocks in the prompt (see `./chat/attachment-types`).
 */
export interface AgentCliAttachment {
  /** The marker the prompt text uses for it, e.g. `Attachment 1: chart.png`. */
  readonly label: string
  readonly name: string
  readonly mediaType: string
  /** How the engine encodes it (image block, document block). */
  readonly channel: AgentCliChannel
  /** The bytes, base64-encoded. */
  readonly base64: string
}

/** A CLI turn's input: the flattened prompt plus the attachments it references. */
export interface AgentCliInput {
  readonly text: string
  readonly attachments: AgentCliAttachment[]
}

/**
 * At most this many binary attachments ride one CLI turn, newest first. The
 * CLIs keep no state across invocations, so earlier turns' files are resent
 * for follow-up questions — bounded, so a long image-heavy chat cannot grow
 * every request without limit.
 */
export const MAX_CLI_ATTACHMENTS = 8

/** A binary part of a model message, before it is labeled. */
interface PendingFile {
  name: string
  mediaType: string
  base64: string | null
}

type MessageSegment = { kind: 'text'; text: string } | { kind: 'file'; file: PendingFile }

/** A file part the engine can read: the channel it travels on and its bytes. */
function readable(
  file: PendingFile,
  accepts: ReadonlySet<AgentCliChannel>,
): { channel: AgentCliChannel; base64: string } | null {
  const channel = attachmentChannel(file.mediaType)
  return channel !== null && channel !== 'text' && accepts.has(channel) && file.base64 !== null
    ? { channel, base64: file.base64 }
    : null
}

/** The base64 payload of a provider file/image part, or null when it is not inline bytes. */
function inlineBase64(data: unknown): string | null {
  if (typeof data !== 'string') {
    return null
  }
  if (data.startsWith('data:')) {
    const separator = data.indexOf(',')
    return separator === -1 ? null : data.slice(separator + 1)
  }
  return /^[\d+/=a-z\s]+$/i.test(data) ? data : null
}

/** A model message as ordered text and file segments. */
function messageSegments(message: ModelMessage): MessageSegment[] {
  if (typeof message.content === 'string') {
    return [{ kind: 'text', text: message.content }]
  }
  const segments: MessageSegment[] = []
  for (const part of message.content) {
    if (part.type === 'text') {
      segments.push({ kind: 'text', text: part.text })
    } else if (part.type === 'file') {
      segments.push({
        kind: 'file',
        file: {
          name: part.filename ?? 'attachment',
          mediaType: part.mediaType,
          base64: inlineBase64(part.data),
        },
      })
    } else if (part.type === 'image') {
      segments.push({
        kind: 'file',
        file: {
          name: 'image',
          mediaType: part.mediaType ?? 'image/png',
          base64: inlineBase64(part.image),
        },
      })
    }
  }
  return segments
}

/**
 * Flatten the model-facing history into one headless prompt plus the binary
 * attachments the engine can read natively. The CLIs have no conversation
 * state across invocations, so prior turns ride along as a transcript,
 * oldest dropped first when the budget is exceeded.
 *
 * Each file part becomes a `[Attachment N: name]` marker in the text and an
 * entry in `attachments` when the engine `accepts` its channel
 * (newest first, at most {@link MAX_CLI_ATTACHMENTS}); a file the engine
 * cannot read is named in the text as not available, so the model can say
 * so instead of guessing at it.
 */
export function agentCliInput(
  messages: ModelMessage[],
  accepts: ReadonlySet<AgentCliChannel>,
): AgentCliInput {
  const turns = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, segments: messageSegments(message) }))
    .filter((turn) =>
      turn.segments.some((segment) => segment.kind === 'file' || segment.text.trim() !== ''),
    )
  const current = turns.pop()
  if (current === undefined) {
    return { text: '', attachments: [] }
  }

  // Which turns fit the budget, judged on their text alone (attachments ride
  // beside the prompt, not inside it).
  const roughText = (segments: MessageSegment[]): string =>
    segments.map((segment) => (segment.kind === 'text' ? segment.text : '[Attachment]')).join('\n')
  const included: typeof turns = []
  let budget = MAX_TRANSCRIPT_CHARS - roughText(current.segments).length
  for (const turn of [...turns].reverse()) {
    const length = roughText(turn.segments).length + 'Assistant: '.length
    if (length > budget) {
      break
    }
    budget -= length
    included.unshift(turn)
  }

  // Every file in render order (oldest first), then the newest readable
  // ones win the attachment slots and are numbered in render order.
  const ordered = [...included, current]
  const files = ordered.flatMap((turn) =>
    turn.segments.flatMap((segment) => (segment.kind === 'file' ? [segment.file] : [])),
  )
  const slots = new Set(
    files
      .map((file, index) => ({ index, read: readable(file, accepts) }))
      .filter((entry) => entry.read !== null)
      .map((entry) => entry.index)
      .slice(-MAX_CLI_ATTACHMENTS),
  )
  const attachments: AgentCliAttachment[] = []
  const markers = files.map((file, index): string => {
    const read = readable(file, accepts)
    if (read === null) {
      return `[Attachment: ${file.name} (${file.mediaType}) — this engine cannot read it]`
    }
    if (!slots.has(index)) {
      return `[Earlier attachment: ${file.name} — not resent]`
    }
    const label = `Attachment ${attachments.length + 1}: ${file.name}`
    attachments.push({ label, name: file.name, mediaType: file.mediaType, ...read })
    return `[${label}]`
  })

  // Each turn's text with its files' markers, in the same order as `files`.
  let fileIndex = 0
  const rendered = ordered.map((turn) =>
    turn.segments
      .map((segment) => {
        if (segment.kind === 'text') {
          return segment.text
        }
        const marker = markers[fileIndex] ?? ''
        fileIndex += 1
        return marker
      })
      .join('\n')
      .trim(),
  )
  const currentText = rendered.at(-1) ?? ''
  const history = included.map(
    (turn, index) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${rendered[index] ?? ''}`,
  )
  if (history.length === 0) {
    return { text: currentText, attachments }
  }
  return {
    text: [
      'Previous conversation (for context):',
      '',
      ...history,
      '',
      'Current question:',
      currentText,
    ].join('\n'),
    attachments,
  }
}

/**
 * The flattened prompt for an engine with no file channel: every attachment
 * is named in the text as unreadable (see {@link agentCliInput}).
 */
export function agentCliPrompt(messages: ModelMessage[]): string {
  return agentCliInput(messages, new Set()).text
}
