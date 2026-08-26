import { describe, expect, it, vi } from 'vitest'
import type { BrowserPageRead } from '../../browser/commands'
import {
  BROWSER_UNAVAILABLE_ERROR,
  MAX_PAGE_TEXT_CHARS,
  WEB_URL_ERROR,
  buildOpenWebPage,
  buildReadWebPage,
} from './browse-web'
import { buildNoteTools, noteToolCall, noteToolResult } from './tools'

const PAGE: BrowserPageRead = {
  url: 'https://example.com/docs',
  title: 'Example Docs',
  text: 'Welcome to the docs.',
  truncated: false,
}

function fakeDeps(read: BrowserPageRead = PAGE) {
  return {
    browseOpenFn: vi.fn(async () => read),
    browseReadFn: vi.fn(async () => read),
  }
}

describe('open_web_page', () => {
  it('loads the URL and returns the settled page text', async () => {
    const deps = fakeDeps()
    const open = buildOpenWebPage(deps)
    const output = await open('https://example.com/docs')

    expect(deps.browseOpenFn).toHaveBeenCalledWith('https://example.com/docs', {
      maxChars: MAX_PAGE_TEXT_CHARS,
    })
    expect(deps.browseReadFn).not.toHaveBeenCalled()
    expect(output).toEqual({ ok: true, page: PAGE })
  })

  it('refuses non-web URLs without touching the shell', async () => {
    const deps = fakeDeps()
    const open = buildOpenWebPage(deps)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'example.com', 'reflect://x']) {
      expect(await open(url)).toEqual({ ok: false, error: WEB_URL_ERROR })
    }
    expect(deps.browseOpenFn).not.toHaveBeenCalled()
  })

  it('refuses upfront on surfaces without the embedded browser', async () => {
    const deps = fakeDeps()
    const open = buildOpenWebPage(deps, false)
    expect(await open('https://example.com')).toEqual({
      ok: false,
      error: BROWSER_UNAVAILABLE_ERROR,
    })
    const read = buildReadWebPage(deps, false)
    expect(await read()).toEqual({ ok: false, error: BROWSER_UNAVAILABLE_ERROR })
    expect(deps.browseOpenFn).not.toHaveBeenCalled()
    expect(deps.browseReadFn).not.toHaveBeenCalled()
  })

  it('returns other shell failures as their own message', async () => {
    const open = buildOpenWebPage({
      browseOpenFn: async () => {
        throw new Error('the page did not answer in time')
      },
      browseReadFn: async () => PAGE,
    })
    expect(await open('https://example.com')).toEqual({
      ok: false,
      error: 'the page did not answer in time',
    })
  })
})

describe('read_web_page', () => {
  it('reads whatever page is open, with no URL expectation', async () => {
    const deps = fakeDeps()
    const read = buildReadWebPage(deps)
    expect(await read()).toEqual({ ok: true, page: PAGE })
    expect(deps.browseReadFn).toHaveBeenCalledWith({ maxChars: MAX_PAGE_TEXT_CHARS })
  })
})

describe('browse tools through buildNoteTools', () => {
  it('registers both tools on the injected deps', async () => {
    const deps = fakeDeps()
    const tools = buildNoteTools(deps)
    const options = { toolCallId: 'call-1', messages: [], context: {} }
    const opened = await tools.open_web_page.execute?.({ url: 'https://example.com/docs' }, options)
    expect(opened).toEqual({ ok: true, page: PAGE })
    const read = await tools.read_web_page.execute?.({}, options)
    expect(read).toEqual({ ok: true, page: PAGE })
  })

  it('maps stream parts onto the browse transcript chips', () => {
    expect(
      noteToolCall({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'open_web_page',
        input: { url: 'https://example.com' },
      } as never),
    ).toEqual({ tool: 'browse', toolCallId: 'call-1', url: 'https://example.com' })

    expect(
      noteToolResult({
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'open_web_page',
        input: { url: 'https://example.com' },
        output: { ok: true, page: PAGE },
      } as never),
    ).toEqual({
      tool: 'browse',
      toolCallId: 'call-1',
      url: PAGE.url,
      title: PAGE.title,
      error: null,
    })

    expect(
      noteToolResult({
        type: 'tool-result',
        toolCallId: 'call-2',
        toolName: 'read_web_page',
        input: {},
        output: { ok: false, error: BROWSER_UNAVAILABLE_ERROR },
      } as never),
    ).toEqual({
      tool: 'readPage',
      toolCallId: 'call-2',
      url: null,
      title: null,
      error: BROWSER_UNAVAILABLE_ERROR,
    })
  })
})
