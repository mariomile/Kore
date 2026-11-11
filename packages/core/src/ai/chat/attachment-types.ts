/**
 * The closed set of files a chat message can carry, and how each kind
 * travels. Images and PDFs are binary payloads every capable engine reads
 * natively (provider file parts, Claude Code image/document blocks); text
 * files (markdown, plain text, CSV, JSON) are decoded once and ride as an
 * `<attached-file>` text block, so every engine — including those with no
 * file channel at all — reads them the same way.
 */

/**
 * How an attachment reaches a model: `image` and `document` are binary
 * channels an engine may read natively, `text` is inlined into the message.
 */
export type AttachmentChannel = 'image' | 'document' | 'text'

export interface AttachmentKind {
  readonly mediaType: string
  /** File extensions, the first one being the on-disk extension. */
  readonly extensions: readonly [string, ...string[]]
  readonly channel: AttachmentChannel
}

/**
 * Every attachable media type: the one table the extensions, the picker,
 * each engine's accepted types and the encoders derive from. The Rust
 * attachment store keeps its own closed list as the security boundary, and
 * a test holds it to this table.
 */
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = [
  { mediaType: 'image/jpeg', extensions: ['jpeg', 'jpg'], channel: 'image' },
  { mediaType: 'image/png', extensions: ['png'], channel: 'image' },
  { mediaType: 'image/webp', extensions: ['webp'], channel: 'image' },
  { mediaType: 'image/gif', extensions: ['gif'], channel: 'image' },
  { mediaType: 'application/pdf', extensions: ['pdf'], channel: 'document' },
  { mediaType: 'text/plain', extensions: ['txt', 'text'], channel: 'text' },
  { mediaType: 'text/markdown', extensions: ['md', 'markdown'], channel: 'text' },
  { mediaType: 'text/csv', extensions: ['csv'], channel: 'text' },
  { mediaType: 'application/json', extensions: ['json'], channel: 'text' },
]

const KIND_BY_MEDIA_TYPE = new Map(ATTACHMENT_KINDS.map((kind) => [kind.mediaType, kind]))

const KIND_BY_EXTENSION = new Map(
  ATTACHMENT_KINDS.flatMap((kind) =>
    kind.extensions.map((extension) => [extension, kind] as const),
  ),
)

/** The channel an attachable media type travels on, or null when the chat cannot carry it. */
export function attachmentChannel(mediaType: string): AttachmentChannel | null {
  return KIND_BY_MEDIA_TYPE.get(mediaType)?.channel ?? null
}

/** The on-disk extension for an attachable media type, or null. */
export function attachmentExtension(mediaType: string): string | null {
  return KIND_BY_MEDIA_TYPE.get(mediaType)?.extensions[0] ?? null
}

/**
 * Whether an image is in a format every provider reads as-is; any other
 * image is re-encoded before it is attached.
 */
export function isPortableImageType(mediaType: string): boolean {
  return attachmentChannel(mediaType) === 'image'
}

/** The `accept` attribute for a file picker offering every attachable kind. */
export const CHAT_ATTACHMENT_ACCEPT = [
  'image/*',
  ...[...KIND_BY_EXTENSION.keys()].map((extension) => `.${extension}`),
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
  const byExtension = KIND_BY_EXTENSION.get(extension)
  if (byExtension !== undefined) {
    return byExtension.mediaType
  }
  return KIND_BY_MEDIA_TYPE.has(browserType) ? browserType : null
}

/** Whether an attachment is an image (thumbnail in the UI, image block for engines). */
export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

/** Whether an attachment is a text file inlined into the message as text. */
export function isTextMediaType(mediaType: string): boolean {
  return attachmentChannel(mediaType) === 'text'
}

/** A short label for a non-image attachment chip, e.g. `PDF`, `CSV`. */
export function attachmentKindLabel(mediaType: string): string {
  return attachmentExtension(mediaType)?.toUpperCase() ?? 'File'
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
