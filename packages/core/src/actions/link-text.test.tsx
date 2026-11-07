import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureDataFetch, captureMetaFetch, readNote, writeNote } from '../graph/commands'
import { saveLinkText } from './link-text'

/**
 * Runs in a real browser: the article and the caption track are parsed with
 * `DOMParser`, exactly as the webview does.
 */

vi.mock('../graph/commands', () => ({
  captureDataFetch: vi.fn(),
  captureMetaFetch: vi.fn(),
  readNote: vi.fn(),
  writeNote: vi.fn(),
}))

const notes = new Map<string, string>()

function card(url: string, host: string, extra = ''): string {
  return `---\nurl: ${url}\n${extra}---\n# ${host}\n\n#link\n\n[${host}](${url})\n`
}

const paragraph =
  'Local-first software keeps the primary copy of your data on your own device, so it works offline and stays yours.'

const ARTICLE = `<!doctype html><html><head><title>Local-first software</title></head><body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article><h1>Local-first software</h1>
    <p>${paragraph}</p><p>${paragraph} <a href="/sync">Sync</a> comes second.</p>
    <h2>Seven ideals</h2><p>${paragraph}</p>
  </article>
  <footer>Copyright</footer>
</body></html>`

beforeEach(() => {
  notes.clear()
  vi.clearAllMocks()
  vi.mocked(readNote).mockImplementation(async (path) => notes.get(path) ?? '')
  vi.mocked(writeNote).mockImplementation(async (path, source) => {
    notes.set(path, source)
  })
})

describe('saveLinkText', () => {
  it("keeps an article's text in its card and gives the card the article's title", async () => {
    const url = 'https://www.inkandswitch.com/local-first/'
    notes.set('notes/resource-a.md', card(url, 'www.inkandswitch.com'))
    vi.mocked(captureMetaFetch).mockResolvedValue(ARTICLE)

    expect(await saveLinkText('notes/resource-a.md', 1)).toBe(true)
    const saved = notes.get('notes/resource-a.md')!
    expect(saved).toContain('# Local-first software\n\n#link\n\n[Local-first software](')
    expect(saved).toContain('\n## Page Text\n\n')
    expect(saved).toContain('## Seven ideals')
    expect(saved).toContain('[Sync](https://www.inkandswitch.com/sync)')
    expect(saved).not.toContain('Copyright')
  })

  it("keeps a video's transcript, one timestamped paragraph per minute", async () => {
    const url = 'https://www.youtube.com/watch?v=abcdefghijk'
    notes.set('notes/resource-v.md', card(url, 'www.youtube.com'))
    vi.mocked(captureDataFetch).mockImplementation(async (target, body) => {
      if (body !== undefined) {
        expect(JSON.parse(body)).toMatchObject({ videoId: 'abcdefghijk' })
        return JSON.stringify({
          playabilityStatus: { status: 'OK' },
          videoDetails: { title: 'A talk' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&fmt=srv3',
                  languageCode: 'en',
                  kind: 'asr',
                  name: { runs: [{ text: 'English (auto-generated)' }] },
                },
              ],
            },
          },
        })
      }
      expect(target).not.toContain('fmt=')
      return `<?xml version="1.0"?><transcript>
        <text start="0.5" dur="2">it&amp;#39;s a talk</text>
        <text start="30" dur="2">about notes</text>
        <text start="75" dur="2">and agents</text>
      </transcript>`
    })

    expect(await saveLinkText('notes/resource-v.md', 1)).toBe(true)
    expect(notes.get('notes/resource-v.md')).toContain(
      '# A talk\n\n#link\n\n[A talk](https://www.youtube.com/watch?v=abcdefghijk)\n\n## Transcript\n\n' +
        "*Captions: English (auto-generated)*\n\n[0:00] it's a talk about notes\n\n[1:15] and agents\n",
    )
  })

  it('never fetches a private card', async () => {
    const url = 'https://example.com/secret'
    notes.set('notes/resource-p.md', card(url, 'example.com', 'private: true\n'))

    expect(await saveLinkText('notes/resource-p.md', 1)).toBe(false)
    expect(captureMetaFetch).not.toHaveBeenCalled()
    expect(writeNote).not.toHaveBeenCalled()
  })
})
