import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { TagActionsMenu } from './tag-actions-menu'

describe('TagActionsMenu', () => {
  it('renders nothing when there is no active tag', async () => {
    const view = await render(
      <TagActionsMenu state={null} onClose={() => {}} onOpenTag={() => {}} onConvert={() => {}} />,
    )
    expect(view.container.firstChild).toBeNull()
  })

  it('opens the tag or converts the line, per the clicked action', async () => {
    const onOpenTag = vi.fn()
    const onConvert = vi.fn()
    const view = await render(
      <TagActionsMenu
        state={{ tag: 'meeting', x: 10, y: 20 }}
        onClose={() => {}}
        onOpenTag={onOpenTag}
        onConvert={onConvert}
      />,
    )

    await view.getByRole('button', { name: 'Open #meeting' }).click()
    expect(onOpenTag).toHaveBeenCalledWith('meeting')

    await view.getByRole('button', { name: 'Turn this line into a #meeting note' }).click()
    expect(onConvert).toHaveBeenCalled()
  })
})
