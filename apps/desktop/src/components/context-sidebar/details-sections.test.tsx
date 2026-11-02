import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useSyncExternalStore } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@reflect/core'
import { DetailsSections } from './details-sections'
import { SidebarSection } from './sidebar-section'

// A tiny live settings store: the arrangement re-renders on every write,
// the way the real provider applies settings instantly.
const store = vi.hoisted(() => ({
  settings: null as unknown as Settings,
  listeners: new Set<() => void>(),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => {
    const settings = useSyncExternalStore(
      (listener) => {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      () => store.settings,
    )
    return {
      settings,
      updateSettingsWith: (updater: (current: Settings) => Partial<Settings>) => {
        store.settings = { ...store.settings, ...updater(store.settings) }
        for (const listener of store.listeners) listener()
      },
    }
  },
}))

function section(id: 'tasks' | 'outline' | 'history', title: string) {
  return {
    id,
    title,
    node: (
      <SidebarSection storageKey={id} title={title}>
        <p>{title} body</p>
      </SidebarSection>
    ),
  }
}

const SECTIONS = [
  section('tasks', 'Tasks'),
  section('outline', 'Outline'),
  section('history', 'History'),
]

function headers(container: HTMLElement): string[] {
  return [...container.querySelectorAll('section')].map(
    (node) => node.getAttribute('aria-label') ?? '',
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  store.settings = DEFAULT_SETTINGS
})

describe('DetailsSections', () => {
  it('stacks sections in the stored order and moves one from its menu', async () => {
    store.settings = {
      ...DEFAULT_SETTINGS,
      detailsSections: [
        'history',
        ...DEFAULT_SETTINGS.detailsSections.filter((id) => id !== 'history'),
      ],
    }
    const view = await render(<DetailsSections sections={SECTIONS} />)
    expect(headers(view.container)).toEqual(['History', 'Tasks', 'Outline'])

    await userEvent.click(view.getByRole('button', { name: 'Tasks options' }))
    await userEvent.click(view.getByRole('menuitem', { name: 'Move down' }))
    await vi.waitFor(() => expect(headers(view.container)).toEqual(['History', 'Outline', 'Tasks']))
    await view.unmount()
  })

  it('hides a section and brings it back from the hidden menu', async () => {
    const view = await render(<DetailsSections sections={SECTIONS} />)
    await userEvent.click(view.getByRole('button', { name: 'Outline options' }))
    await userEvent.click(view.getByRole('menuitem', { name: 'Hide section' }))
    await vi.waitFor(() => expect(headers(view.container)).toEqual(['Tasks', 'History']))
    expect(store.settings.hiddenDetailsSections).toEqual(['outline'])

    await userEvent.click(view.getByRole('button', { name: '1 hidden section' }))
    await userEvent.click(view.getByRole('menuitem', { name: 'Show Outline' }))
    await vi.waitFor(() => expect(headers(view.container)).toEqual(['Tasks', 'Outline', 'History']))
    await view.unmount()
  })
})
