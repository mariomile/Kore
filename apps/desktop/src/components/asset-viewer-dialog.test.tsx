import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { AssetViewerDialog, viewableAssetKind } from './asset-viewer-dialog'

describe('viewableAssetKind', () => {
  it('routes pdf and html to the viewer, everything else externally', () => {
    expect(viewableAssetKind('assets/report.pdf')).toBe('pdf')
    expect(viewableAssetKind('assets/Report.PDF')).toBe('pdf')
    expect(viewableAssetKind('assets/page.html')).toBe('html')
    expect(viewableAssetKind('assets/page.htm')).toBe('html')
    expect(viewableAssetKind('assets/archive.zip')).toBeNull()
    expect(viewableAssetKind('assets/notes.pdf.bak')).toBeNull()
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
