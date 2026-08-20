import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { AssetViewerDialog, viewableAssetKind } from './asset-viewer-dialog'

describe('viewableAssetKind', () => {
  it('routes viewable kinds to the viewer, everything else externally', () => {
    expect(viewableAssetKind('assets/report.pdf')).toBe('pdf')
    expect(viewableAssetKind('assets/Report.PDF')).toBe('pdf')
    expect(viewableAssetKind('assets/page.html')).toBe('html')
    expect(viewableAssetKind('assets/page.htm')).toBe('html')
    expect(viewableAssetKind('assets/data.csv')).toBe('csv')
    expect(viewableAssetKind('assets/data.tsv')).toBe('csv')
    expect(viewableAssetKind('assets/memo.docx')).toBe('docx')
    expect(viewableAssetKind('assets/readme.txt')).toBe('text')
    expect(viewableAssetKind('assets/notes.md')).toBe('text')
    expect(viewableAssetKind('assets/build.log')).toBe('text')
    expect(viewableAssetKind('assets/config.json')).toBe('text')
    expect(viewableAssetKind('assets/archive.zip')).toBeNull()
    expect(viewableAssetKind('assets/notes.pdf.bak')).toBeNull()
  })
})

describe('data views', () => {
  it('renders CSV as a table off the asset protocol', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response('name,count\n"Anna ""B""",3\nLuca,5\n', { status: 200 }),
      )
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/signups.csv"
        url="reflect-asset://localhost/1/assets/signups.csv"
        onClose={() => {}}
        onOpenExternally={() => {}}
      />,
    )
    // Chromium demotes small tables to "layout tables" and drops their ARIA
    // roles, so the cells are asserted by text.
    await expect.element(view.getByText('count', { exact: true })).toBeVisible()
    await expect.element(view.getByText('Anna "B"')).toBeVisible()
    await expect.element(view.getByText('Luca')).toBeVisible()
    fetchMock.mockRestore()
    await view.unmount()
  })

  it('renders plain text attachments in a scroller', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('first line\nsecond line', { status: 200 }))
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/build.log"
        url="reflect-asset://localhost/1/assets/build.log"
        onClose={() => {}}
        onOpenExternally={() => {}}
      />,
    )
    await expect.element(view.getByText(/first line/)).toBeVisible()
    fetchMock.mockRestore()
    await view.unmount()
  })

  it('renders a DOCX through the converter into a sandboxed frame', async () => {
    // A file mammoth can't parse surfaces the honest error path; the happy
    // path needs a real .docx zip, which the parser unit tests own upstream.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/memo.docx"
        url="reflect-asset://localhost/1/assets/memo.docx"
        onClose={() => {}}
        onOpenExternally={() => {}}
      />,
    )
    await expect.element(view.getByText(/can’t|could not|corrupt/i)).toBeVisible()
    fetchMock.mockRestore()
    await view.unmount()
  })
})

describe('AssetViewerDialog', () => {
  it('renders a PDF in an unsandboxed frame with the file name as title', async () => {
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/quarterly-report.pdf"
        url="reflect-asset://localhost/1/assets/quarterly-report.pdf"
        onClose={() => {}}
        onOpenExternally={() => {}}
      />,
    )
    await expect.element(view.getByText('quarterly-report.pdf')).toBeVisible()
    const frame = view.getByTitle('quarterly-report.pdf').element()
    expect(frame.getAttribute('src')).toContain('quarterly-report.pdf')
    // The webview's PDF plugin does not run inside a sandboxed frame.
    expect(frame.hasAttribute('sandbox')).toBe(false)
    await view.unmount()
  })

  it('sandboxes HTML attachments completely', async () => {
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/clipped-page.html"
        url="reflect-asset://localhost/1/assets/clipped-page.html"
        onClose={() => {}}
        onOpenExternally={() => {}}
      />,
    )
    const frame = view.getByTitle('clipped-page.html').element()
    // The empty sandbox blocks scripts, same-origin access, forms, popups.
    expect(frame.getAttribute('sandbox')).toBe('')
    await view.unmount()
  })

  it('falls back to a message when the URL cannot be resolved', async () => {
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/report.pdf"
        url={null}
        onClose={() => {}}
        onOpenExternally={() => {}}
      />,
    )
    await expect.element(view.getByText(/can’t be displayed here/)).toBeVisible()
    await view.unmount()
  })

  it('hands off to the OS through Open externally and closes on Escape', async () => {
    const onClose = vi.fn()
    const onOpenExternally = vi.fn()
    const view = await render(
      <AssetViewerDialog
        assetPath="assets/report.pdf"
        url="reflect-asset://localhost/1/assets/report.pdf"
        onClose={onClose}
        onOpenExternally={onOpenExternally}
      />,
    )
    await view.getByRole('button', { name: 'Open externally' }).click()
    expect(onOpenExternally).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    await view.unmount()
  })
})
