import { noteLinkBlockId } from '@reflect/core'
import { defineMarkView } from '@prosekit/core'
import type { Mark } from '@prosekit/pm/model'

/**
 * The label a `[[Note#^id]]` shows (Plan 33 C3): the note's name, never the
 * id, which means nothing to a reader. An alias (`[[Note#^id|text]]`) still
 * wins, and a same-note `[[#^id]]` reads "Link to line". Any other wiki link
 * keeps Meowdown's label (its display text, else its target).
 */
export function wikilinkLabel(attrs: { display?: unknown; target?: unknown }): string {
  const display = typeof attrs.display === 'string' ? attrs.display : ''
  const target = typeof attrs.target === 'string' ? attrs.target : ''
  if (display !== '') {
    return display
  }
  if (noteLinkBlockId(target) === null) {
    return target
  }
  const pipe = target.indexOf('|')
  const alias = pipe === -1 ? '' : target.slice(pipe + 1).trim()
  if (alias !== '') {
    return alias
  }
  const link = pipe === -1 ? target : target.slice(0, pipe)
  const note = link.slice(0, link.lastIndexOf('#')).trim()
  return note === '' ? 'Link to line' : note
}

/**
 * Meowdown's wiki-link mark view (`@meowdown/core`, `createWikilinkMarkView`)
 * with {@link wikilinkLabel} as its label. Same DOM and classes, so its CSS,
 * hover card and atom navigation keep working; installed at high priority so
 * it is the view ProseMirror uses.
 */
export function defineBlockLinkLabels() {
  return defineMarkView({
    name: 'mdWikilink',
    constructor: (mark: Mark) => {
      const dom = document.createElement('span')
      dom.className = 'md-wikilink-view md-atom-view'
      const preview = document.createElement('span')
      preview.className = 'md-wikilink-view-preview md-atom-view-preview'
      preview.contentEditable = 'false'
      preview.dataset.testid = 'wikilink'
      dom.append(preview)
      const label = document.createElement('span')
      label.className = 'md-wikilink-view-label'
      label.contentEditable = 'false'
      label.textContent = wikilinkLabel(mark.attrs)
      preview.append(label)
      const contentDOM = document.createElement('span')
      contentDOM.className = 'md-wikilink-view-content md-atom-view-content'
      dom.append(contentDOM)
      return {
        dom,
        contentDOM,
        ignoreMutation: (mutation: MutationRecord | { type: 'selection' }) =>
          !('target' in mutation) || !contentDOM.contains(mutation.target),
      }
    },
  })
}
