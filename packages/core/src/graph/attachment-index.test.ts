import { afterEach, describe, expect, it } from 'vitest'
import {
  applyAttachmentChanges,
  resolveAttachmentSource,
  setAttachmentIndex,
} from './attachment-index'
import { DEFAULT_VAULT_LAYOUT, setVaultLayout } from './vault-layout'

const NOTE_DIR = 'Active/Projects/Job Search 2026/attachments'

describe('resolveAttachmentSource', () => {
  afterEach(() => {
    setAttachmentIndex(null)
    setVaultLayout(DEFAULT_VAULT_LAYOUT)
  })

  it('finds a bare embed anywhere in the vault by name', () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, attachmentFolder: 'assets' })
    setAttachmentIndex([`${NOTE_DIR}/flow.png`, 'assets/IMG_5046.png'])
    expect(resolveAttachmentSource('flow.png')).toBe(`${NOTE_DIR}/flow.png`)
    expect(resolveAttachmentSource('IMG_5046.png')).toBe('assets/IMG_5046.png')
  })

  it('resolves a percent-encoded vault path that holds spaces', () => {
    setAttachmentIndex([`${NOTE_DIR}/flow.png`])
    expect(resolveAttachmentSource(encodeURI(`${NOTE_DIR}/flow.png`))).toBe(`${NOTE_DIR}/flow.png`)
  })

  it('finds a bare embed for a file that arrived after the graph opened', () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, attachmentFolder: 'assets' })
    setAttachmentIndex(['assets/old.png'])
    // Before the change the bare name falls back to the attachment folder (a 404).
    expect(resolveAttachmentSource('flow.png')).toBe('assets/flow.png')
    applyAttachmentChanges([
      { path: `${NOTE_DIR}/flow.png`, kind: 'upsert' },
      { path: 'Active/Projects/Job Search 2026/Prep.md', kind: 'upsert' },
    ])
    expect(resolveAttachmentSource('flow.png')).toBe(`${NOTE_DIR}/flow.png`)
  })

  it('forgets a removed attachment', () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, attachmentFolder: 'assets' })
    setAttachmentIndex([`${NOTE_DIR}/flow.png`])
    applyAttachmentChanges([{ path: `${NOTE_DIR}/flow.png`, kind: 'remove' }])
    expect(resolveAttachmentSource('flow.png')).toBe('assets/flow.png')
  })
})
