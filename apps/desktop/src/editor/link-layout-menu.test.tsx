import { useMemo, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { parseEmbedFenceBody, type LinkPreview } from '@kore/core'
import '@/test-utils/locator'
import { EmbedFence } from '@/components/notes/embed-fence'
import { createLinkCardPlugin, deliverLinkPreview } from './link-card-plugin'
import { LinkLayoutMenu } from './link-layout-menu'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

/**
 * The appearance menu rewrites a link's Markdown: Inline link, Compact,
 * Card, Large, for an embed fence and for a bare pasted URL alike.
 */

const CAPTOO: LinkPreview = {
  kind: 'page',
  url: 'https://captoo.io',
  siteName: 'Captoo',
  provider: null,
  imageUrl: null,
  iconUrl: null,
  title: 'Captoo [beta]',
  description: 'Be the answer AI gives.',
}

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  loadLinkPreview: vi.fn(() => Promise.resolve(CAPTOO)),
}))

/** Pasted-link cards with an instant preview, as LinkPreviewCards draws them. */
function InstantCards(): null {
  const extension = useMemo(
    () =>
      definePlugin(
        createLinkCardPlugin({
          request: (_url, view) => queueMicrotask(() => deliverLinkPreview(view, CAPTOO)),
          open: () => {},
        }),
      ),
    [],
  )
  useExtension(extension)
  return null
}

async function renderNote(markdown: string, children?: ReactElement): Promise<NoteEditorHandle> {
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
    >
      {children}
      <LinkLayoutMenu />
    </NoteEditor>,
  )
  await expect.element(page.getByRole('button', { name: 'Link appearance' })).toBeVisible()
  return handle!
}

async function choose(label: string): Promise<void> {
  await page.getByRole('button', { name: 'Link appearance' }).click()
  await expect.element(page.getByTestId('link-layout-menu')).toBeVisible()
  await page.getByRole('menuitemradio', { name: label }).click()
}

describe('LinkLayoutMenu', () => {
  it('switches an embed fence between card, large, compact and an inline link', async () => {
    const handle = await renderNote('before\n\n```embed\nhttps://captoo.io\n```\n\nafter')

    await choose('Large')
    await expect.poll(() => handle.getMarkdown()).toContain('https://captoo.io\nlayout: large')
    await expect
      .poll(() => document.querySelector('.kore-link-card')?.getAttribute('data-layout'))
      .toBe('large')

    await choose('Compact')
    await expect.poll(() => handle.getMarkdown()).toContain('layout: compact')

    await choose('Card')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe('before\n\n```embed\nhttps://captoo.io\n```\n\nafter\n')

    await choose('Inline link')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe('before\n\n[Captoo \\[beta\\]](https://captoo.io)\n\nafter\n')
  })

  it('turns a pasted link card into a large embed, or back into a named link', async () => {
    const handle = await renderNote('before\n\nhttps://captoo.io\n\nafter', <InstantCards />)

    await choose('Large')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe('before\n\n```embed\nhttps://captoo.io\nlayout: large\n```\n\nafter\n')

    await choose('Inline link')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe('before\n\n[Captoo \\[beta\\]](https://captoo.io)\n\nafter\n')
  })
})
