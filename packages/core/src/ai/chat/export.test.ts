import { describe, expect, it } from 'vitest'
import type { ChatTurn } from './transcript'
import { chatToMarkdown } from './export'

function turn(overrides: Partial<ChatTurn>): ChatTurn {
  return {
    id: 't1',
    userText: 'hello',
    attachments: [],
    parts: [],
    responseMessages: [],
    status: 'done',
    ...overrides,
  }
}

describe('chatToMarkdown', () => {
  it('renders user and assistant prose, separated per turn', () => {
    const markdown = chatToMarkdown([
      turn({
        id: 'a',
        userText: 'What did I write about focus?',
        parts: [{ kind: 'text', text: 'You wrote about deep work in [[Focus]].' }],
      }),
      turn({
        id: 'b',
        userText: 'Summarize it',
        parts: [{ kind: 'text', text: 'Deep work needs long unbroken blocks.' }],
      }),
    ])
    expect(markdown).toBe(
      '**You:**\n\nWhat did I write about focus?\n\n' +
        '**Assistant:**\n\nYou wrote about deep work in [[Focus]].\n\n' +
        '---\n\n' +
        '**You:**\n\nSummarize it\n\n' +
        '**Assistant:**\n\nDeep work needs long unbroken blocks.',
    )
  })

  it('drops tool chips and notices, keeping only prose', () => {
    const markdown = chatToMarkdown([
      turn({
        parts: [
          {
            kind: 'tool',
            call: { tool: 'search', toolCallId: 'c1', query: 'focus' },
            result: null,
            error: null,
          },
          { kind: 'text', text: 'Found it.' },
          { kind: 'notice', tone: 'info', text: 'Stopped.' },
        ],
      }),
    ])
    expect(markdown).toBe('**You:**\n\nhello\n\n**Assistant:**\n\nFound it.')
  })

  it('notes image attachments by count instead of embedding them', () => {
    const markdown = chatToMarkdown([
      turn({
        userText: '',
        attachments: [
          { id: 'i1', name: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,x' },
        ],
        parts: [{ kind: 'text', text: 'A red square.' }],
      }),
    ])
    expect(markdown).toBe('**You:**\n\n_[1 image attached]_\n\n**Assistant:**\n\nA red square.')
  })

  it('skips turns with nothing to show', () => {
    expect(chatToMarkdown([turn({ userText: '   ', parts: [] })])).toBe('')
  })
})
