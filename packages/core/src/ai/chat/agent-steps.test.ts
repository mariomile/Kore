import { describe, expect, it } from 'vitest'
import { agentStepTree, describeClaudeToolCall, type AgentStep } from './agent-steps'

const root = '/Users/me/vault'

function describe1(tool: string, input: Record<string, unknown> = {}): AgentStep {
  return describeClaudeToolCall({ id: tool, tool, input, parentId: null, graphRoot: root })
}

describe('describeClaudeToolCall', () => {
  it('gives every tool a kind, so the transcript never switches on tool names', () => {
    expect(
      [
        'Read',
        'Write',
        'MultiEdit',
        'NotebookEdit',
        'Glob',
        'Grep',
        'TodoWrite',
        'Agent',
        'Task',
      ].map((tool) => describe1(tool).kind),
    ).toEqual([
      'read',
      'write',
      'write',
      'write',
      'search',
      'search',
      'plan',
      'subagent',
      'subagent',
    ])
    expect(describe1('mcp__notion__search_pages').kind).toBe('mcp')
    expect(describe1('WebFetch').kind).toBe('other')
  })

  it('names the note a file tool touched, and only a note inside the graph', () => {
    const note = (tool: string, path: string): string | null =>
      describe1(tool, { file_path: path }).notePath
    expect(note('Read', `${root}/notes/alpha.md`)).toBe('notes/alpha.md')
    expect(note('Edit', `${root}/notes/alpha.md`)).toBe('notes/alpha.md')
    expect(note('Read', `${root}/assets/cat.png`)).toBeNull()
    expect(note('Read', '/etc/hosts.md')).toBeNull()
    expect(note('NotebookEdit', `${root}/a.md`)).toBeNull()
    // The detail is clipped for display; the note path is not.
    const long = `notes/${'x'.repeat(200)}.md`
    const step = describe1('Read', { file_path: `${root}/${long}` })
    expect(step.notePath).toBe(long)
    expect(step.detail?.length).toBeLessThan(long.length)
  })
})

describe('agentStepTree', () => {
  const item = (id: string, kind: AgentStep['kind'], parentId: string | null) => ({
    step: { id, tool: id, label: id, detail: null, parentId, kind, notePath: null },
  })
  const shape = (nodes: ReturnType<typeof agentStepTree>): unknown =>
    nodes.map((node) => [node.item.step.id, shape(node.children)])

  it('nests steps only under the subagent that ran them, in order', () => {
    const tree = agentStepTree([
      item('a', 'subagent', null),
      item('a1', 'read', 'a'),
      item('b', 'subagent', 'a'),
      item('b1', 'search', 'b'),
      item('a2', 'write', 'a'),
      item('c', 'read', null),
      // A parent that is not a subagent, or is missing, keeps the step at the top.
      item('c1', 'read', 'c'),
      item('x1', 'read', 'missing'),
    ])
    expect(shape(tree)).toEqual([
      [
        'a',
        [
          ['a1', []],
          ['b', [['b1', []]]],
          ['a2', []],
        ],
      ],
      ['c', []],
      ['c1', []],
      ['x1', []],
    ])
  })
})
