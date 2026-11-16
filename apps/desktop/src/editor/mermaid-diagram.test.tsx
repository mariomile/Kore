import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { MermaidDiagram } from './mermaid-diagram'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const FLOWCHART = 'flowchart LR\n  A[Start] --> B[Done]'
const PIE = 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85'

async function renderNote(markdown: string): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={markdown}
      renderCodeBlock={({ language, code }) =>
        language === 'mermaid' ? <MermaidDiagram code={code} /> : null
      }
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    />,
  )
  await expect.element(page.getByTestId('mermaid-diagram').first()).toBeInTheDocument()
  return handle!
}

function fence(body: string): string {
  return `before\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nafter`
}

describe('MermaidDiagram', () => {
  it('draws a flowchart as SVG with its labels', async () => {
    await renderNote(fence(FLOWCHART))
    const diagram = page.getByTestId('mermaid-diagram')
    await expect.poll(() => diagram.element().querySelector('svg')).not.toBeNull()
    expect(diagram.element().textContent).toContain('Start')
    expect(diagram.element().textContent).toContain('Done')
  })

  it('draws a chart type the old renderer could not', async () => {
    await renderNote(fence(PIE))
    const diagram = page.getByTestId('mermaid-diagram')
    await expect.poll(() => diagram.element().querySelector('svg')).not.toBeNull()
    expect(diagram.element().textContent).toContain('Dogs')
  })

  it('keeps the fence as plain Markdown', async () => {
    const markdown = fence(FLOWCHART)
    const handle = await renderNote(markdown)
    await expect
      .poll(() => page.getByTestId('mermaid-diagram').element().querySelector('svg'))
      .not.toBeNull()
    expect(handle.getMarkdown().trim()).toBe(markdown)
  })

  it('shows the syntax error instead of a drawing', async () => {
    await renderNote(fence('flowchart LR\n  A --> '))
    const diagram = page.getByTestId('mermaid-diagram')
    await expect.poll(() => diagram.element().textContent?.trim().length ?? 0).toBeGreaterThan(0)
    expect(diagram.element().querySelector('svg')).toBeNull()
  })

  it('puts the caret in the source when the drawing is clicked', async () => {
    const handle = await renderNote(fence(FLOWCHART))
    const diagram = page.getByTestId('mermaid-diagram')
    await expect.poll(() => diagram.element().querySelector('svg')).not.toBeNull()
    await diagram.click()
    // The fence's text starts at position 9: "before" is 1–7, the fence opens at 8.
    await expect
      .poll(() => {
        const selection = handle.getSelection?.()
        return selection?.type === 'text' ? selection.anchor : null
      })
      .toBe(9)
  })
})
