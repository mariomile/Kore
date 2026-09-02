import { useState, type ReactElement } from 'react'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { SETTINGS_GROUPS, type SettingsGroupId } from './sections'
import { SettingsNavigator } from './settings-navigator'
import type { VisibleSettingsGroup } from './use-visible-settings-sections'

const GROUPS = SETTINGS_GROUPS as readonly VisibleSettingsGroup[]

function NavigatorHarness(): ReactElement {
  const [activeGroupId, setActiveGroupId] = useState<SettingsGroupId>('general')
  return (
    <SettingsNavigator
      groups={GROUPS}
      activeGroupId={activeGroupId}
      onSelectGroup={setActiveGroupId}
    />
  )
}

describe('SettingsNavigator', () => {
  it('lists every settings page in registry order', async () => {
    await render(<NavigatorHarness />)

    const labels = page
      .getByRole('button')
      .elements()
      .map((button) => button.textContent)
    expect(labels).toEqual(SETTINGS_GROUPS.map((group) => group.title))
  })

  it('marks and changes the active page', async () => {
    await render(<NavigatorHarness />)

    await expect
      .element(page.getByRole('button', { name: 'General' }))
      .toHaveAttribute('aria-current', 'page')

    await page.getByRole('button', { name: 'AI & agents' }).click()

    await expect
      .element(page.getByRole('button', { name: 'AI & agents' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(page.getByRole('button', { name: 'General' }))
      .not.toHaveAttribute('aria-current')
  })
})
