import { describe, expect, it } from 'vitest'
import { mergeNoteText } from './note-merge'

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`

describe('mergeNoteText', () => {
  it('keeps both devices’ additions at the end of a daily note, this device first', () => {
    const base = lines('# 2026-11-18', '', '- Coffee with Luca')
    const ours = lines('# 2026-11-18', '', '- Coffee with Luca', '- Call the bank')
    const theirs = lines('# 2026-11-18', '', '- Coffee with Luca', '- Idea: weekly notes')
    expect(mergeNoteText(base, ours, theirs)).toBe(
      lines('# 2026-11-18', '', '- Coffee with Luca', '- Call the bank', '- Idea: weekly notes'),
    )
  })

  it('merges edits on neighbouring lines', () => {
    const base = lines('- [ ] Book flight', '- [ ] Pay invoice', '- [ ] Email Sara')
    const ours = lines('- [x] Book flight', '- [ ] Pay invoice', '- [ ] Email Sara')
    const theirs = lines('- [ ] Book flight', '- [x] Pay invoice', '- [ ] Email Sara')
    expect(mergeNoteText(base, ours, theirs)).toBe(
      lines('- [x] Book flight', '- [x] Pay invoice', '- [ ] Email Sara'),
    )
  })

  it('merges two different properties edited on two devices', () => {
    const base = lines('---', 'status: draft', 'owner: Mario', '---', 'Body')
    const ours = lines('---', 'status: done', 'owner: Mario', '---', 'Body')
    const theirs = lines('---', 'status: draft', 'owner: Sara', '---', 'Body')
    expect(mergeNoteText(base, ours, theirs)).toBe(
      lines('---', 'status: done', 'owner: Sara', '---', 'Body'),
    )
  })

  it('keeps two new properties added on two devices', () => {
    const base = lines('---', 'title: Plan', '---', 'Body')
    const ours = lines('---', 'title: Plan', 'status: done', '---', 'Body')
    const theirs = lines('---', 'title: Plan', 'area: Work', '---', 'Body')
    expect(mergeNoteText(base, ours, theirs)).toBe(
      lines('---', 'title: Plan', 'status: done', 'area: Work', '---', 'Body'),
    )
  })

  it('declines when both devices add the same property with different values', () => {
    const base = lines('---', 'title: Plan', '---', 'Body')
    const ours = lines('---', 'title: Plan', 'status: done', '---', 'Body')
    const theirs = lines('---', 'title: Plan', 'status: draft', '---', 'Body')
    expect(mergeNoteText(base, ours, theirs)).toBeNull()
  })

  it('declines when the same line changed two different ways', () => {
    const base = lines('Meeting at 10')
    expect(mergeNoteText(base, lines('Meeting at 11'), lines('Meeting at 12'))).toBeNull()
  })

  it('declines an edit against a deletion of the same line', () => {
    const base = lines('Keep', 'Edit me', 'Keep')
    expect(mergeNoteText(base, lines('Keep', 'Edited', 'Keep'), lines('Keep', 'Keep'))).toBeNull()
  })

  it('takes the same edit made on both devices once', () => {
    const base = lines('a', 'b', 'c')
    const both = lines('a', 'B', 'c')
    expect(mergeNoteText(base, both, lines('a', 'B', 'c', 'd'))).toBe(lines('a', 'B', 'c', 'd'))
  })

  it('merges edits far apart in a long note', () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${i}`)
    const ours = [...body]
    ours[10] = 'ours'
    const theirs = [...body]
    theirs[400] = 'theirs'
    const expected = [...body]
    expected[10] = 'ours'
    expected[400] = 'theirs'
    expect(mergeNoteText(lines(...body), lines(...ours), lines(...theirs))).toBe(lines(...expected))
  })

  it('leaves a note that already carries conflict markers alone', () => {
    const marked = lines('<<<<<<< this device', 'a', '=======', 'b', '>>>>>>> other device')
    expect(mergeNoteText(lines('x'), marked, lines('x', 'y'))).toBeNull()
  })

  it('handles a note created on both devices from nothing', () => {
    expect(mergeNoteText('', lines('mine'), lines('theirs'))).toBe(lines('mine', 'theirs'))
  })

  it('reproduces one side exactly when the other did not change (random edits)', () => {
    let seed = 7
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 300; round++) {
      const base = Array.from({ length: random(30) }, () => `l${random(6)}`)
      const edited = [...base]
      for (let edit = random(6); edit > 0; edit--) {
        const at = random(edited.length + 1)
        if (random(2) === 0) {
          edited.splice(at, 1)
        } else {
          edited.splice(at, 0, `n${random(6)}`)
        }
      }
      const a = base.join('\n')
      const b = edited.join('\n')
      expect(mergeNoteText(a, a, b)).toBe(b)
      expect(mergeNoteText(a, b, a)).toBe(b)
    }
  })
})
