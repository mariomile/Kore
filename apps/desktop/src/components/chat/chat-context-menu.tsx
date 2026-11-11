import { useRef, type ReactElement } from 'react'
import { CHAT_ATTACHMENT_ACCEPT } from '@kore/core'
import { Note, Paperclip, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ChatContextMenuProps {
  onAttachFiles: (files: File[]) => void
  onMentionNote: () => void
}

/** Adds the context types the chat can actually consume: files (images, PDFs, text) and note mentions. */
export function ChatContextMenu({
  onAttachFiles,
  onMentionNote,
}: ChatContextMenuProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={CHAT_ATTACHMENT_ACCEPT}
        multiple
        className="sr-only"
        aria-label="Choose files"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          if (files.length > 0) {
            onAttachFiles(files)
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
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip aria-hidden />
            Upload files
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
