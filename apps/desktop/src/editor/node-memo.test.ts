import { Fragment, Schema } from '@prosekit/pm/model'
import { describe, expect, it } from 'vitest'
import { memoByNode } from './node-memo'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
})

function doc(...lines: string[]) {
  return schema.node(
    'doc',
    null,
    lines.map((line) => schema.node('paragraph', null, line === '' ? [] : [schema.text(line)])),
  )
}

describe('memoByNode', () => {
  it('recomputes only the blocks an edit replaced', () => {
    const seen: string[] = []
    const length = memoByNode((node) => {
      seen.push(node.textContent)
      return node.textContent.length
    })
    const before = doc('one', 'two', 'three')
    before.forEach((node) => length(node))
    expect(seen).toEqual(['one', 'two', 'three'])

    // Typing in the second line: the new document shares the other two nodes.
    const after = before.copy(
      Fragment.from([before.child(0), doc('twos').child(0), before.child(2)]),
    )
    seen.length = 0
    const lengths: number[] = []
    after.forEach((node) => {
      lengths.push(length(node))
    })
    expect(lengths).toEqual([3, 4, 5])
    expect(seen).toEqual(['twos'])
  })

  it('caches a null result too', () => {
    let calls = 0
    const none = memoByNode(() => {
      calls += 1
      return null
    })
    const node = doc('x').child(0)
    expect(none(node)).toBeNull()
    expect(none(node)).toBeNull()
    expect(calls).toBe(1)
  })
})
