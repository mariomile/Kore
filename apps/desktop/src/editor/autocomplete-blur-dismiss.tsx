import { useMemo } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { Plugin } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'

/**
 * How long after the editor loses focus an open autocomplete waits before it
 * is dismissed. A tap on a menu item lands its selection well inside this
 * window, so picking an entry is never cut short.
 */
export const AUTOCOMPLETE_BLUR_DISMISS_MS = 300

/**
 * prosekit keeps its autocomplete plugin key private; PluginKey names are
 * suffixed with a counter (`prosekit-autocomplete$`, `…$1`), so the plugin is
 * found by that prefix.
 */
const AUTOCOMPLETE_KEY_PREFIX = 'prosekit-autocomplete$'

interface AutocompleteState {
  matching: unknown
}

function findAutocompletePlugin(view: EditorView): Plugin<AutocompleteState> | undefined {
  return view.state.plugins.find((plugin) =>
    (plugin as unknown as { key: string }).key.startsWith(AUTOCOMPLETE_KEY_PREFIX),
  ) as Plugin<AutocompleteState> | undefined
}

/**
 * Close the open `[[` / `/` / `#` menu when the editor stops being edited.
 * Only pointer users get an outside-click dismiss; on iPhone, closing the
 * keyboard blurs the editor but left the popup floating over the note, and
 * the next tap anywhere (even on the tab bar) went to closing it. This sends
 * the plugin's own `leave` (the same as Escape: the typed `[[text` stays,
 * the menu does not reopen for it). Touch surfaces only.
 */
export function dismissAutocompleteIfBlurred(view: EditorView): boolean {
  if (view.isDestroyed || view.hasFocus()) {
    return false
  }
  const plugin = findAutocompletePlugin(view)
  if (!plugin?.getState(view.state)?.matching) {
    return false
  }
  view.dispatch(view.state.tr.setMeta(plugin, { type: 'leave' }))
  return true
}

/** The plugin: schedules {@link dismissAutocompleteIfBlurred} on every blur. */
export function createAutocompleteBlurDismissPlugin(): Plugin {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Plugin({
    props: {
      handleDOMEvents: {
        blur: (view) => {
          clearTimeout(timer)
          timer = setTimeout(() => dismissAutocompleteIfBlurred(view), AUTOCOMPLETE_BLUR_DISMISS_MS)
          return false
        },
      },
    },
    view: () => ({
      destroy: () => {
        clearTimeout(timer)
      },
    }),
  })
}

/** Mounted as a NoteEditor child on touch surfaces. */
export function AutocompleteBlurDismiss(): null {
  useExtension(useMemo(() => definePlugin(createAutocompleteBlurDismissPlugin()), []))
  return null
}
