import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, settingsSchema } from './schema'
import { pasteCollects } from './schema-paste'

describe('pasted resource settings', () => {
  it('collect nothing by default and keep link text once links are on', () => {
    expect(DEFAULT_SETTINGS.pasteCollectLinks).toBe(false)
    expect(DEFAULT_SETTINGS.pasteCollectImages).toBe(false)
    expect(DEFAULT_SETTINGS.pasteCollectPdfs).toBe(false)
    expect(DEFAULT_SETTINGS.pasteCollectFiles).toBe(false)
    expect(DEFAULT_SETTINGS.pasteSaveLinkText).toBe(true)
  })

  it('degrade invalid values to their defaults', () => {
    const parsed = settingsSchema.parse({
      pasteCollectLinks: 'yes',
      pasteSaveLinkText: 1,
    })
    expect(parsed.pasteCollectLinks).toBe(false)
    expect(parsed.pasteSaveLinkText).toBe(true)
  })

  it('maps each resource kind to its own switch', () => {
    const settings = settingsSchema.parse({
      pasteCollectLinks: true,
      pasteCollectPdfs: true,
    })
    expect(pasteCollects(settings, 'link')).toBe(true)
    expect(pasteCollects(settings, 'image')).toBe(false)
    expect(pasteCollects(settings, 'pdf')).toBe(true)
    expect(pasteCollects(settings, 'file')).toBe(false)
  })
})
