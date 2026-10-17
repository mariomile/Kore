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
  it('dispatches an addressing link in place', async () => {
    await render(<Host />)

    followDeepLink?.({ href: 'kore://note/older' })

    expect(dispatchDeepLink).toHaveBeenCalledWith('kore://note/older')
    expect(dispatchDeepLink).toHaveBeenCalledTimes(1)
  })

  it('dispatches a capture link, which is a write rather than a place', async () => {
    await render(<Host />)

    followDeepLink?.({ href: 'kore://append?text=captured' })

    expect(dispatchDeepLink).toHaveBeenCalledWith('kore://append?text=captured')
  })
})
