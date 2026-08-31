import { describe, expect, it } from 'vitest'
import { frontmatterPatchToYaml } from './note-session-frontmatter'

describe('frontmatterPatchToYaml', () => {
  it('serializes a schema property field-by-field without dropping any', () => {
    // The block is spelled out key-by-key on purpose, which is exactly how a
    // newly added schema field goes missing: the typed relation target was
    // silently dropped here once, surviving the dialog but never the save.
    expect(
      frontmatterPatchToYaml({
        tagSchema: [
          { name: 'Company', key: 'company', type: 'relation', target: 'company' },
          { name: 'Status', key: 'status', type: 'select', options: ['to-read'] },
        ],
      }),
    ).toEqual({
      lore: 'tag',
      properties: [
        { name: 'Company', key: 'company', type: 'relation', target: 'company' },
        { name: 'Status', key: 'status', type: 'select', options: ['to-read'] },
      ],
    })
  })
})
