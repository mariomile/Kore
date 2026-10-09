import { errorMessage } from '../errors'
import { readObsidianConfig } from './commands'
import {
  DEFAULT_VAULT_LAYOUT,
  setVaultLayout,
  vaultLayoutFromObsidian,
  type VaultLayout,
} from './vault-layout'

/**
 * Read the open graph's `.obsidian` settings and install the layout they
 * declare (Kore's own when there are none). Call once per graph open, before
 * the index syncs or any daily route resolves. Never rejects: a failed read
 * keeps Kore's default layout rather than blocking the open.
 */
export async function loadVaultLayout(generation?: number): Promise<VaultLayout> {
  let layout = DEFAULT_VAULT_LAYOUT
  try {
    layout = vaultLayoutFromObsidian(await readObsidianConfig(generation))
  } catch (cause) {
    console.error('vault layout: could not read .obsidian settings:', errorMessage(cause))
  }
  setVaultLayout(layout)
  return layout
}
