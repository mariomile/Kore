import { describe, expect, it } from 'vitest'
import { withUndrawnDiagramsAsCode } from './preview-diagrams'

describe('withUndrawnDiagramsAsCode', () => {
  it('keeps a diagram the preview can draw', () => {
    const markdown = '# Plan\n\n```mermaid\n%% a comment\nflowchart LR\n  a --> b\n```\n'
    expect(withUndrawnDiagramsAsCode(markdown)).toBe(markdown)
  })

  it('shows a diagram the preview cannot draw as plain code', () => {
    expect(withUndrawnDiagramsAsCode('Intro\n\n```mermaid\ngantt\n  title Q4\n```\n\nOutro')).toBe(
      'Intro\n\n```\ngantt\n  title Q4\n```\n\nOutro',
    )
  })

  it('shows a diagram behind frontmatter as code, since the preview cannot draw it', () => {
    expect(
      withUndrawnDiagramsAsCode('```mermaid\n---\ntitle: Flow\n---\nflowchart LR\n  a --> b\n```'),
    ).toBe('```\n---\ntitle: Flow\n---\nflowchart LR\n  a --> b\n```')
  })

  it('handles tilde fences, indentation and several fences', () => {
    expect(
      withUndrawnDiagramsAsCode(
        '- item\n  ~~~mermaid\n  pie\n  ~~~\n\n```mermaid\nsequenceDiagram\n  a->>b: hi\n```',
      ),
    ).toBe('- item\n  ~~~\n  pie\n  ~~~\n\n```mermaid\nsequenceDiagram\n  a->>b: hi\n```')
  })

  it('handles CRLF notes and a space before the info string', () => {
    expect(withUndrawnDiagramsAsCode('A\r\n``` mermaid\r\npie\r\n  "a": 1\r\n```\r\nB')).toBe(
      'A\r\n```\r\npie\r\n  "a": 1\r\n```\r\nB',
    )
    const drawn = '```mermaid\r\nflowchart LR\r\n  a --> b\r\n```\r\n'
    expect(withUndrawnDiagramsAsCode(drawn)).toBe(drawn)
  })

  it('leaves other fences and prose that mentions mermaid alone', () => {
    const markdown = 'I like mermaid.\n\n```ts\nconst mermaid = 1\n```'
    expect(withUndrawnDiagramsAsCode(markdown)).toBe(markdown)
  })
})
