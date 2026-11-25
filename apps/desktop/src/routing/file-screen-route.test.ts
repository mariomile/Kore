import { describe, expect, it } from 'vitest'
import { fileScreenRoute } from './file-screen-route'

describe('fileScreenRoute', () => {
  it('opens bases, canvases and pages as their own screens', () => {
    expect(fileScreenRoute('a/Projects.base', 'Table')).toEqual({
      kind: 'base',
      path: 'a/Projects.base',
      view: 'Table',
    })
    expect(fileScreenRoute('Map.canvas')).toEqual({ kind: 'canvas', path: 'Map.canvas' })
    expect(fileScreenRoute('r/report.HTM')).toEqual({ kind: 'html', path: 'r/report.HTM' })
  })

  it('leaves every other file to the viewer or the OS', () => {
    expect(fileScreenRoute('deck.pdf')).toBeNull()
    expect(fileScreenRoute('note.md')).toBeNull()
  })
})
