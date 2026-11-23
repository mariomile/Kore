import { render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@kore/core'
import {
  clearSemanticExclusions,
  getSemanticExclusions,
  loadSemanticExclusions,
} from '@/lib/semantic-exclusions'
import { SemanticExcludedFoldersField } from './semantic-excluded-folders-field'

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { generation: 5 } }),
}))
vi.mock('@/hooks/use-vault-folders', () => ({
  useVaultFolders: () => ['Active', 'Input', 'Input/Granola', 'Input/Granola/Transcripts'],
}))

/** The vault's `.kore.json` as the fake bridge holds it; `null` = no file. */
let file: string | null

function stored(): unknown {
  return file === null ? null : JSON.parse(file)
}

beforeEach(async () => {
  file = JSON.stringify({
    integrations: { granola: { folder: 'Input/Granola' } },
    semantic: { excludeFolders: ['Input/Granola'] },
  })
  setBridge({
    invoke: (command, args) => {
      if (command === 'vault_settings_read') {
        return file === null
          ? Promise.reject({ kind: 'notFound', message: 'no settings file' })
          : Promise.resolve(file)
      }
      if (command === 'vault_settings_write') {
        file = String(args['contents'])
        return Promise.resolve(null)
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    },
    listen: () => Promise.resolve(() => {}),
  })
  await loadSemanticExclusions(5, () => false)
})

afterEach(() => {
  clearSemanticExclusions()
  setBridge(null)
})

describe('SemanticExcludedFoldersField', () => {
  it('lists the vault’s excluded folders', async () => {
    const view = await render(<SemanticExcludedFoldersField />)
    await expect
      .element(view.getByRole('list', { name: 'Excluded folders' }))
      .toHaveTextContent('Input/Granola')
  })

  it('offers only folders an excluded parent does not already cover', async () => {
    const view = await render(<SemanticExcludedFoldersField />)
    await view.getByRole('combobox', { name: 'Exclude a folder' }).click()
    await expect.element(view.getByRole('option', { name: 'Active' })).toBeVisible()
    await expect.element(view.getByRole('option', { name: 'Input', exact: true })).toBeVisible()
    expect(view.getByRole('option', { name: 'Input/Granola', exact: true }).query()).toBeNull()
    expect(view.getByRole('option', { name: 'Input/Granola/Transcripts' }).query()).toBeNull()
  })

  it('excludes a picked folder and writes it into the vault file, keeping its other keys', async () => {
    const view = await render(<SemanticExcludedFoldersField />)
    await view.getByRole('combobox', { name: 'Exclude a folder' }).click()
    await view.getByRole('option', { name: 'Active' }).click()
    await vi.waitFor(() =>
      expect(stored()).toEqual({
        integrations: { granola: { folder: 'Input/Granola' } },
        semantic: { excludeFolders: ['Active', 'Input/Granola'] },
      }),
    )
    expect(getSemanticExclusions()).toEqual(['Active', 'Input/Granola'])
  })

  it('lets a folder back in', async () => {
    const view = await render(<SemanticExcludedFoldersField />)
    await view.getByRole('button', { name: 'Include Input/Granola again' }).click()
    await vi.waitFor(() => expect(stored()).toMatchObject({ semantic: { excludeFolders: [] } }))
    expect(view.getByRole('list', { name: 'Excluded folders' }).query()).toBeNull()
  })

  it('puts the list back and says so when the vault file cannot be written', async () => {
    const view = await render(<SemanticExcludedFoldersField />)
    file = '{ not json'
    await view.getByRole('button', { name: 'Include Input/Granola again' }).click()
    await vi.waitFor(() => expect(getSemanticExclusions()).toEqual(['Input/Granola']))
    expect(file).toBe('{ not json')
  })

  it('renders nothing while the vault’s list is unread', async () => {
    clearSemanticExclusions()
    const view = await render(<SemanticExcludedFoldersField />)
    expect(view.getByText('Excluded folders').query()).toBeNull()
  })
})
