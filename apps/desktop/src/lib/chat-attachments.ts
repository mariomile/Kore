import {
  assetUrl,
  chatAttachmentMediaType,
  isImageMediaType,
  isPortableImageType,
  MAX_ATTACHMENT_BYTES,
  type ChatAttachment,
} from '@reflect/core'
import { base64Of } from '@/lib/base64'

/**
 * File attachments for the chat composer: images, PDFs, and text files
 * (markdown, plain text, CSV, JSON — the closed set in `@reflect/core`'s
 * attachment types). A dropped, pasted, or picked file is read once into a
 * {@link ChatAttachment} whose `data:` URL serves double duty — for an image
 * it is the `<img src>` for the composer preview and the transcript bubble —
 * and is the payload every engine receives. The type
 * itself lives in `@reflect/core` (it is part of the persisted conversation
 * model); this module owns only the browser side — reading `File`s into it.
 *
 * Oversized images are downscaled before they enter the attachment (Plan 23):
 * a camera photo re-encodes to a bounded JPEG instead of riding the provider
 * payload, the saved conversation row, and webview memory at full resolution.
 */

export type { ChatAttachment } from '@reflect/core'

/**
 * The `<img src>` for an attachment: the in-memory `data:` URL while it has
 * one (fresh this session), otherwise its on-disk file through the
 * `kore-asset://` protocol — which is what keeps a restored
 * conversation's images off the base64 heap. Null when neither is available
 * (a legacy-shaped row in a context with no open graph).
 */
export function chatAttachmentSrc(
  attachment: ChatAttachment,
  generation: number | null,
): string | null {
  if (attachment.dataUrl !== undefined) {
    return attachment.dataUrl
  }
  if (attachment.path !== undefined && generation !== null) {
    return assetUrl(generation, attachment.path)
  }
  return null
}

/**
 * Long-edge cap for attached images. Providers tile images at roughly this
 * scale anyway (Anthropic's documented ceiling is 1568px), so pixels beyond
 * it cost payload and memory without adding anything the model can see.
 */
const MAX_IMAGE_EDGE = 1568

const JPEG_QUALITY = 0.85

/** The attachable files in a drop or paste payload; everything else is ignored. */
export function attachableFilesFrom(data: DataTransfer | null): File[] {
  if (!data) {
    return []
  }
  return Array.from(data.files).filter(
    (file) => chatAttachmentMediaType(file.name, file.type) !== null,
  )
}

/**
 * Re-encode `file` to a JPEG within {@link MAX_IMAGE_EDGE}, or null when the
 * original bytes should be used: already small in a provider-safe format, no
 * decoder on this surface (jsdom, old webviews), or undecodable — sending the
 * original is then the honest fallback, and the provider's own error surfaces
 * in the transcript if it can't read it either.
 */
async function downscaledImage(file: File): Promise<{ dataUrl: string; mediaType: string } | null> {
  if (typeof createImageBitmap !== 'function') {
    return null
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const scale = Math.min(MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height, 1), 1)
    if (scale === 1 && isPortableImageType(file.type)) {
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (context === null) {
      return null
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), mediaType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

/**
 * Read a file into an attachment, bytes inlined as a `data:` URL. Images are
 * downscaled first; other files keep their bytes under a canonical media
 * type. Throws for a file the chat cannot carry
 * (unsupported kind, or over {@link MAX_ATTACHMENT_BYTES}).
 */
export async function toChatAttachment(file: File): Promise<ChatAttachment> {
  const mediaType = chatAttachmentMediaType(file.name, file.type)
  if (mediaType === null) {
    throw new Error(`${file.name} is not a supported file type`)
  }
  if (!isImageMediaType(mediaType)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`)
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mediaType,
      dataUrl: `data:${mediaType};base64,${base64Of(await file.arrayBuffer())}`,
    }
  }
  const downscaled = await downscaledImage(file)
  if (downscaled !== null) {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mediaType: downscaled.mediaType,
      dataUrl: downscaled.dataUrl,
    }
  }
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mediaType: file.type,
    dataUrl: `data:${file.type};base64,${base64Of(await file.arrayBuffer())}`,
  }
}
