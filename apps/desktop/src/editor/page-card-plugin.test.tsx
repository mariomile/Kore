import { useMemo } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useExtension } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { NoteEditor } from './note-editor'
import { createPageCardPlugin, deliverPagePreview } from './page-card-plugin'

function Cards({ open }: { open: (target: string) => void }): null {
  useExtension(
    useMemo(
      () =>
        definePlugin(
          createPageCardPlugin({
            open,
            request: (target, view) => {
              queueMicrotask(() =>
                deliverPagePreview(view, target, {
                  title: target,
                  excerpt: 'Book flights · Hotel',
                  missing: false,
                }),
              )
            },
          }),
        ),
      [open],
    ),
  )
  return null
}

describe('page cards', () => {
  it('draws a line that is only a wiki link as a page card that opens on tap', async () => {
    const open = vi.fn<(target: string) => void>()
    await render(
      <NoteEditor initialContent={'Intro\n\n[[Trip to Lisbon]]\n\nsee [[Other]] too\n'}>
        <Cards open={open} />
      </NoteEditor>,
    )
    await vi.waitFor(() => {
      expect(document.querySelector('.kore-page-card-excerpt')?.textContent).toBe(
        'Book flights · Hotel',
      )
    })
    // Prose with a link in it stays prose.
    expect(document.querySelectorAll('.kore-page-card')).toHaveLength(1)
    const card = document.querySelector<HTMLElement>('.kore-page-card')
    expect(card?.querySelector('.kore-page-card-title')?.textContent).toBe('Trip to Lisbon')
    card?.click()
    expect(open).toHaveBeenCalledWith('Trip to Lisbon')
  })
})
