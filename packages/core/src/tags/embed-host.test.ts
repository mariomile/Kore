import { describe, expect, it } from 'vitest'
import {
  hasThisNoteFilter,
  hostStartingValues,
  linksToHostNote,
  textLinksToHostNote,
  type EmbedHostNote,
} from './embed-host'
import type { PropertyValue } from './property-values'
import type { TagProperty } from './tag-type'

const host: EmbedHostNote = { path: 'Projects/Atlas launch.md', linkTarget: 'Atlas launch' }

const project: TagProperty = { name: 'Project', key: 'project', type: 'relation' }
const projects: TagProperty = { name: 'Projects', key: 'projects', type: 'relations' }
const status: TagProperty = { name: 'Status', key: 'status', type: 'select' }

function text(value: string): PropertyValue {
  return { value, valueType: 'string', valueNumber: null }
}

function list(values: string[]): PropertyValue {
  return { value: JSON.stringify(values), valueType: 'list', valueNumber: null }
}

describe('linksToHostNote', () => {
  it('matches a link to the host by title, file name or path, ignoring case', () => {
    expect(linksToHostNote(text('[[Atlas launch]]'), host)).toBe(true)
    expect(linksToHostNote(text('[[atlas LAUNCH|the launch]]'), host)).toBe(true)
    expect(linksToHostNote(text('[[Projects/Atlas launch]]'), host)).toBe(true)
    expect(linksToHostNote(text('[[Atlas launch#Goals]]'), host)).toBe(true)
    expect(linksToHostNote(list(['[[Other]]', '[[Atlas launch]]']), host)).toBe(true)
  })

  it('does not match other notes, plain text or a missing value', () => {
    expect(linksToHostNote(text('[[Atlas]]'), host)).toBe(false)
    expect(linksToHostNote(text('Atlas launch'), host)).toBe(false)
    expect(linksToHostNote(undefined, host)).toBe(false)
  })
})

describe('textLinksToHostNote', () => {
  it('finds a link to the host inside a task line', () => {
    expect(textLinksToHostNote('call Luca #task [[Atlas launch]]', host)).toBe(true)
    expect(textLinksToHostNote('call Luca #task [[Other]]', host)).toBe(false)
    expect(textLinksToHostNote('call Luca #task', host)).toBe(false)
  })
})

describe('hostStartingValues', () => {
  it('links a new row to the host for each `key = this` relation filter', () => {
    const filters = [
      { key: 'project', operator: 'is', text: 'this' },
      { key: 'projects', operator: 'is', text: 'This' },
      { key: 'status', operator: 'is', text: 'this' },
      { key: 'project', operator: 'contains', text: 'this' },
    ]
    expect(hostStartingValues(filters, [project, projects, status], host)).toEqual({
      project: '[[Atlas launch]]',
      projects: ['[[Atlas launch]]'],
    })
  })

  it('adds nothing for an untitled host', () => {
    expect(
      hostStartingValues([{ key: 'project', operator: 'is', text: 'this' }], [project], {
        path: 'x.md',
        linkTarget: null,
      }),
    ).toEqual({})
  })
})

describe('hasThisNoteFilter', () => {
  it('spots a fence that points at its own note', () => {
    expect(hasThisNoteFilter([{ operator: 'is', text: 'this' }])).toBe(true)
    expect(hasThisNoteFilter([{ operator: 'contains', text: 'this' }])).toBe(false)
    expect(hasThisNoteFilter([])).toBe(false)
  })
})
