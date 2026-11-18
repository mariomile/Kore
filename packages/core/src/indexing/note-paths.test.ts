import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, setVaultLayout } from '../graph/vault-layout'
import {
  availableTemplatePath,
  slugPathForTitle,
  templateSlugPathForTitle,
  titleFilePathForRetitle,
} from './note-paths'

describe('availableTemplatePath', () => {
  it('probes under templates/ with the same collision suffix', async () => {
    const occupied = new Set(['templates/journal.md'])
    await expect(
      availableTemplatePath('journal', async (path) => occupied.has(path)),
    ).resolves.toBe('templates/journal-2.md')
  })
})

describe('templateSlugPathForTitle', () => {
  it('returns the template’s own path unchanged when the name already matches', async () => {
    const probe = vi.fn(async () => true)
    await expect(templateSlugPathForTitle('templates/journal.md', 'Journal', probe)).resolves.toBe(
      'templates/journal.md',
    )
    // Its own path is never probed — a no-op rename must not move onto `-2`.
    expect(probe).not.toHaveBeenCalled()
  })

  it('suffixes around occupied candidates', async () => {
    const occupied = new Set(['templates/log.md'])
    await expect(
      templateSlugPathForTitle('templates/journal.md', 'Log', async (path) => occupied.has(path)),
    ).resolves.toBe('templates/log-2.md')
  })
})

describe('slugPathForTitle', () => {
  const taken = (occupied: string[]) => async (path: string) => occupied.includes(path)

  it('returns the slug path when free', async () => {
    await expect(slugPathForTitle('notes/01abc.md', 'Meeting Notes', taken([]))).resolves.toBe(
      'notes/meeting-notes.md',
    )
  })

  it('returns the current path unchanged when the name already matches', async () => {
    const probe = vi.fn(taken([]))
    await expect(slugPathForTitle('notes/meeting-notes.md', 'Meeting Notes', probe)).resolves.toBe(
      'notes/meeting-notes.md',
    )
    // Its own path is never probed — a note can't collide with itself.
    expect(probe).not.toHaveBeenCalled()
  })

  it('a suffixed home still counts as already-named (no tightening moves)', async () => {
    await expect(
      slugPathForTitle('notes/meeting-2.md', 'Meeting', taken(['notes/meeting.md'])),
    ).resolves.toBe('notes/meeting-2.md')
  })

  it('suffixes around occupied candidates', async () => {
    await expect(
      slugPathForTitle('notes/01abc.md', 'Meeting', taken(['notes/meeting.md'])),
    ).resolves.toBe('notes/meeting-2.md')
  })

  it('suffixes a slug that already ends in an ordinal without ambiguity', async () => {
    await expect(
      slugPathForTitle('notes/01abc.md', 'Meeting 2', taken(['notes/meeting-2.md'])),
    ).resolves.toBe('notes/meeting-2-2.md')
  })

  it('fails loud instead of spinning when nothing is ever free', async () => {
    await expect(slugPathForTitle('notes/01abc.md', 'Meeting', async () => true)).rejects.toThrow(
      /no available note path/,
    )
  })
})

describe('titleFilePathForRetitle', () => {
  const free = async (): Promise<boolean> => false
  const obsidianVault = (): void => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, noteFileNames: 'title', newNoteFolder: '_inbox' })
  }
  afterEach(() => {
    setVaultLayout(DEFAULT_VAULT_LAYOUT)
  })

  it('renames a note named after its title in its own folder, as Obsidian does', async () => {
    obsidianVault()
    await expect(
      titleFilePathForRetitle(
        'Knowledge/AI/Old Title.md',
        { from: 'Old Title', to: 'Q3: plan / budget?' },
        free,
      ),
    ).resolves.toBe('Knowledge/AI/Q3 plan budget.md')
  })

  it('renames a vault-root note at the root', async () => {
    obsidianVault()
    await expect(
      titleFilePathForRetitle('Old Title.md', { from: 'old title', to: 'New Title' }, free),
    ).resolves.toBe('New Title.md')
  })

  it('compares a linked title by the text it shows', async () => {
    obsidianVault()
    await expect(
      titleFilePathForRetitle(
        'Meetings/Meeting with Ada.md',
        { from: 'Meeting with [[Ada]]', to: 'Call with [[Ada|Ada Lovelace]]' },
        free,
      ),
    ).resolves.toBe('Meetings/Call with Ada Lovelace.md')
  })

  it('keeps a file whose title links to the file itself', async () => {
    // Renaming would leave the title pointing at a path that no longer exists.
    obsidianVault()
    await expect(
      titleFilePathForRetitle(
        'Resources/HEART Framework.md',
        {
          from: '[[Resources/HEART Framework|HEART Framework]]',
          to: '[[Resources/HEART Framework|HEART]]',
        },
        free,
      ),
    ).resolves.toBeNull()
  })

  it('suffixes around a same-named file in that folder', async () => {
    obsidianVault()
    const occupied = new Set(['Area/New Title.md'])
    await expect(
      titleFilePathForRetitle(
        'Area/Old Title.md',
        { from: 'Old Title', to: 'New Title' },
        async (path) => occupied.has(path),
      ),
    ).resolves.toBe('Area/New Title 2.md')
  })

  it('leaves a file whose name is not its old title where it is', async () => {
    obsidianVault()
    await expect(
      titleFilePathForRetitle(
        'Job Search/CV Acme.md',
        { from: 'Mario Rossi', to: 'Mario R.' },
        free,
      ),
    ).resolves.toBeNull()
  })

  it('never renames adopted files in a slug vault', async () => {
    await expect(
      titleFilePathForRetitle('Area/Old Title.md', { from: 'Old Title', to: 'New' }, free),
    ).resolves.toBeNull()
  })
})
