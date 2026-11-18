import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { isNotePath } from '@kore/core/cloud/note-rules'
import type { LocalNote } from '@kore/core/cloud/upload'
import { vaultLayoutFromObsidian, type VaultLayout } from '@kore/core/graph/vault-layout'

/** Reading a vault from disk for `kore cloud setup`; the upload rules live in `@kore/core/cloud`. */

/** The vault layout its `.obsidian/` files declare (Kore's default without them). */
export async function readVaultLayout(vault: string): Promise<VaultLayout> {
  const read = async (name: string): Promise<string | null> => {
    try {
      return await readFile(join(vault, '.obsidian', name), 'utf8')
    } catch {
      return null
    }
  }
  const [dailyNotes, app, templates] = await Promise.all([
    read('daily-notes.json'),
    read('app.json'),
    read('templates.json'),
  ])
  return vaultLayoutFromObsidian({ dailyNotes, app, templates })
}

/** Every Markdown note of the vault outside hidden folders, as vault-relative paths. */
export async function readVaultNotes(vault: string): Promise<LocalNote[]> {
  const entries = await readdir(vault, { recursive: true, withFileTypes: true })
  const notes: LocalNote[] = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const absolute = join(entry.parentPath, entry.name)
    const path = relative(vault, absolute).split(sep).join('/')
    if (!isNotePath(path)) {
      continue
    }
    notes.push({ path, source: await readFile(absolute, 'utf8') })
  }
  return notes.sort((left, right) => left.path.localeCompare(right.path))
}
