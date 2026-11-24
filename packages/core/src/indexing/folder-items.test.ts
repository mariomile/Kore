import { describe, expect, it } from 'vitest'
import { filterLooseFiles, looseFileTitle, mergeFolderItems } from './folder-items'
import type { LooseFile } from './loose-files'

function note(path: string, title: string, mtime: number, isPinned = false) {
  return { path, title, mtime, isPinned }
}

function file(path: string, modifiedMs: number, kind: LooseFile['kind'] = 'pdf'): LooseFile {
  const name = path.split('/').at(-1) ?? path
  return { path, name, extension: name.split('.').at(-1) ?? '', kind, size: 1, modifiedMs }
}

describe('mergeFolderItems', () => {
  it('places files among notes by date, pinned notes first', () => {
    const items = mergeFolderItems(
      [note('p.md', 'Pinned', 1, true), note('a.md', 'A', 30), note('b.md', 'B', 10)],
      [file('deck.pdf', 20), file('old.pdf', 5)],
      'updated-desc',
    )
    expect(items.map((item) => item.path)).toEqual(['p.md', 'a.md', 'deck.pdf', 'b.md', 'old.pdf'])
  })

  it('sorts a page by its file name without the extension', () => {
    const items = mergeFolderItems(
      [note('m.md', 'Mango', 1)],
      [file('apple.html', 1, 'html'), file('zebra.pdf', 1)],
      'title-asc',
    )
    expect(items.map((item) => item.path)).toEqual(['apple.html', 'm.md', 'zebra.pdf'])
  })

  it('keeps the notes untouched without files', () => {
    const notes = [note('b.md', 'B', 1), note('a.md', 'A', 2)]
    expect(mergeFolderItems(notes, [], 'updated-desc').map((item) => item.path)).toEqual([
      'b.md',
      'a.md',
    ])
  })
})

describe('loose file names', () => {
  it('titles a page without its extension', () => {
    expect(looseFileTitle(file('x/report.html', 1, 'html'))).toBe('report')
    expect(looseFileTitle(file('x/deck.pdf', 1))).toBe('deck.pdf')
  })

  it('filters by the file name', () => {
    const files = [file('Brand deck.pdf', 1), file('budget.xlsx', 1, 'sheet')]
    expect(filterLooseFiles(files, 'brand').map((f) => f.name)).toEqual(['Brand deck.pdf'])
    expect(filterLooseFiles(files, '')).toBe(files)
  })
})
