import { describe, expect, it } from 'vitest'
import { isFolderNoteHome, typedNoteFolder, typeHomeFolder } from './type-folder'

describe('typedNoteFolder', () => {
  it('uses a plain home as is', () => {
    expect(typedNoteFolder('CRM/People', 'Ada')).toBe('CRM/People')
    expect(isFolderNoteHome('CRM/People')).toBe(false)
  })

  it('gives each note its own folder under a {title} home', () => {
    expect(typedNoteFolder('Active/Projects/{title}', 'Kore Cloud')).toBe(
      'Active/Projects/Kore Cloud',
    )
    expect(typeHomeFolder('Active/Projects/{title}')).toBe('Active/Projects')
  })
})
