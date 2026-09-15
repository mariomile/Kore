import { describe, expect, it } from 'vitest'
import {
  applyNoteEdit,
  EDIT_NO_CHANGE_ERROR,
  EDIT_TEXT_AMBIGUOUS_ERROR,
  EDIT_TEXT_NOT_FOUND_ERROR,
} from './note-edit'
import { PRIVATE_NOTE_EDIT_ERROR } from './tools-io'

const NOTE =
  '---\ntitle: Atlas\nprivate: false\n---\n# Atlas\n\n- call the surveyor\n- book flights\n'

describe('applyNoteEdit', () => {
  it('replaces the one matching passage and leaves the frontmatter alone', () => {
    const result = applyNoteEdit(NOTE, {
      oldText: '- call the surveyor',
      newText: '- [ ] call the surveyor [[House]]',
    })
    expect(result).toEqual({
      ok: true,
      after:
        '---\ntitle: Atlas\nprivate: false\n---\n# Atlas\n\n- [ ] call the surveyor [[House]]\n- book flights\n',
    })
  })

  it('refuses text that is missing, ambiguous, or unchanged', () => {
    expect(applyNoteEdit(NOTE, { oldText: 'not here', newText: 'x' })).toEqual({
      ok: false,
      error: EDIT_TEXT_NOT_FOUND_ERROR,
    })
    expect(applyNoteEdit(NOTE, { oldText: '- ', newText: '* ' })).toEqual({
      ok: false,
      error: EDIT_TEXT_AMBIGUOUS_ERROR,
    })
    expect(applyNoteEdit(NOTE, { oldText: '# Atlas', newText: '# Atlas' })).toEqual({
      ok: false,
      error: EDIT_NO_CHANGE_ERROR,
    })
  })

  it('refuses a note that is private now, whatever the edit', () => {
    const source = '---\nprivate: true\n---\n# Diary\n\n- one\n'
    expect(applyNoteEdit(source, { oldText: '- one', newText: '- uno' })).toEqual({
      ok: false,
      error: PRIVATE_NOTE_EDIT_ERROR,
    })
    expect(applyNoteEdit(source, { oldText: '', newText: '- two\n' })).toEqual({
      ok: false,
      error: PRIVATE_NOTE_EDIT_ERROR,
    })
  })

  it('never matches inside the frontmatter — the model only ever saw the body', () => {
    expect(applyNoteEdit(NOTE, { oldText: 'private: false', newText: 'private: true' })).toEqual({
      ok: false,
      error: EDIT_TEXT_NOT_FOUND_ERROR,
    })
  })

  it('appends on an empty oldText, starting a new line when the body lacks one', () => {
    expect(applyNoteEdit('# Day\n- one', { oldText: '', newText: '- two\n' })).toEqual({
      ok: true,
      after: '# Day\n- one\n- two\n',
    })
    expect(applyNoteEdit('# Day\n- one\n', { oldText: '', newText: '- two\n' })).toEqual({
      ok: true,
      after: '# Day\n- one\n- two\n',
    })
    expect(applyNoteEdit('', { oldText: '', newText: '- two\n' })).toEqual({
      ok: true,
      after: '- two\n',
    })
  })

  it('treats replacement patterns literally', () => {
    expect(applyNoteEdit('price: 5', { oldText: '5', newText: '$& and $1' })).toEqual({
      ok: true,
      after: 'price: $& and $1',
    })
  })
})
