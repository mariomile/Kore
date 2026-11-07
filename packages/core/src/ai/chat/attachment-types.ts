/**
 * The closed set of files a chat message can carry, and how each kind
 * travels. Images and PDFs are binary payloads every capable engine reads
 * natively (provider file parts, Claude Code image/document blocks); text
 * files (markdown, plain text, CSV, JSON) are decoded once and ride as an
 * `<attached-file>` text block, so every engine — including those with no
 * file channel at all — reads them the same way.
 */

/** On-disk extension for every attachable media type. */
export const CHAT_ATTACHMENT_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
}

/** Media type by file extension, for files the OS reports with no (or a vague) type. */
const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
}

/** The `accept` attribute for a file picker offering every attachable kind. */
export const CHAT_ATTACHMENT_ACCEPT = [
  'image/*',
  ...Object.keys(MEDIA_TYPE_BY_EXTENSION).map((extension) => `.${extension}`),
].join(',')

/** Largest text file inlined into a message, in characters (the rest is cut). */
export const MAX_ATTACHED_TEXT_CHARS = 200_000

/** Largest binary (PDF) attachment accepted, in bytes — providers cap requests near 32 MB. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * The canonical media type for a picked, dropped, or pasted file, or null
 * when the chat cannot carry it. Images keep any `image/*` type (the
 * composer re-encodes exotic formats); everything else resolves by
 * extension first, since browsers report `.md` as empty or
 * `text/x-markdown` and `.csv` variously.
 */
export function chatAttachmentMediaType(fileName: string, browserType: string): string | null {
  if (browserType.startsWith('image/')) {
    return browserType
  }
  const dot = fileName.lastIndexOf('.')
  const extension = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
  const byExtension = MEDIA_TYPE_BY_EXTENSION[extension]
  if (byExtension !== undefined) {
    return byExtension
  }
  return browserType in CHAT_ATTACHMENT_EXTENSIONS ? browserType : null
}

/** Whether an attachment is an image (thumbnail in the UI, image block for engines). */
export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

/** Whether an attachment is a text file inlined into the message as text. */
export function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType === 'application/json'
}

/** A short label for a non-image attachment chip, e.g. `PDF`, `CSV`. */
export function attachmentKindLabel(mediaType: string): string {
  const extension = CHAT_ATTACHMENT_EXTENSIONS[mediaType]
  return extension === undefined ? 'File' : extension.toUpperCase()
}

/**
 * Decode a base64 `data:` URL's payload as UTF-8 text, or null when it is
 * not a base64 data URL. Malformed sequences decode to U+FFFD rather than
 * failing — an attached text file should always reach the model.
 */
export function decodeDataUrlText(dataUrl: string): string | null {
  const separator = dataUrl.indexOf(',')
  if (
    !dataUrl.startsWith('data:') ||
    separator === -1 ||
    !dataUrl.slice(0, separator).endsWith(';base64')
  ) {
    return null
  }
  const binary = atob(dataUrl.slice(separator + 1))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * The text block one attached text file contributes to the model-facing
 * message. Oversized files are cut at {@link MAX_ATTACHED_TEXT_CHARS} with
 * a visible marker, so the model knows it saw only the head.
 */
export function attachedFileBlock(name: string, text: string): string {
  const cut = text.length > MAX_ATTACHED_TEXT_CHARS
  const body = cut ? text.slice(0, MAX_ATTACHED_TEXT_CHARS) : text
  const safeName = name.replaceAll('"', "'")
  return [
    `<attached-file name="${safeName}">`,
    body,
    ...(cut
      ? [`[… truncated: the file continues past ${MAX_ATTACHED_TEXT_CHARS} characters]`]
      : []),
    '</attached-file>',
  ].join('\n')
}
