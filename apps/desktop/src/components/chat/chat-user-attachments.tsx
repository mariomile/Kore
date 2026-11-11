import type { ReactElement } from 'react'
import { attachmentKindLabel, isImageMediaType, type ChatAttachment } from '@kore/core'
import { Paperclip } from '@/components/icons'
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { chatAttachmentSrc } from '@/lib/chat-attachments'
import { useGraph } from '@/providers/graph-provider'

interface ChatUserAttachmentsProps {
  attachments: readonly ChatAttachment[]
}

/**
 * Attachments shown above a user's chat bubble after the turn is sent:
 * images as pictures, other files as a chip with their name and kind.
 */
export function ChatUserAttachments({
  attachments,
}: ChatUserAttachmentsProps): ReactElement | null {
  const { indexGeneration } = useGraph()
  if (attachments.length === 0) {
    return null
  }

  // Restored images render from their on-disk file via the asset protocol;
  // fresh ones from the in-memory data URL (chatAttachmentSrc).
  const images = attachments
    .filter((attachment) => isImageMediaType(attachment.mediaType))
    .map((attachment) => ({ attachment, src: chatAttachmentSrc(attachment, indexGeneration) }))
    .filter((entry): entry is { attachment: ChatAttachment; src: string } => entry.src !== null)
  const files = attachments.filter((attachment) => !isImageMediaType(attachment.mediaType))

  return (
    <AttachmentGroup className="flex-wrap justify-end gap-2 overflow-visible py-0">
      {files.map((attachment) => (
        <Attachment key={attachment.id} size="sm" className="max-w-64 min-w-0 bg-surface">
          <AttachmentMedia className="bg-surface-sunken text-text-muted">
            <Paperclip aria-hidden />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={attachment.name}>{attachment.name}</AttachmentTitle>
            <AttachmentDescription>
              {attachmentKindLabel(attachment.mediaType)}
            </AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      ))}
      {images.map(({ attachment, src }) => (
        <Attachment
          key={attachment.id}
          className="min-w-0 border-none bg-transparent p-0"
          orientation="horizontal"
          size="default"
        >
          <AttachmentMedia className="aspect-auto h-auto max-h-48 w-auto max-w-full rounded-xl bg-transparent">
            <img
              src={src}
              alt={attachment.name}
              className="max-h-48 max-w-full rounded-xl object-contain"
            />
          </AttachmentMedia>
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}
