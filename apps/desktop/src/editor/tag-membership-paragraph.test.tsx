import { describe, expect, it } from 'vitest'
import { isTagOnlyParagraph, membershipParagraphCss } from './tag-membership-paragraph'

function paragraph(html: string): HTMLElement {
  const node = document.createElement('p')
  node.innerHTML = html
  return node
}

describe('isTagOnlyParagraph', () => {
  it('accepts a paragraph of only tag marks', () => {
    expect(isTagOnlyParagraph(paragraph('<span class="md-tag">#project</span>'))).toBe(true)
    expect(
      isTagOnlyParagraph(
        paragraph('<span class="md-tag">#project</span> <span class="md-tag">#person</span>'),
      ),
    ).toBe(true)
  })

  it('rejects a sentence that mentions a tag', () => {
    expect(
      isTagOnlyParagraph(paragraph('See also <span class="md-tag">#project</span> later')),
    ).toBe(false)
  })
})

describe('membershipParagraphCss', () => {
  it('targets a tag-only line after the title, not a sentence with a tag', () => {
    const root = document.createElement('div')
    root.className = 'reflect-editor reflect-editor-has-properties'
    root.innerHTML =
      '<h1>Project</h1><p><span class="md-tag">#project</span></p><p>See also <span class="md-tag">#project</span> later</p>'
    const css = membershipParagraphCss(root)
    expect(css).toContain(':nth-child(2)')
    expect(css).not.toContain(':nth-child(3)')
  })
})
