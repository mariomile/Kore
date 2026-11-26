import { render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setIndexProgress } from '@/lib/index-progress'
import { publishKeyboardHeight } from '@/mobile/use-keyboard'
import type { Route } from '@/routing/route'
import { RouterProvider } from '@/routing/router'
import { IndexProgressPill } from './index-progress-pill'

function renderPill(initialRoute: Route = { kind: 'today' }) {
  return render(
    <RouterProvider initialRoute={initialRoute}>
      <IndexProgressPill />
    </RouterProvider>,
  )
}

/**
 * The "Preparing notes…" pill gates on the pass doing real work (`worked` =
 * files actually read), not on graph size: a reconcile sweeps the whole
 * listing on every open and resume, so `done`/`total` alone would show the
 * pill every single time even when everything skips read-free.
 */

beforeEach(() => {
  publishKeyboardHeight(0)
})

afterEach(() => {
  setIndexProgress(null)
})

describe('IndexProgressPill', () => {
  it('stays hidden for a skip-everything pass, however large the graph', async () => {
    setIndexProgress({ done: 3_500, total: 7_000, worked: 0, fromEmpty: true })
    const view = await renderPill()
    expect(view.getByRole('status').query()).toBeNull()
  })

  it('appears once a pass has actually read enough files (a first index)', async () => {
    setIndexProgress({ done: 160, total: 7_000, worked: 160, fromEmpty: true })
    const view = await renderPill()
    await expect.element(view.getByRole('status')).toHaveTextContent('160 of 7,000')
  })

  it('stays hidden while a refresh re-reads every note over a usable index', async () => {
    // After an app update the whole vault is re-read, but the previous rows
    // keep serving lists, search and backlinks: nothing to announce.
    setIndexProgress({ done: 2_416, total: 4_679, worked: 2_416, fromEmpty: false })
    const view = await renderPill()
    expect(view.getByRole('status').query()).toBeNull()
  })

  it('stays hidden below the work threshold — a routine sync of a few notes', async () => {
    setIndexProgress({ done: 6_900, total: 7_000, worked: 40, fromEmpty: true })
    const view = await renderPill()
    expect(view.getByRole('status').query()).toBeNull()
  })

  it('stays hidden on a small graph even when every file is read', async () => {
    setIndexProgress({ done: 90, total: 90, worked: 90, fromEmpty: true })
    const view = await renderPill()
    expect(view.getByRole('status').query()).toBeNull()
  })

  it('yields to the keyboard', async () => {
    setIndexProgress({ done: 500, total: 7_000, worked: 500, fromEmpty: true })
    publishKeyboardHeight(300)
    const view = await renderPill()
    expect(view.getByRole('status').query()).toBeNull()
  })

  it('stays hidden on Insights, where the first look shows the same pass', async () => {
    setIndexProgress({ done: 500, total: 7_000, worked: 500, fromEmpty: true })
    const view = await renderPill({ kind: 'insights' })
    expect(view.getByRole('status').query()).toBeNull()
  })
})
