import { isApplePlatform } from './keybindings'

interface QuickCaptureKeyboardEvent {
  readonly code: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

const NAMED_CODES = new Set([
  'Space',
  'Slash',
  'Backslash',
  'Comma',
  'Period',
  'Semicolon',
  'Quote',
  'BracketLeft',
  'BracketRight',
  'Minus',
  'Equal',
  'Backquote',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

/** Convert one physical key chord into Kore's portable global-shortcut format. */
export function quickCaptureBindingFromEvent(
  event: QuickCaptureKeyboardEvent,
  apple = isApplePlatform(),
): string | null {
  const key = keyFromCode(event.code)
  if (key === null) {
    return null
  }

  const modifiers: string[] = []
  if (event.metaKey || (event.ctrlKey && !apple)) {
    modifiers.push('Mod')
  }
  if (event.ctrlKey && apple) {
    modifiers.push('Ctrl')
  }
  if (event.altKey) {
    modifiers.push('Alt')
  }
  if (event.shiftKey) {
    modifiers.push('Shift')
  }
  if (!modifiers.includes('Mod') && !modifiers.includes('Ctrl') && !modifiers.includes('Alt')) {
    return null
  }
  return [...modifiers, key].join('-')
}

/** Modifier-only presses should keep the recorder armed without showing an error. */
export function isShortcutModifierCode(code: string): boolean {
  return [
    'MetaLeft',
    'MetaRight',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'ShiftLeft',
    'ShiftRight',
  ].includes(code)
}

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3)
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5)
  }
  if (/^F(?:[1-9]|1[0-2])$/.test(code) || NAMED_CODES.has(code)) {
    return code
  }
  return null
}
