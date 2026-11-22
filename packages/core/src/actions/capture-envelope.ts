import { z } from 'zod'

/**
 * The platform-agnostic capture envelope (Plan 11): the contract between
 * every capture producer and the app's drain. The Chrome extension's
 * native-messaging host writes one `<id>.json` envelope (plus an optional
 * sibling screenshot) into the graph's capture inbox; the iOS share
 * extension writes the same shape into the App Group inbox the main app
 * relays on foreground. This module is deliberately browser-safe — it imports nothing
 * but zod, and the extension consumes it through the package's
 * `./capture-envelope` subpath without pulling the rest of core.
 *
 * This TS schema is the single source of truth; the Rust host's serde structs
 * (`apps/native-host`) mirror it and must be kept in sync.
 */

/**
 * Where a link capture originated: the Chrome extension (through the
 * native-messaging host), the iOS share extension (through the App Group
 * inbox the main app relays on foreground), or the in-app browser pane's
 * Clip button (spooled directly by the desktop app — it never passes the
 * native-messaging host, which keeps accepting only `extension` on its
 * wire). Provenance only — every source produces the same envelope shape.
 */
export const captureSourceSchema = z.enum(['extension', 'ios-share', 'in-app-browser'])

/** Only web pages are capturable — `chrome://`, `file://` etc. never spool. */
function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

/** Standard padded base64 (what `btoa`/`captureVisibleTab` produce). */
const BASE64_RE = /^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i

/**
 * How a shared link is written into its note — the iOS share sheet's "How"
 * choice. The editor's link looks, as plain Markdown:
 *
 * - `link`: a named `[Title](url)` (never draws as a card).
 * - `card`: the bare URL on its own line (the default card).
 * - `compact` / `large`: an ` ```embed ` fence with that `layout:` line.
 * - `embed`: `![](url)`, the post or video player an X post or a YouTube
 *   link draws as.
 * - `text`: a card, then the page's words as a quote — the article, the
 *   video's transcript, or the post's text.
 */
export const captureLookSchema = z.enum(['link', 'card', 'compact', 'large', 'embed', 'text'])

/** Cap on a new note's title, in UTF-16 code units (the share sheet caps too). */
export const CAPTURE_TITLE_MAX_LENGTH = 1_000

/**
 * Where a shared link is written — the iOS share sheet's "Where" choice:
 * today's daily note (under its Links section), the end of an existing note,
 * or a new note in a folder. `path` and `folder` are graph-relative; the
 * drain re-checks both and falls back to the daily note when either no
 * longer names a note or folder it may write.
 */
export const captureDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('note'), path: z.string().min(1).max(1_000) }),
  z.object({
    kind: z.literal('new'),
    title: z.string().trim().min(1).max(CAPTURE_TITLE_MAX_LENGTH),
    folder: z.string().max(1_000),
  }),
])

export type CaptureLook = z.infer<typeof captureLookSchema>
export type CaptureDestination = z.infer<typeof captureDestinationSchema>

/** One captured page, as spooled into the capture inbox. */
export const captureEnvelopeSchema = z.object({
  /** Envelope format version; bump on breaking changes. */
  version: z.literal(1),
  /**
   * Producer-generated UUID — names the spool files, dedups host retries.
   * `z.guid()`, not `z.uuid()`: the host's `is_uuid` (apps/native-host) accepts
   * any 8-4-4-4-12 hex string, so the drain must too — `z.uuid()` enforces RFC
   * version/variant nibbles and would quarantine captures the host spooled.
   */
  id: z.guid(),
  /** The captured page's URL. */
  url: z.url().refine(isHttpUrl, 'must be an http(s) url'),
  /** The page title at capture time (may be empty on restricted pages). */
  title: z.string(),
  /** Text the user had selected, verbatim. */
  selection: z.string().optional(),
  /** Plain text paragraphs extracted from the captured page. */
  contentText: z.string().optional(),
  /**
   * The page's own meta/OpenGraph description, extracted in-page at capture
   * time (the iOS share extension's Safari preprocessor). The drain writes it
   * into the raw save so an offline capture still lands with a description;
   * enrichment later replaces it in place with the scraped/AI one.
   */
  metaDescription: z.string().optional(),
  /** A comment the user typed into the capture UI. */
  note: z.string().optional(),
  /**
   * Filename of the sibling screenshot in the spool (e.g. `<id>.jpg`),
   * stamped by the host when the capture carried one.
   */
  screenshotRef: z.string().optional(),
  /** When the capture happened, ISO-8601 — decides the daily note it lands on. */
  capturedAt: z.iso.datetime({ offset: true }),
  /** Where the capture originated. */
  source: captureSourceSchema,
  /**
   * How to write the link (the share sheet's choice). An envelope carrying
   * one is placed directly where `destination` says, in that look; one
   * without keeps the capture-note flow the browser extension uses.
   */
  look: captureLookSchema.optional(),
  /** Where to write a link that carries a `look`; the daily note when absent. */
  destination: captureDestinationSchema.optional(),
})

export type CaptureEnvelope = z.infer<typeof captureEnvelopeSchema>
export type CaptureSource = z.infer<typeof captureSourceSchema>

/**
 * The extension→host wire message: the envelope plus the screenshot bytes.
 * The host strips `screenshotBase64` into the sibling spool file and stamps
 * `screenshotRef` before writing the envelope. Kept here so the extension and
 * the host tests share one definition of the wire shape.
 */
export const captureWireMessageSchema = z.object({
  envelope: captureEnvelopeSchema.omit({ screenshotRef: true, look: true, destination: true }),
  /** JPEG screenshot bytes, base64 (no data-URL prefix). */
  screenshotBase64: z.string().min(1).regex(BASE64_RE, 'must be base64').optional(),
})

export type CaptureWireMessage = z.infer<typeof captureWireMessageSchema>

/**
 * Cap on a text capture's payload. A `kore://` URL is a world-invokable
 * surface, so its writes stay short and plain; the desktop's deep-link parser
 * enforces the same number before an envelope is ever spooled.
 */
export const TEXT_CAPTURE_MAX_LENGTH = 10_000

/**
 * What a text capture materializes as on the capture-day daily note. One
 * vocabulary end-to-end: the `kore://append`/`kore://checkbox`/
 * `kore://task` URL verb IS the envelope kind IS the drain behavior
 * (`- ` bullet / `- [ ]` square checkbox / `+ [ ]` round task). Both checkbox
 * shapes project into the Tasks view (projection v25); the two kinds now
 * differ only in the bullet they write, matching the round-vs-square visuals
 * the editor draws.
 */
export const textCaptureKindSchema = z.enum(['append', 'checkbox', 'task'])

/**
 * Where a text capture originated. Deliberately separate from
 * {@link captureSourceSchema} and from the envelope *shape*: provenance and
 * shape are different axes, so a future producer (a widget, an Android
 * intent) joins by adding a member here — never by growing a new envelope
 * variant. `ios-share` is non-URL text shared through the iOS share sheet;
 * `ios-intent` is the Quick Note App Intent (Siri / Shortcuts / Action
 * button, Plan 24). `global-shortcut` is the desktop mini window the
 * system-wide shortcut opens, which appends a line to today's daily note.
 */
export const textCaptureSourceSchema = z.enum([
  'deep-link',
  'ios-share',
  'ios-intent',
  'global-shortcut',
])

/**
 * A text write (`kore://append?text=…` / `kore://checkbox?text=…` /
 * `kore://task?text=…`), spooled into the same capture inbox the
 * native-messaging host writes. One single line of plain text — the drain
 * appends it to the capture-day daily note as a bullet (`append`), a square
 * checkbox (`checkbox`), or a round task (`task`), so an envelope can never
 * smuggle extra markdown blocks into the graph.
 */
export const textCaptureEnvelopeSchema = z.object({
  /** Envelope format version; bump on breaking changes. */
  version: z.literal(1),
  /** Producer-generated UUID — names the spool file (same rule as link captures). */
  id: z.guid(),
  /** Discriminates from link envelopes, which carry no `kind`. */
  kind: textCaptureKindSchema,
  /** The payload, already whitespace-folded to one line by the URL parser. */
  text: z
    .string()
    .trim()
    .min(1)
    .max(TEXT_CAPTURE_MAX_LENGTH)
    .regex(/^[^\r\n]+$/, 'must be a single line'),
  /** When the link fired, ISO-8601 — decides the daily note it lands on. */
  capturedAt: z.iso.datetime({ offset: true }),
  /** Where the capture came from. */
  source: textCaptureSourceSchema,
})

export type TextCaptureEnvelope = z.infer<typeof textCaptureEnvelopeSchema>
export type TextCaptureKind = z.infer<typeof textCaptureKindSchema>
export type TextCaptureSource = z.infer<typeof textCaptureSourceSchema>

/** Cap on the files one share can carry (the iOS share sheet's activation rule matches). */
export const FILE_CAPTURE_MAX_FILES = 10

/**
 * A spooled file's name: the envelope id, its position, its extension
 * (`<id>.<n>.<ext>`). Keyed by the id so the relay and the orphan sweep can
 * pair every file with its envelope, and plain so it can never escape the
 * inbox.
 */
const FILE_REF_RE = /^[0-9a-f-]{36}\.\d{1,2}\.[a-z0-9]{1,8}$/

/**
 * Files shared through the iOS share sheet (photos, PDFs). The extension
 * copies each file into the App Group inbox beside this envelope, as
 * `files[].ref`; the drain moves them into the vault's attachment folder and
 * writes them where `destination` says: an image as `![](…)`, anything else
 * as a `[name](…)` file link, then the user's note.
 */
export const fileCaptureEnvelopeSchema = z
  .object({
    /** Envelope format version; bump on breaking changes. */
    version: z.literal(1),
    /** Producer-generated UUID — names the spool files (same rule as link captures). */
    id: z.guid(),
    /** Discriminates from text envelopes (`append`…) and link envelopes (no `kind`). */
    kind: z.literal('file'),
    files: z
      .array(
        z.object({
          /** The spooled copy's filename in the inbox. */
          ref: z.string().regex(FILE_REF_RE, 'must be <id>.<n>.<ext>'),
          /** The file's own name as shared, the attachment's name in the vault. */
          name: z.string().trim().min(1).max(255),
        }),
      )
      .min(1)
      .max(FILE_CAPTURE_MAX_FILES),
    /** The user's own words from the sheet's "Add a thought" field. */
    note: z.string().max(10_000).optional(),
    /** When the share happened, ISO-8601 — decides the daily note it lands on. */
    capturedAt: z.iso.datetime({ offset: true }),
    /** Only the iOS share sheet shares files today. */
    source: z.literal('ios-share'),
    /** Where to write the files; the daily note when absent. */
    destination: captureDestinationSchema.optional(),
  })
  .refine(
    (envelope) => envelope.files.every((file) => file.ref.startsWith(`${envelope.id}.`)),
    'every file ref must belong to its envelope',
  )

export type FileCaptureEnvelope = z.infer<typeof fileCaptureEnvelopeSchema>

/**
 * Anything the capture inbox can legally hold: a link capture (browser
 * extension or share sheet), a text capture, or shared files. Dispatch is
 * by **shape** — the `kind` discriminator text and file envelopes carry and
 * link envelopes lack (they predate it on the wire) — never by `source`,
 * which names provenance and widens independently of shape. The `kind`
 * shapes parse first so `kind` is honored before the link shape gets a say.
 */
export const inboxEnvelopeSchema = z.union([
  textCaptureEnvelopeSchema,
  fileCaptureEnvelopeSchema,
  captureEnvelopeSchema,
])

export type InboxEnvelope = z.infer<typeof inboxEnvelopeSchema>

/**
 * The host's reply to the extension. `queued` is the only success state the
 * host can honestly claim — it spools and exits, and never observes the
 * desktop app draining the inbox.
 */
export const captureAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.literal('queued') }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-graph`: no pointer file — the app has never opened a graph.
     * `invalid-payload`: the wire message failed validation.
     * `io`: the spool write failed.
     */
    code: z.enum(['no-graph', 'invalid-payload', 'io']),
    message: z.string(),
  }),
])

export type CaptureAck = z.infer<typeof captureAckSchema>
