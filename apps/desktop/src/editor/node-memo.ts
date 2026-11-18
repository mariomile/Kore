import type { Node as ProseMirrorNode } from '@prosekit/pm/model'

/**
 * Memoize a pure function of a ProseMirror node. Nodes are immutable and an
 * edit shares every untouched node with the previous document, so a plugin
 * that rescans the document on each keystroke recomputes only the blocks
 * the keystroke touched. The cache is weak: nodes of old documents go with
 * them.
 */
export function memoByNode<T>(compute: (node: ProseMirrorNode) => T): (node: ProseMirrorNode) => T {
  const cache = new WeakMap<ProseMirrorNode, { value: T }>()
  return (node) => {
    const hit = cache.get(node)
    if (hit !== undefined) {
      return hit.value
    }
    const value = compute(node)
    cache.set(node, { value })
    return value
  }
}
