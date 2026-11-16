import { useEffect, useState, type ReactElement } from 'react'
import type { EditorExtension } from '@meowdown/core'
import { useEditor } from '@meowdown/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { LINK_LAYOUT_EVENT, type LinkLayoutRequest } from './link-card-dom'
import { whenEditorMounted } from './when-editor-mounted'
import { applyLinkLook, linkBlockAt, type LinkBlock, type LinkLook } from './link-layout'

interface OpenMenu {
  readonly anchor: HTMLElement
  readonly request: LinkLayoutRequest
  readonly block: LinkBlock
}

const LOOKS: readonly { look: LinkLook; label: string }[] = [
  { look: 'link', label: 'Inline link' },
  { look: 'compact', label: 'Compact' },
  { look: 'card', label: 'Card' },
  { look: 'large', label: 'Large' },
]

function isLayoutRequest(event: Event): event is CustomEvent<LinkLayoutRequest> {
  return (
    event instanceof CustomEvent && typeof (event.detail as { url?: unknown })?.url === 'string'
  )
}

/**
 * The appearance menu for link cards: Inline link, Compact, Card, Large. A
 * card's appearance button fires {@link LINK_LAYOUT_EVENT}; this finds the
 * block behind it and rewrites its Markdown (see `link-layout`). Mounted as
 * a NoteEditor child, so pasted-link cards and embed fences share it.
 */
export function LinkLayoutMenu(): ReactElement {
  const editor = useEditor<EditorExtension>()
  const [menu, setMenu] = useState<OpenMenu | null>(null)

  useEffect(() => {
    let detach: (() => void) | null = null
    const cancelMount = whenEditorMounted(editor, () => {
      const root = editor.view.dom
      root.addEventListener(LINK_LAYOUT_EVENT, onRequest)
      detach = () => root.removeEventListener(LINK_LAYOUT_EVENT, onRequest)
    })
    function onRequest(event: Event) {
      if (!isLayoutRequest(event) || !(event.target instanceof HTMLElement)) {
        return
      }
      const block = linkBlockAt(editor.view, event.target, event.detail.url)
      if (block !== null) {
        setMenu({ anchor: event.target, request: event.detail, block })
      }
    }
    return () => {
      cancelMount()
      detach?.()
    }
  }, [editor])

  const choose = (look: LinkLook) => {
    if (menu === null || !editor.mounted) {
      return
    }
    setMenu(null)
    if (look !== menu.request.layout) {
      applyLinkLook(
        editor.view,
        (markdown) => editor.commands.insertMarkdown(markdown),
        menu.block,
        menu.request,
        look,
      )
    }
  }

  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) setMenu(null)
      }}
    >
      {menu !== null ? (
        <DropdownMenuContent
          align="end"
          anchor={menu.anchor}
          className="w-44 min-w-44"
          data-testid="link-layout-menu"
          side="bottom"
          sideOffset={6}
        >
          <DropdownMenuRadioGroup
            value={menu.request.layout}
            onValueChange={(value) => choose(value as LinkLook)}
          >
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            {LOOKS.map(({ look, label }) => (
              <DropdownMenuRadioItem key={look} value={look}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  )
}
