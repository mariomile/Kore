import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { AgentStep, AgentStepOutcome, AssistantPart } from '@reflect/core'
import { ChatAgentSteps } from './chat-agent-steps'

vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => vi.fn(),
}))

type StepPart = Extract<AssistantPart, { kind: 'step' }>

function step(
  id: string,
  fields: Partial<AgentStep>,
  outcome: AgentStepOutcome | null = { error: null, summary: null },
): StepPart {
  return {
    kind: 'step',
    step: {
      id,
      tool: 'Read',
      label: 'Read',
      detail: null,
      parentId: null,
      kind: 'read',
      notePath: null,
      ...fields,
    },
    outcome,
  }
}

const steps: StepPart[] = [
  step(
    'agent-1',
    { tool: 'Agent', label: 'Subagent', detail: 'Summarize alpha', kind: 'subagent' },
    { error: null, summary: '1 step · 3s' },
  ),
  step(
    'glob-1',
    { tool: 'Glob', label: 'Find files', detail: 'notes/*.md', kind: 'search' },
    { error: null, summary: '2 files' },
  ),
  step(
    'read-1',
    { detail: 'notes/alpha.md', notePath: 'notes/alpha.md', parentId: 'agent-1' },
    null,
  ),
]

describe('ChatAgentSteps', () => {
  it('shows the live step while streaming, nesting subagent work in its card', async () => {
    const view = await render(<ChatAgentSteps steps={steps} turnStatus="streaming" />)
    await expect.element(view.getByRole('button', { name: /Working/ })).toBeVisible()
    const list = view.getByRole('list', { name: 'Agent steps' })
    await expect.element(list.getByText('Summarize alpha')).toBeVisible()
    await expect.element(list.getByText('2 files')).toBeVisible()
    // The subagent's read renders inside its card, not as a top-level row.
    await expect
      .element(
        list
          .getByRole('listitem')
          .filter({ hasText: 'Summarize alpha' })
          .getByText('notes/alpha.md'),
      )
      .toBeVisible()
    // The note a step touched opens from the row.
    await expect.element(list.getByRole('button', { name: 'notes/alpha.md' })).toBeVisible()
  })

  it('folds a settled run into a step count that expands on click', async () => {
    const settled = steps.map((part) =>
      part.outcome === null
        ? { ...part, outcome: { error: 'File is denied', summary: null } }
        : part,
    )
    const view = await render(<ChatAgentSteps steps={settled} turnStatus="done" />)
    const header = view.getByRole('button', { name: /Worked · 3 steps/ })
    await expect.element(header).toHaveAttribute('aria-expanded', 'false')
    await expect.element(view.getByText('· 1 failed')).toBeVisible()
    await header.click()
    await expect.element(view.getByText('File is denied')).toBeVisible()
  })
})
