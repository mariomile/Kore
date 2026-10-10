import { afterEach, describe, expect, it } from 'vitest'
import { titleFileStem } from '../markdown/slug'
import { resolveAttachmentSource, setAttachmentIndex } from './attachment-index'
import { isUntitledNotePath, untitledNotePath } from './create-note'
import { isReflectManagedNotePath } from './note-management'
import {
  collisionStem,
  dailyPath,
  dailyPathPattern,
  dateFromDailyPath,
  isDaily,
  isTemplatePath,
  notePath,
  noteFileStemForTitle,
  templatePath,
} from './paths'
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
  app: JSON.stringify({
    attachmentFolderPath: 'Resources/_attachments',
    newFileLocation: 'folder',
    newFileFolderPath: '_inbox',
  }),
  templates: JSON.stringify({ folder: '_system/templates', dateFormat: 'DD-MM-YYYY' }),
})

describe('vaultLayoutFromObsidian', () => {
  it('adopts the daily-notes folder and format and the attachment folder', () => {
    expect(MARIOVERSE).toEqual({
      dailyFolder: 'Journal/Daily',
      dailyFormat: 'DD-MM-YYYY',
      dailyTemplate: '_system/templates/Daily-Note.md',
      attachmentFolder: 'Resources/_attachments',
      newNoteFolder: '_inbox',
      noteFileNames: 'title',
      templatesFolder: '_system/templates',
      templateDateFormat: 'DD-MM-YYYY',
      templateTimeFormat: 'HH:mm',
    })
  })

  it('never makes the vault root the templates folder', () => {
    expect(
      vaultLayoutFromObsidian({ dailyNotes: null, app: null, templates: '{"folder":"/"}' }),
    ).toMatchObject({ templatesFolder: 'templates', templateDateFormat: 'YYYY-MM-DD' })
  })

  it('keeps Kore’s layout without usable Obsidian settings', () => {
    expect(vaultLayoutFromObsidian({ dailyNotes: null, app: null })).toEqual(DEFAULT_VAULT_LAYOUT)
    expect(
      vaultLayoutFromObsidian({
        dailyNotes: '{not json',
        app: JSON.stringify({ attachmentFolderPath: './', newFileLocation: 'current' }),
      }),
    ).toEqual({ ...DEFAULT_VAULT_LAYOUT, noteFileNames: 'title' })
    // A format that can't name one file per day, or an unsafe folder.
    expect(
      vaultLayoutFromObsidian({ dailyNotes: JSON.stringify({ format: 'dddd' }), app: null }),
    ).toEqual(DEFAULT_VAULT_LAYOUT)
    expect(
      vaultLayoutFromObsidian({ dailyNotes: JSON.stringify({ folder: '../x' }), app: null }),
    ).toEqual(DEFAULT_VAULT_LAYOUT)
    // A format whose literals would climb out of the vault or into a hidden folder.
    for (const format of [
      '[../../tmp/]YYYY-MM-DD',
      'YYYY/../../MM/DD',
      '/YYYY-MM-DD',
      '[.hidden/]YYYY-MM-DD',
      String.raw`YYYY\MM\DD`,
    ]) {
      expect(
        vaultLayoutFromObsidian({ dailyNotes: JSON.stringify({ format }), app: null }),
      ).toEqual(DEFAULT_VAULT_LAYOUT)
    }
    expect(
      vaultLayoutFromObsidian({ dailyNotes: JSON.stringify({ format: 'YYYY/MM/DD' }), app: null }),
    ).toMatchObject({ dailyFolder: '', dailyFormat: 'YYYY/MM/DD' })
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
    expect(vaultLayoutIndexKey()).toBe('daily=Journal/Daily/DD-MM-YYYY;templates=_system/templates')
  })

  it('treats the vault’s templates folder as templates', () => {
    setVaultLayout(MARIOVERSE)
    expect(isTemplatePath('_system/templates/Person.md')).toBe(true)
    expect(isTemplatePath('templates/person.md')).toBe(false)
    expect(templatePath('Meeting')).toBe('_system/templates/Meeting.md')
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

describe('new notes under an adopted layout', () => {
  it('lands title-named notes in the vault’s new-note folder', () => {
    setVaultLayout(MARIOVERSE)
    expect(notePath(noteFileStemForTitle('Q3: plan / budget?'))).toBe('_inbox/Q3 plan budget.md')
    expect(collisionStem('Meeting Notes', 2)).toBe('Meeting Notes 2')
    const untitled = untitledNotePath()
    expect(untitled.startsWith('_inbox/')).toBe(true)
    expect(isUntitledNotePath(untitled)).toBe(true)
    expect(isReflectManagedNotePath('_inbox/Meeting Notes.md')).toBe(true)
    expect(isReflectManagedNotePath('notes/meeting-notes.md')).toBe(false)
  })

  it('keeps Kore’s slugs in Kore’s layout', () => {
    expect(notePath(noteFileStemForTitle('Meeting Notes'))).toBe('notes/meeting-notes.md')
    expect(collisionStem('meeting-notes', 2)).toBe('meeting-notes-2')
  })
})

describe('titleFileStem', () => {
  it('keeps the title, minus what a filename or wiki link cannot carry', () => {
    expect(titleFileStem('Meeting Notes')).toBe('Meeting Notes')
    expect(titleFileStem('[[Links]] #tag ^ref | x')).toBe('Links tag ref x')
    expect(titleFileStem('.hidden')).toBe('hidden')
    expect(titleFileStem('???')).toBe('Untitled')
    expect(titleFileStem('CON')).toBe('CON note')
  })
})
