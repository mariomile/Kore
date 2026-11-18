import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { conflictWritePath, useDailyNoteSeed, useWeeklyNoteSeed } from './use-periodic-note-seed'
import { isoWeekFromKey } from '@kore/core'

const readNote = vi.hoisted(() => vi.fn())
const todayIso = vi.hoisted(() => vi.fn(() => '2026-08-22'))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  readNote,
}))
vi.mock('@/lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  todayIso,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({ settings: { dateFormat: 'iso', timeFormat: '24h' } }),
}))

function Probe({ date }: { date: string }): ReactElement {
  const seed = useDailyNoteSeed(date)
  return <pre data-testid="seed">{seed ?? '<none>'}</pre>
}

async function seedFor(date: string): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <Probe date={date} />
    </QueryClientProvider>,
  )
  const element = view.getByTestId('seed')
  await vi.waitFor(() => {
    expect(readNote.mock.calls.length + 1).toBeGreaterThan(0)
  })
  return element.element().textContent ?? ''
}

beforeEach(() => {
  readNote.mockReset().mockResolvedValue('## Focus\n\n## Notes\n')
  todayIso.mockReturnValue('2026-08-22')
})

describe('useDailyNoteSeed', () => {
  it('seeds today from templates/daily.md', async () => {
    const view = await seedFor('2026-08-22')
    await vi.waitFor(() => expect(view).not.toBe(''))
    expect(readNote).toHaveBeenCalledWith('templates/daily.md')
  })

  it('leaves past days unseeded', async () => {
    // A day you never wrote in isn't a daily waiting to be started; painting
    // the skeleton over every empty day behind you rewrites the stream.
    const seed = await seedFor('2026-08-01')
    expect(seed).toBe('<none>')
    expect(readNote).not.toHaveBeenCalled()
  })

  it('leaves days ahead unseeded until that morning', async () => {
    const seed = await seedFor('2026-09-01')
    expect(seed).toBe('<none>')
    expect(readNote).not.toHaveBeenCalled()
  })

  it('yields nothing when the graph has no daily template', async () => {
    readNote.mockRejectedValue(new Error('not found'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <Probe date="2026-08-22" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(readNote).toHaveBeenCalled())
    expect(view.getByTestId('seed').element().textContent).toBe('<none>')
  })

  it('treats a whitespace-only template as no template', async () => {
    readNote.mockResolvedValue('---\ntitle: Daily\n---\n\n   \n')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <Probe date="2026-08-22" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(readNote).toHaveBeenCalled())
    expect(view.getByTestId('seed').element().textContent).toBe('<none>')
  })

  it('expands placeholders against the day the note belongs to', async () => {
    readNote.mockResolvedValue('# {{date}}\n\nLinked: [[{{date:iso}}]]\n')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <Probe date="2026-08-22" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() =>
      expect(view.getByTestId('seed').element().textContent).toContain('2026-08-22'),
    )
  })

  it('strips the template file own frontmatter', async () => {
    readNote.mockResolvedValue('---\ntitle: Daily template\n---\n## Focus\n')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <Probe date="2026-08-22" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() =>
      expect(view.getByTestId('seed').element().textContent).toContain('## Focus'),
    )
    expect(view.getByTestId('seed').element().textContent).not.toContain('Daily template')
  })
})

function WeeklyProbe({ weekKey }: { weekKey: string }): ReactElement {
  const seed = useWeeklyNoteSeed(isoWeekFromKey(weekKey))
  return <pre data-testid="seed">{seed ?? '<none>'}</pre>
}

describe('useWeeklyNoteSeed', () => {
  it('seeds any week from templates/weekly.md, expanded for that week', async () => {
    readNote.mockResolvedValue('# {{title}}\n\nFrom [[{{date:iso}}]]\n')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <WeeklyProbe weekKey="2026-W47" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() =>
      expect(view.getByTestId('seed').element().textContent).toContain('# Week 47'),
    )
    expect(view.getByTestId('seed').element().textContent).toContain('[[2026-11-16]]')
    expect(readNote).toHaveBeenCalledWith('templates/weekly.md')
  })

  it('yields nothing when the vault has no weekly template', async () => {
    readNote.mockRejectedValue(new Error('not found'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <WeeklyProbe weekKey="2026-W47" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(readNote).toHaveBeenCalled())
    expect(view.getByTestId('seed').element().textContent).toBe('<none>')
  })
})

describe('conflictWritePath', () => {
  it('resolves a missing daily against the template, not a file that does not exist', () => {
    expect(conflictWritePath('daily/2026-08-22.md', { missing: true })).toBe('templates/daily.md')
  })

  it('resolves a missing weekly against the weekly template', () => {
    expect(conflictWritePath('weekly/2026-W47.md', { missing: true })).toBe('templates/weekly.md')
  })

  it('resolves an on-disk daily against itself', () => {
    expect(conflictWritePath('daily/2026-08-22.md', { missing: false })).toBe('daily/2026-08-22.md')
  })

  it('leaves ordinary notes on their own path', () => {
    expect(conflictWritePath('notes/clash.md', { missing: true })).toBe('notes/clash.md')
  })
})
