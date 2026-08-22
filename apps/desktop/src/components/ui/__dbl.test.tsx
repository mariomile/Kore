import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

describe('trigger + dblclick', () => {
  it('lets a double-click through to the wrapped element', async () => {
    const onDoubleClick = vi.fn()
    await render(
      <ContextMenu>
        <ContextMenuTrigger render={<div className="contents" />}>
          <div onDoubleClick={onDoubleClick}>
            <span>target text</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>X</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    )
    await userEvent.dblClick(page.getByText('target text'))
    expect(onDoubleClick).toHaveBeenCalled()
  })
})
