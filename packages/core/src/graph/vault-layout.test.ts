import { afterEach, describe, expect, it } from 'vitest'
import { resolveAttachmentSource, setAttachmentIndex } from './attachment-index'
import { dailyPath, dailyPathPattern, dateFromDailyPath, isDaily } from './paths'
import {
  DEFAULT_VAULT_LAYOUT,
  parseDailyFormat,
  setVaultLayout,
  vaultLayoutFromObsidian,
  vaultLayoutIndexKey,
} from './vault-layout'

afterEach(() => {
  setVaultLayout(DEFAULT_VAULT_LAYOUT)
  setAttachmentIndex(null)
})

const MARIOVERSE = vaultLayoutFromObsidian({
  dailyNotes: JSON.stringify({
    folder: 'Journal/Daily',
    format: 'DD-MM-YYYY',
    template: '_system/templates/Daily-Note',
  }),
  app: JSON.stringify({ attachmentFolderPath: 'Resources/_attachments', newFileLocation: 'folder' }),
})

describe('vaultLayoutFromObsidian', () => {
  it('adopts the daily-notes folder and format and the attachment folder', () => {
    expect(MARIOVERSE).toEqual({
      dailyFolder: 'Journal/Daily',
      dailyFormat: 'DD-MM-YYYY',
      attachmentFolder: 'Resources/_attachments',
    })
  })

  it('keeps Kore’s layout without usable Obsidian settings', () => {
    expect(vaultLayoutFromObsidian({ dailyNotes: null, app: null })).toEqual(DEFAULT_VAULT_LAYOUT)
    expect(
      vaultLayoutFromObsidian({
        dailyNotes: '{not json',
        app: JSON.stringify({ attachmentFolderPath: './' }),
      }),
    ).toEqual(DEFAULT_VAULT_LAYOUT)
    // A format that can't name one file per day, or an unsafe folder.
    expect(
      vaultLayoutFromObsidian({ dailyNotes: JSON.stringify({ format: 'dddd' }), app: null }),
    ).toEqual(DEFAULT_VAULT_LAYOUT)
    expect(
      vaultLayoutFromObsidian({ dailyNotes: JSON.stringify({ folder: '../x' }), app: null }),
    ).toEqual(DEFAULT_VAULT_LAYOUT)
  })

  it('fills Obsidian’s own defaults for omitted keys (vault root, ISO)', () => {
    expect(vaultLayoutFromObsidian({ dailyNotes: '{}', app: null })).toMatchObject({
      dailyFolder: '',
      dailyFormat: 'YYYY-MM-DD',
    })
  })
})

describe('parseDailyFormat', () => {
  it('rejects tokens Kore cannot round-trip', () => {
    expect(parseDailyFormat('YYYY/MM/DD [Journal]')).not.toBeNull()
    expect(parseDailyFormat('YY-MM-DD')).toBeNull()
    expect(parseDailyFormat('YYYY-MMMM-DD')).toBeNull()
    expect(parseDailyFormat('YYYY-MM')).toBeNull()
  })
})

describe('daily paths under an adopted layout', () => {
  it('builds and recognizes the vault’s own daily files', () => {
    setVaultLayout(MARIOVERSE)
    expect(dailyPath('2026-10-09')).toBe('Journal/Daily/09-10-2026.md')
    expect(dateFromDailyPath('Journal/Daily/09-10-2026.md')).toBe('2026-10-09')
    expect(isDaily('Journal/Daily/09-10-2026.md')).toBe(true)
    expect(isDaily('daily/2026-10-09.md')).toBe(false)
    expect(isDaily('Journal/Daily/Weekly review.md')).toBe(false)
    expect(dailyPathPattern()).toBe('Journal/Daily/DD-MM-YYYY.md')
    expect(vaultLayoutIndexKey()).toBe('daily=Journal/Daily/DD-MM-YYYY')
  })

  it('requires the exact spelling of unpadded formats', () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, dailyFolder: '', dailyFormat: 'D.M.YYYY' })
    expect(dailyPath('2026-03-05')).toBe('5.3.2026.md')
    expect(dateFromDailyPath('5.3.2026.md')).toBe('2026-03-05')
    expect(dateFromDailyPath('05.03.2026.md')).toBeNull()
  })

  it('leaves Kore’s default index stamp unchanged', () => {
    expect(vaultLayoutIndexKey()).toBe('')
    expect(dailyPath('2026-10-09')).toBe('daily/2026-10-09.md')
  })
})

describe('resolveAttachmentSource', () => {
  it('finds bare and partial Obsidian embeds anywhere in the vault', () => {
    setVaultLayout(MARIOVERSE)
    setAttachmentIndex([
      'Resources/_attachments/Photo.png',
      'Knowledge/img/Photo.png',
      'Knowledge/img/2024/chart.png',
    ])
    expect(resolveAttachmentSource('photo.png')).toBe('Resources/_attachments/Photo.png')
    expect(resolveAttachmentSource('2024/chart.png')).toBe('Knowledge/img/2024/chart.png')
    expect(resolveAttachmentSource('Knowledge/img/Photo.png')).toBe('Knowledge/img/Photo.png')
    expect(resolveAttachmentSource('Resources/_attachments/my%20scan.pdf')).toBe(
      'Resources/_attachments/my scan.pdf',
    )
    // Not in the catalog yet: the attachment folder is the best guess.
    expect(resolveAttachmentSource('pasted.png')).toBe('Resources/_attachments/pasted.png')
  })

  it('refuses remote, note, and unsafe sources', () => {
    expect(resolveAttachmentSource('https://example.com/x.png')).toBeNull()
    expect(resolveAttachmentSource('notes/x.md')).toBeNull()
    expect(resolveAttachmentSource('assets/../secret.png')).toBeNull()
    expect(resolveAttachmentSource('x.png')).toBeNull()
    expect(resolveAttachmentSource('assets/x.png')).toBe('assets/x.png')
  })
})
