import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { CollectionEntry, TagType } from '@kore/core'
import { MobileGallery } from './mobile-gallery'

const COVER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>'
vi.mock('@/hooks/use-note-card-images', () => ({
  useFirstImages: () => new Map([['notes/kitchen.md', COVER]]),
}))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { uiDensity: 'default', dateFormat: 'mdy', timeFormat: '12h' },
  }),
}))

const TYPE: TagType = { properties: [] }

function entry(path: string, title: string): CollectionEntry {
  return { path, title, mtime: 0, isPinned: false, properties: {} } as CollectionEntry
}

describe('MobileGallery', () => {
  it('leads a card with its note’s first image and opens the note', async () => {
    const onOpen = vi.fn()
    const view = await render(
      <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileGallery
          entries={[entry('notes/kitchen.md', 'Kitchen shelves'), entry('notes/plan.md', 'Plan')]}
          type={TYPE}
          onOpen={onOpen}
        />
      </div>,
    )
    const kitchen = view.getByRole('button', { name: 'Kitchen shelves' })
    expect(kitchen.element().querySelector('img')?.getAttribute('src')).toBe(COVER)
    expect(view.getByRole('button', { name: 'Plan' }).element().querySelector('img')).toBeNull()
    await userEvent.click(kitchen)
    expect(onOpen).toHaveBeenCalledWith('notes/kitchen.md')
  })
})
