import type { ModelMessage } from 'ai'

/**
 * Flattening a chat's model-facing history into one headless CLI turn: the
 * prompt text plus the binary attachments (images, PDFs) an engine reads
 * natively. Each engine decides which media types it accepts and how the
 * attachments travel (Claude Code content blocks, Codex image items); this
 * module owns only the transcript and the attachment budget.
 */

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
 * entry in `attachments` when `accepts` says the engine reads its media type
 * (newest first, at most {@link MAX_CLI_ATTACHMENTS}); a file the engine
 * cannot read is named in the text as not available, so the model can say
 * so instead of guessing at it.
 */
export function agentCliInput(
  messages: ModelMessage[],
  accepts: (mediaType: string) => boolean,
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

  // Newest files win the attachment slots.
  const ordered = [...included, current]
  const carried = new Set<PendingFile>()
  for (const turn of [...ordered].reverse()) {
    for (const segment of [...turn.segments].reverse()) {
      if (
        segment.kind === 'file' &&
        segment.file.base64 !== null &&
        accepts(segment.file.mediaType) &&
        carried.size < MAX_CLI_ATTACHMENTS
      ) {
        carried.add(segment.file)
      }
    }
  }

  const attachments: AgentCliAttachment[] = []
  const render = (segments: MessageSegment[]): string =>
    segments
      .map((segment) => {
        if (segment.kind === 'text') {
          return segment.text
        }
        const file = segment.file
        if (!carried.has(file)) {
          return accepts(file.mediaType) && file.base64 !== null
            ? `[Earlier attachment: ${file.name} — not resent]`
            : `[Attachment: ${file.name} (${file.mediaType}) — this engine cannot read it]`
        }
        const label = `Attachment ${attachments.length + 1}: ${file.name}`
        attachments.push({
          label,
          name: file.name,
          mediaType: file.mediaType,
          base64: file.base64 ?? '',
        })
        return `[${label}]`
      })
      .join('\n')
      .trim()

  const history = included.map(
    (turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${render(turn.segments)}`,
  )
  const currentText = render(current.segments)
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
  return agentCliInput(messages, () => false).text
}
