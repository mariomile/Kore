import { describe, expect, it } from 'vitest'
import { filterLooseFilesByKind } from './file-kind-filter'
import type { LooseFile, LooseFileKind } from './loose-files'

function file(name: string, kind: LooseFileKind): LooseFile {
  return {
    path: `Jobs/${name}`,
    name,
    extension: name.split('.').at(-1)!,
    kind,
    size: 1,
    modifiedMs: 1,
  }
}

describe('filterLooseFilesByKind', () => {
  const files = [
    file('Application board.base', 'base'),
    file('Map.canvas', 'canvas'),
    file('cv.pdf', 'pdf'),
    file('notes.txt', 'document'),
  ]

  it('keeps bases and canvases under their own filter, not under other files', () => {
    expect(filterLooseFilesByKind(files, 'views').map((entry) => entry.name)).toEqual([
      'Application board.base',
      'Map.canvas',
    ])
    expect(filterLooseFilesByKind(files, 'other').map((entry) => entry.name)).toEqual(['notes.txt'])
  })
})
