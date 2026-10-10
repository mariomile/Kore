import { describe, expect, it } from 'vitest'
import { mergeTemplateFrontmatter } from './template-frontmatter'

const VALUES = {
  title: 'Ada: the first',
  date: '10-10-2026',
  dateIso: '2026-10-10',
  time: '9:41',
}

const PERSON = `---
title: Person
tags:
  - type/person
  - crm/other
role:
up: "[[_People Index]]"
related: []
expertise: [ai]
project: "{{title}}"
---
> One line.
`

describe('mergeTemplateFrontmatter', () => {
  it('adds the template’s properties around what the note already says', () => {
    const note = `---
id: 01J
tags: [crm/other]
role: CTO
expertise: [product]
---
# Ada
`
    expect(mergeTemplateFrontmatter(note, PERSON, VALUES)).toBe(`---
id: 01J
tags: [ crm/other, type/person ]
role: CTO
expertise: [ product, ai ]
up: "[[_People Index]]"
related: []
project: "Ada: the first"
---
# Ada
`)
  })

  it('leaves the note alone when its frontmatter does not parse', () => {
    const broken = '---\nrole: [\n---\n# Ada\n'
    expect(mergeTemplateFrontmatter(broken, PERSON, VALUES)).toBe(broken)
  })
})
