import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { PRIVATE_NOTE_EDIT_ERROR, TAG_DEFINITION_UNMARKED_ERROR } from '@reflect/core'

const definition = vi.hoisted(() => ({
  path: 'tags/company.md',
  exists: true,
  needsConversion: false,
  properties: [{ name: 'Website', key: 'website', type: 'url' as const }],
  template: 'templates/company.md' as string | null,
  icon: '🏢' as string | null,
}))
const source = vi.hoisted(() => ({ text: '---\nlore: tag\nicon: 🏢\n---\n' }))
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
vi.mock('@/lib/tags/use-commit-note-property', () => ({ invalidateOnNextIndexApply: () => {} }))
vi.mock('@/lib/tags/tag-type-write', () => ({
  readTagDefinition: async () => definition,
  saveTagType,
}))
vi.mock('@/lib/note-frontmatter', () => ({ readNoteSource: async () => source.text }))

const { useApplyTagIcon, STALE_TAG_ICON_MESSAGE } = await import('./use-apply-tag-icon')

beforeEach(() => {
  saveTagType.mockClear()
  definition.exists = true
  definition.needsConversion = false
  definition.icon = '🏢'
  source.text = '---\nlore: tag\nicon: 🏢\n---\n'
})

describe('useApplyTagIcon', () => {
  it('writes the icon through the definition writer, keeping schema and template', async () => {
    const { result } = await renderHook(() => useApplyTagIcon())
    await result.current({ tag: 'Company', icon: 'icon:buildings', previousIcon: '🏢' })
    expect(saveTagType).toHaveBeenCalledWith(
      'Company',
      definition.properties,
      7,
      'templates/company.md',
      'icon:buildings',
    )
  })

  it('refuses a stale, private, or unmarked definition without writing', async () => {
    const { result } = await renderHook(() => useApplyTagIcon())
    await expect(
      result.current({ tag: 'company', icon: 'icon:buildings', previousIcon: null }),
    ).rejects.toThrow(STALE_TAG_ICON_MESSAGE)
    source.text = '---\nlore: tag\nprivate: true\n---\n'
    await expect(
      result.current({ tag: 'company', icon: 'icon:buildings', previousIcon: '🏢' }),
    ).rejects.toThrow(PRIVATE_NOTE_EDIT_ERROR)
    source.text = '# Company\n'
    definition.needsConversion = true
    await expect(
      result.current({ tag: 'company', icon: 'icon:buildings', previousIcon: '🏢' }),
    ).rejects.toThrow(TAG_DEFINITION_UNMARKED_ERROR)
    expect(saveTagType).not.toHaveBeenCalled()
  })
})
