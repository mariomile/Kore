import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { releaseBootSplash, resetBootSplashForTests, SHELL_GRACE_MS } from './boot-splash'

function mountSplash(): HTMLElement {
  const splash = document.createElement('div')
  splash.id = 'kore-boot'
  document.body.append(splash)
  return splash
}

/** Fading out, or already removed (Reduce Motion skips the fade). */
function revealing(splash: HTMLElement): boolean {
  return splash.classList.contains('kore-boot-leaving') || !splash.isConnected
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => {
        step(left - 1)
      })
    }
    step(count)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

beforeEach(() => {
  resetBootSplashForTests()
})

afterEach(() => {
  document.getElementById('kore-boot')?.remove()
  resetBootSplashForTests()
})

describe('releaseBootSplash', () => {
  it('fades the splash out once the first editor mounts, then removes it', async () => {
    const splash = mountSplash()
    releaseBootSplash('content')
    // Still fully up in the frame the editor first paints under it.
    expect(revealing(splash)).toBe(false)
    await nextFrames(3)
    expect(revealing(splash)).toBe(true)
    await sleep(500)
    expect(document.getElementById('kore-boot')).toBeNull()
  })

  it('reveals a screen with no editor at once', async () => {
    const splash = mountSplash()
    releaseBootSplash('screen')
    await nextFrames(3)
    expect(revealing(splash)).toBe(true)
  })

  it('gives a mounted workspace a short grace for its first editor', async () => {
    const splash = mountSplash()
    releaseBootSplash('shell')
    await nextFrames(3)
    expect(revealing(splash)).toBe(false)
    await sleep(SHELL_GRACE_MS + 100)
    expect(revealing(splash)).toBe(true)
  })

  it('reveals early when the editor arrives within the grace', async () => {
    const splash = mountSplash()
    releaseBootSplash('shell')
    releaseBootSplash('content')
    await nextFrames(3)
    expect(revealing(splash)).toBe(true)
  })

  it('does nothing when there is no splash (secondary loads, tests)', () => {
    expect(() => {
      releaseBootSplash('content')
    }).not.toThrow()
  })
})
