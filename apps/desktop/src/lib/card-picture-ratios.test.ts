import { describe, expect, it } from 'vitest'
import {
  MAX_PICTURE_RATIO,
  MIN_PICTURE_RATIO,
  clampPictureRatio,
  rememberPictureRatio,
  rememberedPictureRatio,
} from './card-picture-ratios'

describe('card picture ratios', () => {
  it('keeps a shape between a portrait and a panorama', () => {
    expect(clampPictureRatio(0.5)).toBe(MIN_PICTURE_RATIO)
    expect(clampPictureRatio(4)).toBe(MAX_PICTURE_RATIO)
    expect(clampPictureRatio(1.5)).toBe(1.5)
  })

  it('remembers a picture by its URL', () => {
    expect(rememberedPictureRatio('kore-asset://a.png?kore-thumb')).toBeUndefined()
    rememberPictureRatio('kore-asset://a.png?kore-thumb', 0.8)
    expect(rememberedPictureRatio('kore-asset://a.png?kore-thumb')).toBe(0.8)
  })

  it('does not keep an inline image as a key', () => {
    const inline = `data:image/png;base64,${'A'.repeat(4000)}`
    rememberPictureRatio(inline, 1.6)
    expect(rememberedPictureRatio(inline)).toBeUndefined()
  })
})
