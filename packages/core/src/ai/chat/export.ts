import type { AssistantPart, ChatTurn } from './transcript'

/**
 * Render a chat conversation as a markdown note body (Save chat as note).
 *
 * The body keeps only what reads as a transcript: each turn's user message
 * and the assistant's prose. Tool chips are activity, not content, and
 * notices ("Stopped.", stream errors) are session artifacts — both are
 * dropped. Image attachments can't be embedded (their bytes live only in the
 * chat store), so they are noted by count. Turns are separated with a
 * thematic break so long conversations stay scannable.
 */
export function chatToMarkdown(turns: ChatTurn[]): string {
  const sections = turns.map((turn) => renderTurn(turn)).filter((section) => section !== '')
  return sections.join('\n\n---\n\n')
}

function renderTurn(turn: ChatTurn): string {
  const blocks: string[] = []
  const userText = turn.userText.trim()
  const attachmentNote =
    turn.attachments.length === 0
      ? ''
      : `_[${turn.attachments.length} ${turn.attachments.length === 1 ? 'image' : 'images'} attached]_`
  const userBlock = [userText, attachmentNote].filter((part) => part !== '').join('\n\n')
  if (userBlock !== '') {
    blocks.push(`**You:**\n\n${userBlock}`)
  }
  const assistantText = assistantProse(turn.parts)
  if (assistantText !== '') {
    blocks.push(`**Assistant:**\n\n${assistantText}`)
  }
  return blocks.join('\n\n')
}

function assistantProse(parts: AssistantPart[]): string {
  return parts
    .filter((part): part is Extract<AssistantPart, { kind: 'text' }> => part.kind === 'text')
    .map((part) => part.text.trim())
    .filter((text) => text !== '')
    .join('\n\n')
}
