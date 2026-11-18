import { describe, expect, it } from 'vitest'
import { splitDoc } from './note-session-doc'

describe('splitDoc', () => {
  it('keeps the blank lines after the frontmatter out of the editor body', () => {
    const content = '---\nup: "[[Captoo.io]]"\n---\n\n# Testbook\n\nBody'
    const doc = splitDoc(content)
    expect(doc.body).toBe('# Testbook\n\nBody')
    expect(doc.header + doc.body).toBe(content)
  })

  it('leaves a note without frontmatter untouched', () => {
    expect(splitDoc('\n# Title')).toEqual({ header: '', body: '\n# Title' })
  })
})
