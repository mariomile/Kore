import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactElement } from 'react'
import { setBridge } from '@kore/core'
import { fireEvent } from '@/test-utils/fire-event'
import '@/test-utils/locator'
import { DailyDay } from './daily-day'
import type { NotePaneProps } from './note-pane'

/**
 * A day of the daily stream draws as static text until it is live, and only
 * when the static view can stand in for the editor exactly. NotePane is a
 * probe here: these tests are about which of the two a day shows.
 */

const settings = vi.hoisted(() => ({ editorMarkdownSyntax: 'hide' as 'hide' | 'show' | 'hybrid' }))
const images = vi.hoisted(() => ({ url: null as string | null }))

vi.mock('@/components/note-pane', () => ({
  NotePane: ({
    path,
    dailyDate,
    registerHandle,
  }: {
    path: string
    dailyDate?: string
    registerHandle?: (date: string, handle: unknown) => void
  }) => {
    // Bind a handle on mount, like the real pane's editor does.
    useEffect(() => {
      if (dailyDate !== undefined) {
        registerHandle?.(dailyDate, { probe: true })
      }
    }, [dailyDate, registerHandle])
    return <div data-testid="pane-probe" data-path={path} />
  },
}))
vi.mock('@/components/backlinks-panel', () => ({ BacklinksPanel: () => null }))
vi.mock('@/components/note-children-panel', () => ({ NoteChildrenPanel: () => null }))
vi.mock('@/components/unlinked-mentions-panel', () => ({ UnlinkedMentionsPanel: () => null }))
vi.mock('@/hooks/use-note-row', () => ({ useNoteRow: () => null }))
vi.mock('@/editor/use-asset-persistence', () => ({
  useAssetPersistence: () => ({ resolveImageUrl: () => images.url }),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 }, indexing: false }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: {
      editorMarkdownSyntax: settings.editorMarkdownSyntax,
      editorDefaultBullet: false,
      browserOpenLinksInApp: false,
    },
  }),
}))

const PATH = 'daily/2026-06-27.md'

function serveNote(source: string | null): void {
  setBridge({
    invoke: async (command) => {
      if (command === 'note_read') {
        if (source === null) {
          throw { kind: 'notFound', message: 'no such note' }
        }
        return source
      }
      return null
    },
    listen: async () => () => {},
  })
}

function Day({
  live,
  onActivate = () => {},
  registerHandle,
}: {
  live: boolean
  onActivate?: (date: string, point: { x: number; y: number }) => void
  registerHandle?: (date: string, handle: unknown) => void
}): ReactElement {
  return (
    <DailyDay
      live={live}
      onActivate={onActivate}
      {...(registerHandle !== undefined
        ? { registerHandle: registerHandle as NonNullable<NotePaneProps['registerHandle']> }
        : {})}
      path={PATH}
      dailyDate="2026-06-27"
      lazy
      gutterClassName="kore-content-gutter"
      editorClassName="min-h-[100px]"
    />
  )
}

async function renderDay(day: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(<QueryClientProvider client={client}>{day}</QueryClientProvider>)
}

const probe = () => page.getByTestId('pane-probe')
const staticDay = () => page.locate('[data-static-day="ready"]')

afterEach(async () => {
  await cleanup()
  settings.editorMarkdownSyntax = 'hide'
  images.url = null
})

describe('DailyDay', () => {
  it('draws a plain day as static text until it is live', async () => {
    serveNote('- met [[Ada]] about the launch\n')
    await renderDay(<Day live={false} />)

    await expect.element(staticDay()).toBeInTheDocument()
    await expect.element(page.getByText('about the launch')).toBeVisible()
    expect(probe().query()).toBeNull()
  })

  it('hands over to the editor without ever showing neither', async () => {
    serveNote('- met [[Ada]] about the launch\n')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const registerHandle = vi.fn()
    const view = await render(
      <QueryClientProvider client={client}>
        <Day live={false} registerHandle={registerHandle} />
      </QueryClientProvider>,
    )
    await expect.element(staticDay()).toBeInTheDocument()

    await view.rerender(
      <QueryClientProvider client={client}>
        <Day live={true} registerHandle={registerHandle} />
      </QueryClientProvider>,
    )
    // The editor mounts under the static drawing, which is still what shows;
    // the stream is not told about the editor yet.
    await expect.element(probe()).toBeInTheDocument()
    expect(staticDay().query()).not.toBeNull()
    expect(registerHandle).not.toHaveBeenCalled()

    // Then the editor takes over, and only now can the stream focus it.
    await vi.waitFor(() => expect(staticDay().query()).toBeNull())
    await expect.element(probe()).toBeInTheDocument()
    expect(registerHandle).toHaveBeenCalledWith('2026-06-27', { probe: true })
  })

  it('draws a day with no file yet as an empty static note', async () => {
    serveNote(null)
    await renderDay(<Day live={false} />)

    await expect.element(staticDay()).toBeInTheDocument()
    expect(probe().query()).toBeNull()
  })

  it('draws a picture in the box the editor gives it', async () => {
    // 400 x 1000: the editor caps the height at 500, so the width halves.
    images.url = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1000"><rect width="100%" height="100%"/></svg>',
    )}`
    serveNote('a photo\n\n![](assets/photo.png)\n')
    await renderDay(<Day live={false} />)

    await expect.element(staticDay()).toBeInTheDocument()
    expect(probe().query()).toBeNull()
    await vi.waitFor(() => {
      const box = staticDay().element().querySelector('img')?.getBoundingClientRect()
      // WebKit lays out in 1/64 px steps, so the height can land a hair short.
      expect(box?.width).toBe(200)
      expect(box?.height).toBeCloseTo(500, 1)
    })
  })

  it('keeps the editor for a day the static view cannot draw exactly', async () => {
    serveNote('a table\n\n| a | b |\n| - | - |\n| 1 | 2 |\n')
    await renderDay(<Day live={false} />)

    await expect.element(probe()).toBeInTheDocument()
    expect(staticDay().query()).toBeNull()
  })

  it('keeps the editor on every day when markdown syntax is always shown', async () => {
    settings.editorMarkdownSyntax = 'show'
    serveNote('plain **text**\n')
    await renderDay(<Day live={false} />)

    await expect.element(probe()).toBeInTheDocument()
  })

  it('asks for its editor, with the pressed point, on a press', async () => {
    serveNote('some text\n')
    const onActivate = vi.fn()
    await renderDay(<Day live={false} onActivate={onActivate} />)
    await expect.element(staticDay()).toBeInTheDocument()

    fireEvent.pointerDown(staticDay().element(), { button: 0, clientX: 40, clientY: 12 })

    expect(onActivate).toHaveBeenCalledWith('2026-06-27', { x: 40, y: 12 })
  })
})
