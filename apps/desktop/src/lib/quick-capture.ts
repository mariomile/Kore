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
 * pass already-folded, non-empty text. `task` lands as a `+ [ ]` task line
 * (Quick Add's canonical content) instead of a bullet.
 */
export function buildGlobalShortcutEnvelope(
  text: string,
  kind: 'append' | 'task' = 'append',
): TextCaptureEnvelope {
  return textCaptureEnvelopeSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    kind,
    text,
    capturedAt: new Date().toISOString(),
    source: 'global-shortcut',
  })
}

export { TEXT_CAPTURE_MAX_LENGTH }
