import {
  TEXT_CAPTURE_MAX_LENGTH,
  textCaptureEnvelopeSchema,
  type TextCaptureEnvelope,
} from '@reflect/core'

/**
 * Fold a capture bar's payload to one line. The drain rejects newlines, so
 * a paste that includes them becomes a single daily-note bullet.
 */
export function foldQuickCaptureText(raw: string): string {
  return raw.replaceAll(/[\r\n]+/g, ' ').trim()
}

/**
 * A text-capture envelope the global-shortcut mini window spools into the
 * same inbox the deep-link and share-sheet producers write. Callers must
 * pass already-folded, non-empty text.
 */
export function buildGlobalShortcutEnvelope(text: string): TextCaptureEnvelope {
  return textCaptureEnvelopeSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    kind: 'append',
    text,
    capturedAt: new Date().toISOString(),
    source: 'global-shortcut',
  })
}

export { TEXT_CAPTURE_MAX_LENGTH }
