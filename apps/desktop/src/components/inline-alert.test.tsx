import { render } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import { InlineAlert } from './inline-alert'

describe('InlineAlert', () => {
  it('announces its content with role=alert', async () => {
    const view = await render(<InlineAlert>Save failed.</InlineAlert>)
    expect(view.getByRole('alert').element().textContent).toBe('Save failed.')
    await view.unmount()
  })

  // TONE_CLASSES is the contract under test, so class substrings are asserted here.
  it('defaults to the warning tone', async () => {
    const view = await render(<InlineAlert>Heads up.</InlineAlert>)
    expect(view.getByRole('alert').element().className).toContain('text-warning')
    await view.unmount()
  })

  it('renders the error tone in danger', async () => {
    const view = await render(<InlineAlert tone="error">It broke.</InlineAlert>)
    const alert = view.getByRole('alert').element()
    expect(alert.textContent).toBe('It broke.')
    expect(alert.className).toContain('text-danger')
    expect(alert.className).not.toContain('warning')
    await view.unmount()
  })

  it('passes a custom className through', async () => {
    const view = await render(<InlineAlert className="mb-4">Spaced.</InlineAlert>)
    expect(view.getByRole('alert').element().className).toContain('mb-4')
    await view.unmount()
  })
})
