import { errorMessage, getNote, getPinnedNotes, randomNotePath } from '@reflect/core'
import { attachFilesToNote } from '@/lib/attach-files'
import { runCopyNotePath } from '@/lib/note-copy-path'
import { runCopyDeepLink } from '@/lib/note-deep-link'
import { runNoteExport } from '@/lib/note-export'
import { runGistPublish } from '@/lib/note-gist'
import { toggleNotePinned } from '@/lib/note-pin'
import { toggleNotePrivate } from '@/lib/note-private'
import { startOperation } from '@/lib/operations'
import type { AppCommand } from './types'

/**
 * The note-action commands — pin, privacy, sharing, copying, exporting, and
 * the random-note jump. Split out of `app-commands.ts` purely for file size;
 * they are spread back into `APP_COMMANDS` at their original position, so ids,
 * ordering, and registration semantics are unchanged.
 */
export const NOTE_ACTION_COMMANDS: AppCommand[] = [
  {
    id: 'note.togglePin',
    title: 'Pin or unpin note',
    keywords: ['pinned', 'favorite', 'bookmark', 'sidebar'],
    // The original app's pin shortcut. Flips the `pinned` frontmatter flag of
    // the note the current route edits; on search/settings there is no such
    // note and the command is a no-op.
    keybinding: 'Mod-o',
    run: async (context) => {
      const generation = context.generation()
      const path = context.notePath()
      if (generation === null || path === null) {
        return
      }
      // Read the current state first so a failure is surfaced with the toggle's
      // actual direction — the sidebar's pin/unpin wording — not a fixed label.
      let wasPinned = false
      try {
        wasPinned = (await getPinnedNotes()).some((note) => note.path === path)
        await toggleNotePinned(path, generation)
      } catch (cause) {
        // runCommand has no error channel of its own — an unreported failure
        // here would be a silent ⌘O. Surface it like other background work.
        startOperation(wasPinned ? 'Unpinning note' : 'Pinning note').fail(errorMessage(cause))
      }
    },
  },
  {
    id: 'note.togglePrivate',
    title: 'Mark or un-mark note as private',
    keywords: ['privacy', 'lock', 'secret', 'hide', 'ai'],
    // Flips the `private` frontmatter flag — the hard block on sending the
    // note's content to AI or any other external service — of the note the
    // current route edits. No default keybinding: the palette keeps it
    // keyboard-reachable without spending a shortcut.
    run: async (context) => {
      const generation = context.generation()
      const path = context.notePath()
      if (generation === null || path === null) {
        return
      }
      // Read the current flag first so a failure is surfaced with the toggle's
      // actual direction — the sidebar's Lock/Unlock wording — instead of a
      // fixed "private" label that misreads when the user is unlocking.
      let wasPrivate = false
      try {
        wasPrivate = (await getNote(path))?.isPrivate ?? false
        await toggleNotePrivate(path, generation)
      } catch (cause) {
        startOperation(wasPrivate ? 'Unlocking note' : 'Locking note').fail(errorMessage(cause))
      }
    },
  },
  {
    id: 'note.publishGist',
    title: 'Share with private link',
    keywords: ['gist', 'github', 'share', 'publish', 'private link', 'export'],
    // Publishes the body of the note the current route edits to a secret
    // GitHub gist (republishing to the same gist thereafter) and copies the
    // link. No default keybinding: the palette keeps it keyboard-reachable
    // without spending a shortcut. `runGistPublish` owns all feedback — the
    // progress line, the failure surface, and the "link copied" confirmation.
    run: async (context) => {
      const generation = context.generation()
      const path = context.notePath()
      if (generation === null || path === null) {
        return
      }
      await runGistPublish(path, generation)
    },
  },
  {
    id: 'note.attachFile',
    title: 'Attach file…',
    keywords: ['upload', 'attachment', 'import', 'pdf', 'document', 'insert'],
    // Native file picker → copies into the graph's `assets/` → a markdown
    // link per file at the caret (the keyboard-native twin of dropping a
    // file on the note). No default keybinding: the palette keeps it
    // keyboard-reachable without spending a shortcut.
    run: (context) => attachFilesToNote(context),
  },
  {
    id: 'note.copyDeepLink',
    title: 'Copy deep link',
    keywords: ['url', 'share', 'clipboard', 'reflect://', 'address'],
    // The original app's copy-link shortcut. Copies a `reflect://` address for
    // the note the current route edits — id-shaped so it survives renames,
    // minting the frontmatter id on first copy. `runCopyDeepLink` owns all
    // feedback (the "Deep link copied" status line and failure surfaces).
    keybinding: 'Alt-Mod-l',
    run: async (context) => {
      const generation = context.generation()
      const path = context.notePath()
      if (generation === null || path === null) {
        return
      }
      await runCopyDeepLink(path, generation)
    },
  },
  {
    id: 'note.copyPath',
    title: 'Copy note path',
    keywords: ['file', 'absolute', 'filesystem', 'clipboard', 'location'],
    // The OS-path sibling of "Copy deep link": copies the note's absolute
    // file path (Finder's Copy-as-Pathname chord) for use outside Reflect,
    // where a reflect:// address cannot resolve. `runCopyNotePath` owns all
    // feedback (the "Note path copied" status line and failure surfaces).
    keybinding: 'Alt-Mod-c',
    run: async (context) => {
      const path = context.notePath()
      if (path === null) {
        return
      }
      await runCopyNotePath(context.graphRoot(), path)
    },
  },
  {
    id: 'note.export',
    title: 'Export note as styled HTML…',
    keywords: ['export', 'html', 'pdf', 'print', 'save', 'download', 'share'],
    // Saves a self-contained HTML rendering of the note the current route
    // edits, in the app's design language (the file's floating button prints
    // to PDF). No default keybinding: the palette keeps it keyboard-reachable
    // without spending a shortcut. `runNoteExport` owns all feedback.
    run: async (context) => {
      const generation = context.generation()
      const path = context.notePath()
      if (generation === null || path === null) {
        return
      }
      await runNoteExport(path, generation)
    },
  },
  {
    id: 'note.random',
    title: 'Open random note',
    keywords: ['shuffle', 'serendipity'],
    run: async (context) => {
      const path = await randomNotePath()
      if (path !== null) {
        context.navigate({ kind: 'note', path })
      }
    },
  },
]
