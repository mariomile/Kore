import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import { type FollowDeepLink, useFollowDeepLink } from './use-follow-deep-link'

const dispatchDeepLink = vi.hoisted(() => vi.fn())

vi.mock('@/lib/deep-links/intake', () => ({ dispatchDeepLink }))

let followDeepLink: FollowDeepLink | null = null

function Host(): ReactElement {
  followDeepLink = useFollowDeepLink()
  return <></>
}

beforeEach(() => {
  dispatchDeepLink.mockReset()
  followDeepLink = null
})

describe('useFollowDeepLink', () => {
  it('dispatches a plain follow in place', async () => {
    await render(<Host />)

    followDeepLink?.({ href: 'reflect://note/older', openInSplit: false })

    expect(dispatchDeepLink).toHaveBeenCalledWith('reflect://note/older')
  })

  it('dispatches a modifier follow in place instead of opening a window', async () => {
    await render(<Host />)

    followDeepLink?.({ href: 'reflect://note/older', openInSplit: true })

    expect(dispatchDeepLink).toHaveBeenCalledWith('reflect://note/older')
    expect(dispatchDeepLink).toHaveBeenCalledTimes(1)
  })

  it('dispatches a capture link regardless of the modifier', async () => {
    await render(<Host />)

    followDeepLink?.({ href: 'reflect://append?text=captured', openInSplit: true })

    expect(dispatchDeepLink).toHaveBeenCalledWith('reflect://append?text=captured')
  })
})
