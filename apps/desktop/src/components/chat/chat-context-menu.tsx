import { useRef, type ReactElement } from 'react'
import { Image, Note, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ChatContextMenuProps {
  onAttachImages: (files: File[]) => void
  onMentionNote: () => void
}

/** Adds the context types the chat can actually consume: images and note mentions. */
export function ChatContextMenu({
  onAttachImages,
  onMentionNote,
}: ChatContextMenuProps): ReactElement {
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label="Choose images"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          if (files.length > 0) {
            onAttachImages(files)
          }
          event.currentTarget.value = ''
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Add context"
              className="rounded-full bg-surface-sunken text-text-muted hover:text-text"
            >
              <Plus aria-hidden className="size-4.5" />
            </Button>
          }
        />
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-52">
          <DropdownMenuItem
            className="gap-2 px-2 py-1.5"
            onClick={() => imageInputRef.current?.click()}
          >
            <Image aria-hidden />
            Upload images
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 px-2 py-1.5" onClick={onMentionNote}>
            <Note aria-hidden />
            Mention a note
            <DropdownMenuShortcut>@</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
