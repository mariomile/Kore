import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { parseEmbedFenceBody, type LinkPreview } from '@kore/core'
import '@/test-utils/locator'
import { NoteEditor, type NoteEditorHandle } from '@/editor/note-editor'
import { EmbedFence } from './embed-fence'

/**
 * An ` ```embed ` fence draws its card where the fence sits in the note, not
 * under the note, and its source shows only while the caret is in it.
 */

const openExternalUrl = vi.hoisted(() => vi.fn<(url: string) => void>())
vi.mock('@/editor/open-external-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor/open-external-link')>()),
  openExternalUrl,
}))

const loadLinkPreview = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<LinkPreview | null>>(() => Promise.resolve(null)),
)
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  loadLinkPreview,
}))

const CAPTOO: LinkPreview = {
  kind: 'page',
  url: 'https://captoo.io',
  siteName: 'Captoo',
  provider: null,
  imageUrl: null,
  iconUrl: null,
  title: 'Captoo: be the answer AI gives',
  description: 'Track how ChatGPT and Perplexity talk about your brand.',
}

const NOTE = 'before\n\n```embed\nhttps://captoo.io\n```\n\nafter'

async function renderNote(markdown: string): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={markdown}
      renderCodeBlock={({ language, code }) => {
        const block = language === 'embed' ? parseEmbedFenceBody(code) : null
        return block === null ? null : <EmbedFence block={block} privateNote={false} />
      }}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    />,
  )
  await expect.element(page.getByTestId('embed-fence')).toBeInTheDocument()
  return handle!
}

function topOf(text: string): number {
  const node = [...document.querySelectorAll('.ProseMirror p')].find(
    (paragraph) => paragraph.textContent === text,
  )
  if (node === undefined) throw new Error(`no paragraph "${text}"`)
  return node.getBoundingClientRect().top
}

describe('EmbedFence', () => {
  it('draws the card between the lines around the fence', async () => {
    await renderNote(NOTE)
    const card = page.getByTestId('embed-fence').element().getBoundingClientRect()
    expect(card.top).toBeGreaterThan(topOf('before'))
    expect(card.top).toBeLessThan(topOf('after'))
    await expect.element(page.getByText('captoo.io', { exact: true })).toBeVisible()
    // A plain page has no "Link" eyebrow.
    expect(page.getByTestId('embed-fence').element().textContent).not.toMatch(/link/i)
  })

  it('keeps the fence as plain Markdown', async () => {
    const handle = await renderNote(NOTE)
    expect(handle.getMarkdown().trim()).toBe(NOTE)
  })

  it('puts the caret in the URL when the card is pressed', async () => {
    const handle = await renderNote(NOTE)
    await page.getByText('captoo.io', { exact: true }).click()
    // "before" is 1–7, the fence opens at 8, its text starts at 9.
    await expect
      .poll(() => {
        const selection = handle.getSelection?.()
        return selection?.type === 'text' ? selection.anchor : null
      })
      .toBe(9)
  })

  it('opens the link from its button without moving the caret', async () => {
    const handle = await renderNote(NOTE)
    await page.getByRole('button', { name: 'Open captoo.io' }).click()
    expect(openExternalUrl).toHaveBeenCalledWith('https://captoo.io')
    const selection = handle.getSelection?.()
    expect(selection?.type === 'text' ? selection.anchor : null).not.toBe(9)
  })

  it('becomes a rich card once the page describes itself', async () => {
    loadLinkPreview.mockResolvedValueOnce(CAPTOO)
    await renderNote(NOTE)
    await expect.element(page.getByTestId('rich-link-card')).toBeInTheDocument()
    await expect.element(page.getByText('Captoo: be the answer AI gives')).toBeVisible()
    await expect
      .element(page.getByText('Track how ChatGPT and Perplexity talk about your brand.'))
      .toBeVisible()
    expect(page.getByTestId('rich-link-card').element().textContent).toContain('Captoo · captoo.io')
    await page.getByRole('button', { name: 'Open captoo.io' }).click()
    expect(openExternalUrl).toHaveBeenCalledWith('https://captoo.io')
  })
})
