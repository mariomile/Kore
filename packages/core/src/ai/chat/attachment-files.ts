import { z } from 'zod'
import { call } from '../../ipc/invoke'
import type { ChatAttachment } from './transcript'

/**
 * Chat attachment bytes on disk. A freshly attached image enters the
 * composer as a `data:` URL (downscaled, bounded — see the app's
 * chat-attachments module); the send path persists those bytes to
 * `.reflect/chat-attachments/<conversation>/<attachment>.<ext>` through the
 * commands here, so the *persisted* turn row carries only the file path and
 * a restored conversation holds no base64. The webview renders the file via
 * the `reflect-asset://` protocol; only a send that must rebuild a provider
 * payload reads the bytes back.
 */

/** Extension for the on-disk file, from the attachment's media type. */
const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const pathSchema = z.string()
const base64Schema = z.string()
const voidSchema = z.null()

/**
 * Persist one attachment's bytes and return the attachment carrying its
 * graph-relative `path` (the in-memory `dataUrl` stays for this session's
 * rendering and payload; the store strips it from the persisted row).
 * Returns the attachment unchanged when it has nothing to persist — no
 * bytes, an unknown media type, or already on disk.
 */
export async function persistChatAttachmentFile(
  conversationId: string,
  attachment: ChatAttachment,
  generation: number,
): Promise<ChatAttachment> {
  const extension = EXTENSION_BY_MEDIA_TYPE[attachment.mediaType]
  const dataUrl = attachment.dataUrl
  if (dataUrl === undefined || extension === undefined || attachment.path !== undefined) {
    return attachment
  }
  const separator = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || separator === -1) {
    return attachment
  }
  const path = await call(
    'chat_attachment_write',
    {
      conversationId,
      fileName: `${attachment.id}.${extension}`,
      bytesBase64: dataUrl.slice(separator + 1),
      generation,
    },
    pathSchema,
  )
  return { ...attachment, path }
}

/** Read a persisted attachment's bytes back as a `data:` URL. */
export async function readChatAttachmentDataUrl(
  attachment: ChatAttachment & { path: string },
  generation: number,
): Promise<string> {
  const bytes = await call(
    'chat_attachment_read',
    { path: attachment.path, generation },
    base64Schema,
  )
  return `data:${attachment.mediaType};base64,${bytes}`
}

/** Delete a conversation's attachment files (idempotent). */
export async function deleteChatAttachmentFiles(
  conversationId: string,
  generation: number,
): Promise<void> {
  await call('chat_attachments_delete', { conversationId, generation }, voidSchema)
}
