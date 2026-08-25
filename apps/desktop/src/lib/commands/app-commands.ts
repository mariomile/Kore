import { errorMessage, showQuickCapture, toggleDevtools, untitledNotePath } from '@reflect/core'
import { startOperation } from '@/lib/operations'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'
import { rebuildIndexVisibly } from '@/lib/rebuild-index'
import { openRouteInNewWindow } from '@/lib/windows/open-in-new-window'
import { routeForPath, type Route } from '@/routing/route'
import { NOTE_ACTION_COMMANDS } from './note-action-commands'
import { registerCommands } from './registry'
import type { AppCommand, CommandContext } from './types'

/**
 * The first-wave commands (Plan 08). Keybindings here replace the hardcoded
 * switch that used to live in `app-shortcuts.ts` — the binding and the
 * behavior are one definition now.
 */

/**
 * A fresh note route; the file itself is created lazily on the first keystroke
 * (the same contract as daily notes). Shared by ⌘N and the All Notes screen's
 * New note button so "what a new note is" stays one definition.
 */
export function newNoteRoute(): Route {
  return { kind: 'note', path: untitledNotePath() }
}

/**
 * ⌘N from the daily stream leaves its saved scroll offsets behind as stale
 * state: the fresh note is where attention moves, so a later return to the
 * stream — ⌘[ back or the Daily nav tab — should re-anchor to its target, not
 * restore the pre-note position. Other routes keep their offsets; only the
 * stream re-anchors around note creation.
 */
function openNewNote(context: CommandContext): void {
  const route = context.route()
  if (route.kind === 'today' || route.kind === 'daily') {
    context.clearScrollState()
  }
  context.navigate(newNoteRoute())
}

const GRAPH_SWITCH_COMMANDS: AppCommand[] = Array.from({ length: 9 }, (_, index) => {
  const position = index + 1
  return {
    id: `graph.switch${position}`,
    title: `Switch to graph ${position}`,
    keywords: ['graph', 'workspace', 'switch', 'recent'],
    keybinding: `Meta-${position}`,
    run: (context) => context.switchGraph(index),
  }
})

const APP_COMMANDS: AppCommand[] = [
  ...GRAPH_SWITCH_COMMANDS,
  {
    id: 'nav.today',
    title: 'Go to today',
    keywords: ['daily', 'now'],
    keybinding: 'Mod-d',
    // ⌘D is a capture gesture, not just navigation: the arrival asks the
    // stream to focus today's editor with the caret at the end of its
    // content, ready to append — the same one-shot `focusEditor` intent as
    // the mobile Daily-tab double-tap. Ordinary daily links and history
    // moves stay on the calm default (focus at the note start, or none).
    run: (context) => context.navigate({ kind: 'today' }, { focusEditor: true }),
  },
  {
    id: 'nav.allNotes',
    title: 'All notes',
    keywords: ['notes', 'list', 'browse', 'library'],
    keybinding: 'Mod-Shift-a',
    run: (context) => context.navigate({ kind: 'allNotes', tag: null }),
  },
  {
    id: 'nav.tasks',
    title: 'Tasks',
    keywords: ['todo', 'todos', 'checklist', 'checkbox', 'open'],
    keybinding: 'Mod-t',
    run: (context) => context.navigate({ kind: 'tasks' }),
  },
  {
    id: 'note.new',
    title: 'New note',
    keywords: ['create'],
    keybinding: 'Mod-n',
    run: openNewNote,
  },
  {
    id: 'browser.open',
    title: 'Open browser',
    keywords: ['web', 'duckduckgo', 'browse', 'internet'],
    // The built-in browser is a workspace surface now — a tab, not a
    // separate window. Desktop-only, like the terminal.
    run: (context) => {
      if (isMobileSurface()) {
        return
      }
      context.navigate({ kind: 'browser' })
    },
  },
  {
    id: 'capture.quick',
    title: 'Quick capture to today',
    keywords: ['inbox', 'append', 'today', 'global', 'shortcut'],
    keybinding: 'Mod-Shift-c',
    run: () => {
      if (!isNativeShell()) {
        return
      }
      void showQuickCapture().catch((cause: unknown) => {
        startOperation('Quick capture').fail(errorMessage(cause))
      })
    },
  },
  {
    id: 'note.openInNewWindow',
    title: 'Open note in new window',
    keywords: ['window', 'duplicate', 'pop out'],
    keybinding: 'Mod-Shift-o',
    // `notePath` follows the focused day inside the daily stream. Converting
    // that path back to a route also canonicalizes Today to a dated daily
    // link, so every way of opening the day dedupes to the same window.
    run: async (context) => {
      const path = context.notePath()
      if (path === null) {
        return
      }
      await openRouteInNewWindow(routeForPath(path))
    },
  },
  {
    id: 'note.find',
    title: 'Find in note…',
    keywords: ['search', 'text', 'page'],
    keybinding: 'Mod-f',
    run: (context) => context.openNoteFind(),
  },
  {
    id: 'note.findNext',
    title: 'Find next',
    keywords: ['search', 'match', 'forward'],
    keybinding: 'Mod-g',
    run: (context) => context.findNextInNote(),
  },
  {
    id: 'note.findPrevious',
    title: 'Find previous',
    keywords: ['search', 'match', 'backward'],
    keybinding: 'Mod-Shift-g',
    run: (context) => context.findPreviousInNote(),
  },
  {
    id: 'nav.insights',
    title: 'Insights',
    keywords: ['stats', 'statistics', 'activity', 'graph', 'metrics', 'heatmap'],
    run: (context) => context.navigate({ kind: 'insights' }),
  },
  {
    id: 'nav.graphMap',
    title: 'Graph',
    keywords: ['map', 'links', 'network', 'connections', 'visual'],
    run: (context) => context.navigate({ kind: 'graphMap' }),
  },
  {
    id: 'nav.terminal',
    title: 'Terminal',
    keywords: ['shell', 'pty', 'console', 'ghostty', 'xterm'],
    run: (context) => {
      if (isMobileSurface()) {
        return
      }
      context.navigate({ kind: 'terminal' })
    },
  },
  {
    id: 'nav.agents',
    title: 'Agents',
    keywords: ['agent', 'soul', 'memory', 'profiles', 'ai', 'persona'],
    run: (context) => context.navigate({ kind: 'agents' }),
  },
  {
    id: 'chat.open',
    title: 'Chat',
    keywords: ['ai', 'assistant', 'copilot', 'ask'],
    keybinding: 'Mod-j',
    run: (context) => context.navigate({ kind: 'chat' }),
  },
  {
    id: 'chat.summarizeNote',
    title: 'Summarize note with AI',
    keywords: ['ai', 'assistant', 'summary', 'tldr', 'recap'],
    run: (context) => context.summarizeNote(),
  },
  {
    id: 'chat.new',
    title: 'New chat',
    keywords: ['ai', 'assistant', 'copilot', 'conversation'],
    keybinding: 'Mod-Shift-n',
    run: (context) => {
      if (context.route().kind !== 'chat') {
        return
      }
      context.newChat()
    },
  },
  {
    id: 'history.back',
    title: 'Back',
    keybinding: 'Mod-[',
    run: (context) => context.back(),
  },
  {
    id: 'history.forward',
    title: 'Forward',
    keybinding: 'Mod-]',
    run: (context) => context.forward(),
  },
  {
    id: 'palette.open',
    title: 'Search…',
    keywords: ['find', 'open'],
    keybinding: 'Mod-k',
    run: (context) => context.openPalette(),
  },
  // The note-action commands (pin, privacy, sharing, copying, exporting,
  // random note) live in `note-action-commands.ts`, spread here at their
  // original position so ids, ordering, and registration are unchanged.
  ...NOTE_ACTION_COMMANDS,
  {
    id: 'template.insert',
    title: 'Insert template…',
    keywords: ['snippet', 'boilerplate', 'stamp'],
    // Inserts into the note the current route edits (the focused stream day on
    // daily views); on screens with no note there is nothing to insert into.
    // The picker itself carries the empty state — a "New template" row — so
    // the command stays discoverable before any template exists.
    run: (context) => {
      if (context.notePath() === null) {
        return
      }
      context.openTemplatePicker()
    },
  },
  {
    id: 'template.new',
    title: 'New template',
    keywords: ['template', 'snippet', 'boilerplate', 'create'],
    run: (context) => context.openTemplateCreate(),
  },
  {
    id: 'audioMemo.toggle',
    title: 'Record audio memo',
    keywords: ['voice', 'mic', 'dictate', 'transcribe', 'speech', 'capture'],
    keybinding: 'Mod-Shift-r',
    run: (context) => context.toggleAudioMemo(),
  },
  {
    id: 'theme.toggle',
    title: 'Toggle theme',
    keywords: ['dark', 'light', 'appearance'],
    run: (context) => context.toggleTheme(),
  },
  {
    id: 'sidebar.toggle',
    title: 'Toggle sidebar',
    keywords: ['collapse', 'expand', 'navigation', 'focus'],
    keybinding: 'Mod-\\',
    run: (context) => context.toggleSidebar(),
  },
  {
    id: 'sidebar.toggleContext',
    title: 'Toggle context panel',
    keywords: ['collapse', 'expand', 'details', 'rail', 'right', 'focus'],
    keybinding: 'Mod-Shift-\\',
    run: (context) => context.toggleContextSidebar(),
  },
  {
    id: 'tabs.next',
    title: 'Next tab',
    keywords: ['tab', 'cycle', 'switch', 'open', 'notes'],
    keybinding: 'Ctrl-tab',
    run: (context) => context.nextTab(),
  },
  {
    id: 'tabs.previous',
    title: 'Previous tab',
    keywords: ['tab', 'cycle', 'switch', 'open', 'notes'],
    keybinding: 'Ctrl-Shift-tab',
    run: (context) => context.previousTab(),
  },
  {
    id: 'tabs.close',
    title: 'Close tab',
    keywords: ['tab', 'close', 'open', 'notes'],
    keybinding: 'Mod-w',
    run: (context) => context.closeActiveTab(),
  },
  {
    id: 'settings.open',
    title: 'Open settings',
    keywords: ['preferences', 'config', 'options'],
    keybinding: 'Mod-,',
    run: (context) => context.navigate({ kind: 'settings' }),
  },
  {
    id: 'shortcuts.show',
    title: 'Keyboard shortcuts',
    keywords: ['cheat', 'sheet', 'keys', 'bindings', 'hotkeys', 'help'],
    keybinding: 'Mod-/',
    run: (context) => context.openShortcuts(),
  },
  {
    id: 'note.replaceInVault',
    title: 'Replace in vault…',
    keywords: ['find', 'replace', 'rename', 'substitute', 'all notes', 'everywhere', 'bulk'],
    // No keybinding on purpose. This is the one command in the registry that
    // rewrites prose across every note; it should not be one chord away from
    // a mistyped shortcut, and the palette keeps it reachable in three
    // keystrokes anyway.
    run: (context) => {
      context.openVaultReplace()
    },
  },
  {
    id: 'semantic.enable',
    title: 'Enable semantic search',
    keywords: ['embeddings', 'ai', 'similar', 'model'],
    // Downloads the local model (~90MB) — deliberately opt-in, never
    // automatic: the first network fetch is the user's call. Persisting the
    // setting is the entire command — EmbeddingsSync loads the model when the
    // flag flips on and backfills once it's `ready`; later launches load from
    // cache without asking again.
    run: (context) => context.enableSemanticSearch(),
  },
  {
    id: 'index.rebuild',
    title: 'Rebuild search index',
    keywords: ['reindex', 'refresh'],
    run: async (context) => {
      const generation = context.generation()
      if (generation === null) {
        return
      }
      await rebuildIndexVisibly(generation)
    },
  },
  {
    id: 'dev.toggleDevtools',
    title: 'Developer tools',
    keywords: ['devtools', 'inspector', 'debug', 'console', 'inspect', 'web inspector'],
    // The web inspector ships in every build (see `src-tauri/src/devtools.rs`),
    // so users can always debug. Plain-browser dev has no native shell — and its
    // own DevTools — so this no-ops there rather than throwing through the
    // bridge. Errors are swallowed: a debug affordance never interrupts the user.
    keybinding: 'Mod-Shift-i',
    run: async () => {
      if (!isNativeShell()) {
        return
      }
      try {
        await toggleDevtools()
      } catch {
        // Best effort — opening the inspector is never worth a surfaced failure.
      }
    },
  },
]

/**
 * The registered keybinding for `commandId`, or `null` when the command has
 * none (or the id is unknown). UI hints — sidebar keycaps, "go to today"
 * affordances — derive bindings through this so they can never drift from the
 * command definition, and disappear if the binding ever does.
 */
export function keybindingFor(commandId: string): string | null {
  return APP_COMMANDS.find((command) => command.id === commandId)?.keybinding ?? null
}

let registered = false

/**
 * Register the first-wave commands. Called explicitly from `main.tsx` (and by
 * tests) — registration as an import side effect couples behavior to module
 * graph order, which is exactly the kind of spooky action a registry invites.
 * Idempotent: hosts and tests can call it without coordinating.
 */
export function registerAppCommands(): void {
  if (registered) {
    return
  }
  registered = true
  registerCommands(APP_COMMANDS)
}

export { APP_COMMANDS }
