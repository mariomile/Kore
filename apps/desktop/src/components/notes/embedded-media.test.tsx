import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { parseEmbedBlocks, type EmbedBlock } from '@reflect/core'
import { EmbeddedMedia } from './embedded-media'

/**
 * The rendered half of an ` ```embed ` fence: a card typed by what the link
 * points at, and nothing remote fetched until the reader asks for it.
 */

const openExternalUrl = vi.hoisted(() => vi.fn<(url: string) => void>())
vi.mock('@/editor/open-external-link', () => ({ openExternalUrl }))

function embedOf(body: string): EmbedBlock {
  const block = parseEmbedBlocks(`\`\`\`embed\n${body}\n\`\`\`\n`)[0]
  if (block === undefined) {
    throw new Error(`not a renderable embed: ${body}`)
  }
  return block
}

function renderEmbed(body: string, privateNote = false) {
  const noteHeader = privateNote ? '---\nprivate: true\n---\n' : ''
  return render(<EmbeddedMedia block={embedOf(body)} noteHeader={noteHeader} />)
}

describe('EmbeddedMedia', () => {
  it('names the kind and the readable URL for a repository', async () => {
    const view = await renderEmbed('https://github.com/mariomile/Kore')

    await expect.element(view.getByText('Repository')).toBeVisible()
    await expect.element(view.getByText('github.com/mariomile/Kore')).toBeVisible()
  })

  it('holds a video behind Play instead of loading the player on open', async () => {
    const view = await renderEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    await expect.element(view.getByText('Video')).toBeVisible()
    expect(document.querySelector('iframe')).toBeNull()

    await userEvent.click(view.getByRole('button', { name: 'Play' }))

    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('offers no Play for a video with no known player', async () => {
    const view = await renderEmbed('https://example.com/clip.mp4')

    await expect.element(view.getByText('Video')).toBeVisible()
    expect(view.getByRole('button', { name: 'Play' }).query()).toBeNull()
  })

  it('holds an image behind Show instead of loading it on open', async () => {
    const view = await renderEmbed('https://example.com/photo.png')

    expect(view.getByRole('img').query()).toBeNull()

    await userEvent.click(view.getByRole('button', { name: 'Show' }))

    await expect.element(view.getByRole('img')).toBeVisible()
  })

  it('never offers a remote load from a private note', async () => {
    const view = await renderEmbed('https://example.com/photo.png', true)

    await expect
      .element(view.getByText('Remote embeds are disabled for private notes.'))
      .toBeVisible()
    expect(view.getByRole('img').query()).toBeNull()
    expect(view.getByRole('button', { name: 'Show' }).query()).toBeNull()
    expect(view.getByRole('button', { name: /Open example.com/ }).query()).toBeNull()
  })

  it('opens the link through the app’s one routing rule', async () => {
    const view = await renderEmbed('https://example.com/some/page')

    await userEvent.click(view.getByRole('button', { name: 'Open example.com/some/page' }))

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/some/page')
  })

  it('sandboxes a raw-HTML embed and loads it only on request', async () => {
    const view = await renderEmbed('<iframe src="https://example.com"></iframe>')

    await expect.element(view.getByText('HTML embed')).toBeVisible()
    expect(document.querySelector('iframe')).toBeNull()

    await userEvent.click(view.getByRole('button', { name: 'Show' }))

    const frame = document.querySelector('iframe')
    // No `allow-same-origin`: scripts run in an opaque origin, with no reach
    // into the app's DOM, storage or cookies.
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-forms')
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame?.getAttribute('srcdoc')).toContain('<iframe src="https://example.com">')
  })
})
