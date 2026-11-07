import type { ReactElement } from 'react'
import { attachmentKindLabel, isImageMediaType, type ChatAttachment } from '@reflect/core'
import { Paperclip } from '@/components/icons'
import { AttachmentMedia } from '@/components/ui/attachment'

interface ChatAttachmentThumbProps {
  attachment: ChatAttachment
}

/**
 * The composer's preview of one queued attachment: the picture itself for an
 * image, otherwise a file glyph with its kind (PDF, CSV…) over the file name.
 */
export function ChatAttachmentThumb({ attachment }: ChatAttachmentThumbProps): ReactElement {
  if (isImageMediaType(attachment.mediaType)) {
    return (
      <AttachmentMedia variant="image" className="w-14">
        <img src={attachment.dataUrl ?? ''} alt={attachment.name} />
      </AttachmentMedia>
    )
  }
  return (
    <>
      <AttachmentMedia className="w-14 flex-col gap-0.5 bg-surface-sunken text-text-muted">
        <Paperclip aria-hidden className="size-4" />
        <span className="text-[10px] leading-none font-medium">
          {attachmentKindLabel(attachment.mediaType)}
        </span>
      </AttachmentMedia>
      <span
        className="w-14 truncate text-center text-[10px] text-text-muted"
        title={attachment.name}
      >
        {attachment.name}
      </span>
    </>
  )
}
