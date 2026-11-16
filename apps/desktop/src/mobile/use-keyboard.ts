import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { focusedEditorCommands } from '@/editor/formatting-toolbar-store'

let currentKeyboardHeight = 0
const keyboardListeners = new Set<() => void>()

/**
 * The last published keyboard overlap in px — `0` when the keyboard is closed.
 * A plain getter (not a hook) so imperative call sites — Embla's `watchDrag`
 * predicate fires at drag start, outside React — can read the live value.
 */
export function getKeyboardHeight(): number {
  return currentKeyboardHeight
}

/**
 * Record the keyboard overlap height. Called by {@link useKeyboardHeightVar}
 * as the visual viewport changes; exported so tests can drive keyboard state
 * without a real keyboard.
 */
export function publishKeyboardHeight(height: number): void {
  if (height === currentKeyboardHeight) {
    return
  }
  currentKeyboardHeight = height
  for (const listener of keyboardListeners) {
    listener()
  }
}

function subscribeKeyboard(listener: () => void): () => void {
  keyboardListeners.add(listener)
  return () => {
    keyboardListeners.delete(listener)
  }
}

function keyboardVisibleSnapshot(): boolean {
  return currentKeyboardHeight > 0
}

/**
 * Whether the software keyboard is up, as reactive state. The tab bar hides
 * on it — with the shell root sized to end at the keyboard's top (decision 8),
 * the bar would otherwise ride up above the keyboard, and V1 lets the
 * keyboard cover it instead.
 */
export function useKeyboardVisible(): boolean {
  return useSyncExternalStore(subscribeKeyboard, keyboardVisibleSnapshot, keyboardVisibleSnapshot)
}

/**
 * The smallest visual-viewport shrink treated as the software keyboard;
 * anything under it is browser-chrome noise. Same threshold as Base UI:
 * https://github.com/mui/base-ui/blob/v1.7.0/packages/react/src/drawer/virtual-keyboard-provider/DrawerVirtualKeyboardProvider.tsx#L25
 */
const KEYBOARD_MIN_OVERLAP = 60

/** How long after a blur a lingering overlap is treated as stale (iOS 26.0). */
const KEYBOARD_STALE_DELAY_MS = 1750

/**
 * The keyboard overlap per `visualViewport`. `KeyboardPlugin.swift` pins the
 * webview (frame and scroll offset), so the layout viewport always matches
 * the screen and the visual-viewport shortfall is exactly the keyboard
 * overlap (decision 0003).
 */
function readKeyboardOverlap(): number {
  const viewport = window.visualViewport
  if (!viewport || viewport.scale !== 1) {
    return 0
  }
  const overlap = window.innerHeight - viewport.height - viewport.offsetTop
  return overlap > KEYBOARD_MIN_OVERLAP ? Math.round(overlap) : 0
}

/**
 * Mirrors the software keyboard's overlap height into `--keyboard-height` on
 * the document root (Plan 19, decision 8). With the webview pinned by the
 * Swift half of `tauri-plugin-keyboard`, `visualViewport` is the honest
 * keyboard signal and no native event bridge is needed. The mobile shell root
 * sizes itself to `calc(100dvh - var(--keyboard-height))`, and `DrawerContent`
 * pads its bottom past it so drawers end above the keyboard.
 * The height is also published to {@link getKeyboardHeight} /
 * {@link useKeyboardVisible} for non-layout consumers (the carousel's swipe
 * guard, the tab bar hiding).
 */
export function useKeyboardHeightVar(): void {
  // Viewport reader: feeds the store, which drops no-op publishes.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) {
      return
    }
    const apply = (): void => {
      publishKeyboardHeight(readKeyboardOverlap())
    }
    // iOS 26.0 leaves the visual viewport stale after the keyboard closes
    // (https://developer.apple.com/forums/thread/800125, fixed in 26.1). If
    // focus has left every editable element and an overlap still reads,
    // clear it; on healthy systems the overlap is already 0 by then and the
    // timer is a no-op.
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const onFocusOut = (): void => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        const el = document.activeElement
        const editing =
          (el instanceof HTMLElement && el.isContentEditable) || focusedKeyboardField() !== null
        if (!editing && readKeyboardOverlap() > 0) {
          publishKeyboardHeight(0)
        }
      }, KEYBOARD_STALE_DELAY_MS)
    }
    apply()
    viewport.addEventListener('resize', apply)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      viewport.removeEventListener('resize', apply)
      document.removeEventListener('focusout', onFocusOut)
      clearTimeout(watchdog)
      publishKeyboardHeight(0)
    }
  }, [])

  // Store subscriber: touches the CSS variable only when the value changed,
  // in a layout effect so the shell resizes in the same paint.
  const height = useSyncExternalStore(subscribeKeyboard, getKeyboardHeight, getKeyboardHeight)
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--keyboard-height', `${height}px`)
    return () => {
      document.documentElement.style.removeProperty('--keyboard-height')
    }
  }, [height])
}

/**
 * Input types that raise the software keyboard; `input.type` normalizes a
 * missing attribute to `'text'`. Same allowlist as Base UI:
 * https://github.com/mui/base-ui/blob/v1.7.0/packages/react/src/drawer/virtual-keyboard-provider/DrawerVirtualKeyboardProvider.tsx#L42
 */
const KEYBOARD_INPUT_TYPES = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
])

function focusedKeyboardField(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement
  if (el instanceof HTMLTextAreaElement) {
    return el
  }
  if (el instanceof HTMLInputElement && KEYBOARD_INPUT_TYPES.has(el.type)) {
    return el
  }
  // contenteditable (the editor) is useKeyboardCaretReveal's job; everything
  // else does not raise the keyboard.
  return null
}

/**
 * Re-anchors iOS's native caret on a focused `<input>` / `<textarea>`.
 *
 * WKWebView draws a form field's caret natively, from a rect WebKit sends
 * only when the selection changes (or when a CSS animation on an ancestor
 * ends). A field that moves by layout alone keeps its caret where the field
 * used to be: a bottom sheet growing past the keyboard, or settling after its
 * open transition, leaves the caret floating above the text (the quick
 * capture sheet, 2026-11). Setting the same selection again is a no-op in
 * WebKit, so this clears it and restores it in the same task: a real
 * selection change, so WebKit recomputes the caret rect at the next paint,
 * and nothing paints in between, so nothing flickers. Focus, value and the
 * selection itself are unchanged.
 */
export function refreshFieldCaret(field: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (field === null || document.activeElement !== field) {
    return
  }
  // `selectionStart` throws or is null on types without a text selection
  // (email, number); their caret is left alone.
  let start: number | null
  let end: number | null
  let direction: HTMLTextAreaElement['selectionDirection'] | null
  try {
    ;({ selectionStart: start, selectionEnd: end, selectionDirection: direction } = field)
  } catch {
    return
  }
  if (start === null || end === null) {
    return
  }
  document.getSelection()?.removeAllRanges()
  field.setSelectionRange(start, end, direction ?? undefined)
}

/**
 * Scrolls the focused form field above the keyboard, whenever the keyboard
 * height changes or focus moves. `DrawerContent`'s keyboard padding keeps the
 * scroller above the keyboard; the native scroll pin already blocks WebKit's
 * own reveal, so one plain `scrollIntoView` is enough.
 *
 * It also keeps the field's native caret on the text ({@link refreshFieldCaret})
 * after the two moves WebKit does not report: the keyboard resizing the
 * layout, and a drawer's open transition ending under a field focused
 * mid-slide.
 */
export function useKeyboardFieldReveal(): void {
  const height = useSyncExternalStore(subscribeKeyboard, getKeyboardHeight, getKeyboardHeight)

  useEffect(() => {
    if (height <= 0) {
      return
    }
    const reveal = (): void => {
      focusedKeyboardField()?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
    // One frame late, so the drawer's keyboard padding is laid out before we
    // measure.
    const frame = requestAnimationFrame(() => {
      reveal()
      refreshFieldCaret(focusedKeyboardField())
    })
    document.addEventListener('focusin', reveal)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('focusin', reveal)
    }
  }, [height])

  useEffect(() => {
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.propertyName !== 'transform' || !(event.target instanceof Element)) {
        return
      }
      const field = focusedKeyboardField()
      if (field !== null && event.target.contains(field)) {
        refreshFieldCaret(field)
      }
    }
    document.addEventListener('transitionend', onTransitionEnd)
    return () => {
      document.removeEventListener('transitionend', onTransitionEnd)
    }
  }, [])
}

/**
 * Re-reveals the caret whenever the keyboard changes the visible area.
 *
 * Focus raises the keyboard before any height arrives, so the focus-time
 * reveal ran against the full-height viewport and did nothing; once the shell
 * shrinks, nothing else scrolls the caret back (WebKit's own reveal is pinned
 * off in `KeyboardPlugin.swift`). Mounted once: every screen's editors publish
 * to the same focused-editor slot, and `scrollCaretIntoView` is a no-op while
 * the caret is already visible.
 */
export function useKeyboardCaretReveal(): void {
  const height = useSyncExternalStore(subscribeKeyboard, getKeyboardHeight, getKeyboardHeight)

  useEffect(() => {
    if (height <= 0) {
      return
    }
    // Passive effect: runs after the paint that applied the shrunken shell,
    // so the scroll container is already at its final height.
    focusedEditorCommands()?.scrollCaretIntoView()
    // Backstop for chrome that settles a frame late (the tab bar swaps for
    // the toolbar); re-read the slot, the focused editor may have changed.
    const frame = requestAnimationFrame(() => {
      focusedEditorCommands()?.scrollCaretIntoView()
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [height])
}
