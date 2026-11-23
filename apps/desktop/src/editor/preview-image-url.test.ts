import { describe, expect, it } from 'vitest'
import { passivePreviewImageResolver, previewThumbnailUrl } from './preview-image-url'

function resolver(url: string | null): (src: string) => string | null {
  return passivePreviewImageResolver({
    resolveImageUrl: () => url,
    resolveAssetOpenPath: (src) => (src.startsWith('http') ? null : src),
  })
}

describe('passive preview image URLs', () => {
  it('marks a protocol URL raster-only and asks for its thumbnail', () => {
    const url = resolver('kore-asset://localhost/1/assets/a.png')('assets/a.png')
    expect(url).toBe('kore-asset://localhost/1/assets/a.png?kore-preview=raster')
    expect(previewThumbnailUrl(url ?? '')).toBe(
      'kore-asset://localhost/1/assets/a.png?kore-preview=raster&kore-thumb',
    )
  })

  it('leaves a data URL whole, since a query would corrupt its payload', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo='
    expect(resolver(data)('assets/a.png')).toBe(data)
    expect(previewThumbnailUrl(data)).toBe(data)
  })

  it('never resolves remote or SVG images', () => {
    expect(resolver('kore-asset://x')('https://example.com/a.png')).toBeNull()
    expect(resolver('kore-asset://x')('assets/logo.svg')).toBeNull()
  })
})
