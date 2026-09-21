import { describe, expect, it } from 'vitest'
import type { TagProperty } from '@reflect/core'
import { diffTagSchema } from './schema-diff'

const AUTHOR: TagProperty = { name: 'Author', key: 'author', type: 'text' }
const STATUS: TagProperty = { name: 'Status', key: 'status', type: 'select', options: ['Reading'] }
const READ_ON: TagProperty = { name: 'Read on', key: 'read-on', type: 'date' }

describe('diffTagSchema', () => {
  it('marks each property of the proposal against the schema it replaces', () => {
    expect(diffTagSchema([AUTHOR, STATUS], [AUTHOR, READ_ON], [])).toEqual([
      { kind: 'same', next: AUTHOR, previous: AUTHOR },
      { kind: 'added', next: READ_ON, previous: null },
      { kind: 'removed', next: null, previous: STATUS },
    ])
  })

  it('reads a rename as one changed row, not a removal beside an addition', () => {
    const renamed: TagProperty = { name: 'Written by', key: 'written-by', type: 'text' }
    expect(diffTagSchema([AUTHOR], [renamed], [{ from: 'author', to: 'written-by' }])).toEqual([
      { kind: 'changed', next: renamed, previous: AUTHOR },
    ])
    // Without the rename the same two lists are a swap — which is what the
    // user would actually get, since no values would move.
    expect(diffTagSchema([AUTHOR], [renamed], [])).toEqual([
      { kind: 'added', next: renamed, previous: null },
      { kind: 'removed', next: null, previous: AUTHOR },
    ])
  })

  it('marks a retyped or relabelled property under the same key as changed', () => {
    const retyped: TagProperty = { ...AUTHOR, type: 'person' }
    expect(diffTagSchema([AUTHOR], [retyped], [])).toEqual([
      { kind: 'changed', next: retyped, previous: AUTHOR },
    ])
    const wider: TagProperty = { ...STATUS, options: ['Reading', 'Done'] }
    expect(diffTagSchema([STATUS], [wider], [])).toEqual([
      { kind: 'changed', next: wider, previous: STATUS },
    ])
  })

  it('reads an empty proposal as every property removed', () => {
    expect(diffTagSchema([AUTHOR, STATUS], [], [])).toEqual([
      { kind: 'removed', next: null, previous: AUTHOR },
      { kind: 'removed', next: null, previous: STATUS },
    ])
    expect(diffTagSchema([], [], [])).toEqual([])
  })
})
