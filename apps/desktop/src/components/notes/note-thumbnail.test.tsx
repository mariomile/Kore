import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('@/hooks/use-note-skeleton', () => ({
  useNoteSkeleton: () => [
    { kind: 'heading', depth: 0, width: 0.6 },
    { kind: 'text', depth: 0, width: 1 },
    { kind: 'task', depth: 1, width: 0.5 },
    { kind: 'bullet', depth: 0, width: 0.4 },
  ],
}))

const { NoteThumbnail } = await import('./note-thumbnail')

it('draws one row per skeleton line, all of them on a row-sized sheet', async () => {
  const view = await render(<NoteThumbnail path="a.md" size="row" />)
  const rows = view.container.querySelectorAll('.kore-page-skel')
  expect([...rows].map((row) => row.getAttribute('data-kind'))).toEqual([
    'heading',
    'text',
    'task',
    'bullet',
  ])
  expect((rows[2] as HTMLElement).style.getPropertyValue('--depth')).toBe('1')
  await view.unmount()
})

it('keeps the small stacked sheet to its first three rows', async () => {
  const view = await render(<NoteThumbnail path="a.md" size="stack" />)
  expect(view.container.querySelectorAll('.kore-page-skel')).toHaveLength(3)
  await view.unmount()
})
