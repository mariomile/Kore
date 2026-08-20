import { describe, expect, it } from 'vitest'
import { expandTemplatePlaceholders, type TemplatePlaceholderValues } from './template-placeholders'

const VALUES: TemplatePlaceholderValues = {
  title: 'Atomic Habits',
  date: 'Wed, August 20th, 2026',
  dateIso: '2026-08-20',
  time: '9:41 AM',
}

describe('expandTemplatePlaceholders', () => {
  it('fills every known placeholder', () => {
    expect(
      expandTemplatePlaceholders('# {{title}}\n\n{{date}} · {{time}} · [[{{date:iso}}]]\n', VALUES),
    ).toBe('# Atomic Habits\n\nWed, August 20th, 2026 · 9:41 AM · [[2026-08-20]]\n')
  })

  it('accepts inner whitespace and any casing', () => {
    expect(expandTemplatePlaceholders('{{ Date }} {{TITLE}} {{ date:ISO }}', VALUES)).toBe(
      'Wed, August 20th, 2026 Atomic Habits 2026-08-20',
    )
  })

  it('expands repeated occurrences of the same placeholder', () => {
    expect(expandTemplatePlaceholders('{{title}} / {{title}}', VALUES)).toBe(
      'Atomic Habits / Atomic Habits',
    )
  })

  it('leaves unknown tokens and stray braces untouched', () => {
    const body = '{{author}} {{ date time }} {{}} {not one} {{date'
    expect(expandTemplatePlaceholders(body, VALUES)).toBe(body)
  })

  it('never re-expands a placeholder a value smuggles in', () => {
    const recursive = { ...VALUES, title: '{{date}}' }
    expect(expandTemplatePlaceholders('{{title}}', recursive)).toBe('{{date}}')
  })
})
