import {
  TEXT_CAPTURE_MAX_LENGTH,
  textCaptureEnvelopeSchema,
  type GraphRole,
  type TextCaptureEnvelope,
} from '@reflect/core'

/** Where a global-shortcut line lands. */
export type QuickCaptureDestination = 'today' | 'decision' | 'meeting'

/** Company graphs default to a named decision so capture never hits a shared daily. */
export function defaultQuickCaptureDestination(role: GraphRole | null): QuickCaptureDestination {
  return role === 'company' ? 'decision' : 'today'
}

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
