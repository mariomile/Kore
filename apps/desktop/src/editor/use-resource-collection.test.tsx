import { cleanup, renderHook } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectResourceFile, collectResourceLink, saveLinkText } from '@kore/core'
import { useResourceCollection } from '@/editor/use-resource-collection'
import { act } from '@/test-utils/act'

const settingsState = vi.hoisted(() => ({
  pasteCollectLinks: false,
  pasteCollectImages: false,
  pasteCollectPdfs: false,
  pasteCollectFiles: false,
  pasteSaveLinkText: true,
}))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  collectResourceLink: vi.fn(async () => 'notes/resource-link.md'),
  collectResourceFile: vi.fn(
    async (_file: File, _origin: unknown, upload: () => Promise<string | null>) => await upload(),
  ),
  saveLinkText: vi.fn(async () => true),
}))
vi.mock('@/lib/resource-sources', () => ({
  appendResourceSource: vi.fn(async () => {}),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({ settings: settingsState, updateSettings: () => {} }),
}))

const upload = vi.fn(async (file: File) => `assets/${file.name}`)

async function hook(): Promise<ReturnType<typeof useResourceCollection>> {
  const { result } = await renderHook(() => useResourceCollection(1, 'daily/today.md', '', upload))
  return result.current
}

const image = new File(['x'], 'shot.png', { type: 'image/png' })
const pdf = new File(['x'], 'paper.pdf', { type: 'application/pdf' })

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(settingsState, {
    pasteCollectLinks: false,
    pasteCollectImages: false,
    pasteCollectPdfs: false,
    pasteCollectFiles: false,
    pasteSaveLinkText: true,
  })
})

afterEach(() => {
  cleanup()
})

describe('useResourceCollection', () => {
  it('makes no cards by default: a paste is just a paste', async () => {
    const resources = await hook()
    await act(async () => {
      resources.saveUrl('https://example.com/article')
      expect(await resources.saveFile(image)).toBe('assets/shot.png')
    })
    expect(collectResourceLink).not.toHaveBeenCalled()
    expect(collectResourceFile).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalledWith(image)
  })

  it('files only the kinds that are switched on', async () => {
    settingsState.pasteCollectPdfs = true
    const resources = await hook()
    await act(async () => {
      await resources.saveFile(image)
      await resources.saveFile(pdf)
    })
    expect(collectResourceFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(collectResourceFile).mock.calls[0]?.[0]).toBe(pdf)
  })

  it('collects a link and keeps its page text', async () => {
    settingsState.pasteCollectLinks = true
    const resources = await hook()
    resources.saveUrl('https://example.com/a')
    await vi.waitFor(() => expect(saveLinkText).toHaveBeenCalledWith('notes/resource-link.md', 1))
  })

  it('collects a link without fetching its text when that is switched off', async () => {
    settingsState.pasteCollectLinks = true
    settingsState.pasteSaveLinkText = false
    const resources = await hook()
    resources.saveUrl('https://example.com/b')
    await vi.waitFor(() => expect(collectResourceLink).toHaveBeenCalled())
    await Promise.resolve()
    expect(saveLinkText).not.toHaveBeenCalled()
  })
})
