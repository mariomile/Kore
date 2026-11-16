/**
 * True when `paragraph` is only `#tag` marks and whitespace — the membership
 * line Type already shows as chips. Text nodes count: CSS `:has` cannot see
 * them, so "See also #tag later" must not match.
 */
export function isTagOnlyParagraph(paragraph: HTMLElement): boolean {
  if (paragraph.querySelector('.md-tag') === null) {
    return false
  }
  for (const node of paragraph.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? '').trim() !== '') {
        return false
      }
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      continue
    }
    if (!(node instanceof HTMLElement) || !node.classList.contains('md-tag')) {
      return false
    }
  }
  return true
}

const HIDE_RULE =
  '{height:0;margin:0;padding:0;overflow:hidden;border:0;visibility:hidden;pointer-events:none}'

const MEMBERSHIP_STYLE_ID = 'kore-tag-membership-style'

/**
 * CSS that collapses the editor's leading and trailing tag-only paragraphs.
 * Selectors use `nth-child` so ProseMirror's document DOM is left untouched
 * (a class on those nodes is stripped on the next view flush and loops).
 */
export function membershipParagraphCss(
  root: HTMLElement,
  title: HTMLElement | null = root.querySelector<HTMLElement>(':scope > h1:first-child'),
): string {
  const paragraphs = [...root.querySelectorAll(':scope > p')]
  // The paragraph right under the title (which may follow blank lines), or
  // with no title the first non-blank one.
  const next = title?.nextElementSibling
  const lead = next?.tagName === 'P' ? next : null
  const first =
    title === null
      ? ([...root.children].find((child) => (child.textContent ?? '').trim() !== '') ?? null)
      : root.querySelector(':scope > p:first-child')
  const last = root.querySelector(':scope > p:last-child')
  const children = [...root.children]
  const selectors: string[] = []
  for (const paragraph of paragraphs) {
    if (!(paragraph instanceof HTMLElement)) {
      continue
    }
    if (!isTagOnlyParagraph(paragraph)) {
      continue
    }
    if (paragraph !== lead && paragraph !== first && paragraph !== last) {
      continue
    }
    const childIndex = children.indexOf(paragraph) + 1
    if (childIndex === 0) {
      continue
    }
    selectors.push(`.kore-editor.kore-editor-has-properties > :nth-child(${String(childIndex)})`)
  }
  if (selectors.length === 0) {
    return ''
  }
  return `${selectors.join(',')}${HIDE_RULE}`
}

/**
 * Write (or clear) the collapse stylesheet on the meowdown host — outside
 * ProseMirror's document, so the next view flush cannot strip it.
 */
export function applyMembershipParagraphCss(
  host: HTMLElement,
  root: HTMLElement,
  title: HTMLElement | null,
): void {
  const css = membershipParagraphCss(root, title)
  const existing = host.querySelector(`#${MEMBERSHIP_STYLE_ID}`)
  if (css === '') {
    existing?.remove()
    return
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style')
  if (!(existing instanceof HTMLStyleElement)) {
    style.id = MEMBERSHIP_STYLE_ID
    host.appendChild(style)
  }
  if (style.textContent !== css) {
    style.textContent = css
  }
}

export function clearMembershipParagraphCss(host: HTMLElement | null): void {
  host?.querySelector(`#${MEMBERSHIP_STYLE_ID}`)?.remove()
}
