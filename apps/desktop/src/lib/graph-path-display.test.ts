import { describe, expect, it } from 'vitest'
import { displayGraphPath } from './graph-path-display'

const HOME = '/Users/alex'
const CONTAINER = `${HOME}/Library/Mobile Documents/iCloud~app~lore/Documents`

describe('displayGraphPath', () => {
  it('names the app container after the brand, not its container id', () => {
    expect(displayGraphPath(`${CONTAINER}/Work`, HOME)).toBe('iCloud Drive › Kore › Work')
  })

  it('drops the container plumbing directory', () => {
    expect(displayGraphPath(CONTAINER, HOME)).toBe('iCloud Drive › Kore')
  })

  it('keeps nested folders inside the container', () => {
    expect(displayGraphPath(`${CONTAINER}/Work/Archive`, HOME)).toBe(
      'iCloud Drive › Kore › Work › Archive',
    )
  })

  it('shortens a graph the user put in plain iCloud Drive', () => {
    expect(
      displayGraphPath(`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/Notes`, HOME),
    ).toBe('iCloud Drive › Notes')
  })

  it('rewrites the iCloud container without knowing the home directory', () => {
    expect(displayGraphPath(`${CONTAINER}/Work`)).toBe('iCloud Drive › Kore › Work')
  })

  it('abbreviates a plain path under the home directory', () => {
    expect(displayGraphPath(`${HOME}/Notes/Personal`, HOME)).toBe('~/Notes/Personal')
    expect(displayGraphPath(HOME, HOME)).toBe('~')
  })

  it('leaves a path outside the home directory alone', () => {
    expect(displayGraphPath('/Volumes/SSD/Notes', HOME)).toBe('/Volumes/SSD/Notes')
    expect(displayGraphPath('/Volumes/SSD/Notes')).toBe('/Volumes/SSD/Notes')
  })
})
