import { describe, expect, it } from 'vitest'
import { COMPANY_CHAT_PROMPTS, COMPANY_SEED_TAGS, companySeedTypes } from './company-seed'
import { isTemplatePath } from './paths'

describe('company seed', () => {
  it('covers the four company types plus meetings, each bound to a template', () => {
    const types = companySeedTypes()
    expect(types.map((entry) => entry.tag)).toEqual([...COMPANY_SEED_TAGS])
    for (const entry of types) {
      expect(isTemplatePath(entry.templatePath)).toBe(true)
      expect(entry.templateBody).toContain(`#${entry.tag}`)
      expect(entry.definitionBody.length).toBeGreaterThan(0)
    }
    const decision = types.find((entry) => entry.tag === 'decision')
    expect(decision?.properties.some((property) => property.key === 'decided')).toBe(true)
  })

  it('offers three company chat starters that name the collections', () => {
    expect(COMPANY_CHAT_PROMPTS).toHaveLength(3)
    expect(COMPANY_CHAT_PROMPTS[0]?.prompt).toContain('#decision')
    expect(COMPANY_CHAT_PROMPTS[1]?.prompt).toContain('#person')
    expect(COMPANY_CHAT_PROMPTS[2]?.prompt).toContain('#project')
  })
})
