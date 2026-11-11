import { cleanup, renderHook } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePostEmbedResolvers } from '@/editor/use-post-embed-resolvers'

const resolveXPostEmbed = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  resolveXPostEmbed,
}))

const URL = 'https://x.com/a/status/1'

afterEach(async () => {
  resolveXPostEmbed.mockClear()
  await cleanup()
})

describe('usePostEmbedResolvers', () => {
  it('waits for the note privacy, then fetches for a public note', async () => {
    const { result, rerender } = await renderHook(
      (props?: { allowed: boolean | undefined }) => usePostEmbedResolvers(props?.allowed),
      { initialProps: { allowed: undefined as boolean | undefined } },
    )
    const pending = result.current.resolveXPost(URL)
    expect(resolveXPostEmbed).not.toHaveBeenCalled()
    await rerender({ allowed: true })
    await pending
    expect(resolveXPostEmbed).toHaveBeenCalledWith(URL)
  })

  it('stops fetching once an open note is made private', async () => {
    const { result, rerender } = await renderHook(
      (props?: { allowed: boolean | undefined }) => usePostEmbedResolvers(props?.allowed),
      { initialProps: { allowed: true } },
    )
    await result.current.resolveXPost(URL)
    expect(resolveXPostEmbed).toHaveBeenCalledTimes(1)
    await rerender({ allowed: false })
    expect(await result.current.resolveXPost(URL)).toBe(undefined)
    expect(resolveXPostEmbed).toHaveBeenCalledTimes(1)
  })
})
