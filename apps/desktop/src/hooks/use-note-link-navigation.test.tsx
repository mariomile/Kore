import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import { RouterProvider, useRouter } from '@/routing/router'
import { useNoteLinkNavigation } from './use-note-link-navigation'

const openInPane = vi.hoisted(() => vi.fn())
const holderOf = vi.hoisted(() => vi.fn<(route: unknown) => string | null>())
const useOptionalPanes = vi.hoisted(() => vi.fn())
const usePaneId = vi.hoisted(() => vi.fn())

vi.mock('@/providers/panes-provider', () => ({
  useOptionalPanes,
  usePaneId,
}))

function Link({ openInSplit }: { readonly openInSplit: boolean }): ReactElement {
  const openNoteLink = useNoteLinkNavigation()
  return (
    <button
      type="button"
      onClick={() =>
        openNoteLink({ target: { kind: 'note', path: 'notes/alpha.md' }, openInSplit })
      }
    >
      Alpha
    </button>
  )
}

function RouteProbe(): ReactElement {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function Harness({ openInSplit }: { readonly openInSplit: boolean }): ReactElement {
  return (
    <RouterProvider initialRoute={{ kind: 'allNotes', filter: { kind: 'all' } }}>
      <Link openInSplit={openInSplit} />
      <RouteProbe />
    </RouterProvider>
  )
}

function route(view: Awaited<ReturnType<typeof render>>): unknown {
  return JSON.parse(view.getByTestId('route').element().textContent ?? 'null')
}

beforeEach(() => {
  openInPane.mockReset()
  holderOf.mockReset()
  holderOf.mockReturnValue(null)
  useOptionalPanes.mockReset()
  usePaneId.mockReset()
})

describe('useNoteLinkNavigation', () => {
  it('navigates in place on a plain click', async () => {
    useOptionalPanes.mockReturnValue(null)
    usePaneId.mockReturnValue('main')
    const view = await render(<Harness openInSplit={false} />)

    await view.getByRole('button', { name: 'Alpha' }).click()

    await expect.poll(() => route(view)).toEqual({ kind: 'note', path: 'notes/alpha.md' })
    expect(openInPane).not.toHaveBeenCalled()
  })

  it('navigates in place on a modifier click when no panes are mounted', async () => {
    useOptionalPanes.mockReturnValue(null)
    usePaneId.mockReturnValue('main')
    const view = await render(<Harness openInSplit={true} />)

    await view.getByRole('button', { name: 'Alpha' }).click()

    await expect.poll(() => route(view)).toEqual({ kind: 'note', path: 'notes/alpha.md' })
    expect(openInPane).not.toHaveBeenCalled()
  })

  it('opens the target in the pane beside this one on a modifier click', async () => {
    useOptionalPanes.mockReturnValue({ openInPane, holderOf })
    usePaneId.mockReturnValue('pane-left')
    const view = await render(<Harness openInSplit={true} />)

    await view.getByRole('button', { name: 'Alpha' }).click()

    expect(openInPane).toHaveBeenCalledWith(
      { kind: 'note', path: 'notes/alpha.md' },
      { from: 'pane-left' },
    )
    expect(route(view)).toEqual({ kind: 'allNotes', filter: { kind: 'all' } })
  })

  it('sends a plain click to the pane that already holds the target', async () => {
    // A tab key lives in at most one pane: navigating in place here would
    // open a second editor session on the same path.
    useOptionalPanes.mockReturnValue({ openInPane, holderOf })
    holderOf.mockReturnValue('pane-right')
    usePaneId.mockReturnValue('pane-left')
    const view = await render(<Harness openInSplit={false} />)

    await view.getByRole('button', { name: 'Alpha' }).click()

    expect(openInPane).toHaveBeenCalledWith(
      { kind: 'note', path: 'notes/alpha.md' },
      { from: 'pane-left' },
    )
    expect(route(view)).toEqual({ kind: 'allNotes', filter: { kind: 'all' } })
  })

  it('navigates in place on a plain click when this pane already holds it', async () => {
    useOptionalPanes.mockReturnValue({ openInPane, holderOf })
    holderOf.mockReturnValue('pane-left')
    usePaneId.mockReturnValue('pane-left')
    const view = await render(<Harness openInSplit={false} />)

    await view.getByRole('button', { name: 'Alpha' }).click()

    await expect.poll(() => route(view)).toEqual({ kind: 'note', path: 'notes/alpha.md' })
    expect(openInPane).not.toHaveBeenCalled()
  })
})
