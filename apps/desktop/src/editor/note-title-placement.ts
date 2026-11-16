/**
 * Where a note's title sits in the editor DOM, for the typed-fields slot
 * (`EditorNoteProperties`). The title is the first H1, allowed to follow
 * blank paragraphs only: a blank line after the frontmatter parses as an
 * empty paragraph, and Obsidian writes one after every frontmatter block. Any
 * other leading block (prose, a list) means the note has no title line.
 */
export function findNoteTitle(root: HTMLElement): HTMLElement | null {
  for (const child of root.children) {
    if (!(child instanceof HTMLElement)) {
      continue
    }
    if (child.tagName === 'H1') {
      return child
    }
    if (child.tagName === 'P' && isBlankParagraph(child)) {
      continue
    }
    return null
  }
  return null
}

function isBlankParagraph(paragraph: HTMLElement): boolean {
  if ((paragraph.textContent ?? '').trim() !== '') {
    return false
  }
  // Only line breaks (ProseMirror's trailing break) inside: an image or an
  // embed has no text but is still content.
  for (const node of paragraph.children) {
    if (node.tagName !== 'BR') {
      return false
    }
  }
  return true
}

const TITLE_STYLE_ID = 'kore-note-title-style'

/**
 * The stylesheet that gives a title not at `:first-child` the same
 * fields-sized bottom margin the base CSS gives `h1:first-child`. Uses
 * `nth-child` on the meowdown host, outside ProseMirror's document, for the
 * same reason as the membership collapse: a class on a document node is
 * stripped on the next view flush.
 */
export function noteTitleCss(root: HTMLElement, title: HTMLElement): string {
  const index = [...root.children].indexOf(title) + 1
  if (index <= 1) {
    return ''
  }
  return `.kore-editor.kore-editor-has-properties > :nth-child(${String(index)}){margin-bottom:calc(0.4em + var(--kore-note-properties-space, 0px))}`
}

export function applyNoteTitleCss(host: HTMLElement, root: HTMLElement, title: HTMLElement): void {
  const css = noteTitleCss(root, title)
  const existing = host.querySelector(`#${TITLE_STYLE_ID}`)
  if (css === '') {
    existing?.remove()
    return
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style')
  if (!(existing instanceof HTMLStyleElement)) {
    style.id = TITLE_STYLE_ID
    host.appendChild(style)
  }
  if (style.textContent !== css) {
    style.textContent = css
  }
}

export function clearNoteTitleCss(host: HTMLElement | null): void {
  host?.querySelector(`#${TITLE_STYLE_ID}`)?.remove()
}
