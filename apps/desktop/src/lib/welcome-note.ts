import {
  getIndexMeta,
  newNoteId,
  notePath,
  setIndexMeta,
  slugForTitle,
  upsertFrontmatter,
  vaultScanStats,
  writeDefaultVaultObjects,
  writeNote,
} from '@reflect/core'

/**
 * The first-run seeds (Plan 15 step 1 + TDR 0005's default objects): a
 * brand-new graph gets one short, pinned "How to use Kore" note and the
 * default typed supertags (Project, Person, Company, Meeting under `tags/`).
 * The welcome note doubles as the optional-setup surface — backup and AI
 * keys are pointers into Settings, not a wizard — so onboarding never gates
 * the editor and "skipping" is just not reading the note. The objects are
 * plain deletable markdown: content, never behavior.
 */

const WELCOME_TITLE = 'How to use Kore'

/** Title-derived slug path, same birth rules as any titled note. */
export const WELCOME_NOTE_PATH = notePath(slugForTitle(WELCOME_TITLE))

/**
 * The `index_meta` key marking that onboarding was considered for this graph.
 * `index_clear` deliberately preserves `index_meta`, so the marker survives
 * index rebuilds; only deleting `.reflect/` wholesale resets it.
 */
export const WELCOME_SEEDED_META_KEY = 'welcomeSeeded'

/** Same contract, one marker per seed: the default objects are considered
 * independently, so a graph that predates them (welcome already marked) is
 * marked without being written into. */
export const DEFAULT_OBJECTS_SEEDED_META_KEY = 'defaultObjectsSeeded'

const WELCOME_BODY = `# ${WELCOME_TITLE}

Kore keeps your notes in Markdown and lets your own AI work with them.
Start with today's note (⌘D). Everything else is optional.

## Try one useful loop

1. **Capture.** Write a decision in today's note. Add a title inside \`[[double brackets]]\` to connect it to a project or person.
2. **Ask.** In Settings → AI & agents, connect Claude Code or Codex with your subscription, or add a provider API key. Open chat (⌘J) and ask about that decision.
3. **Verify.** Expand **Context used** under the reply to see the notes included with your question. Open a source to check the answer.

## When you want more

- **Find notes:** ⌘K searches your graph; ⌘/ lists shortcuts.
- **Collections:** open a tag from the sidebar to view its notes. Configure properties to organize projects, people, companies or meetings.
- **Agents:** give an assistant its own instructions. Create an automation only when you want scheduled work; each automation belongs to one graph.
- **Protect your work:** Settings → Sync & data distinguishes Git file sync from a graph archive. An archive also includes saved chats, their images and this graph's automations.

Notes marked \`private: true\` are blocked from AI and content-processing services. They are still included in backups and any file sync you enable. Keep backups private. Provider keys stay in the OS keychain and are not exported.

This note is pinned to the sidebar — unpin it (⌘O) when you're done.
`

export interface EnsureWelcomeNoteOptions {
  /** File-write generation (`graph.generation`) — pins the listing and write. */
  fileGeneration: number
  /** Index-session generation (`index_open`) — pins the meta marker. */
  indexGeneration: number
}

/**
 * Consider every first-run seed for this graph **exactly once each**: when a
 * seed's marker is absent, an **empty** graph gets its content, while any
 * existing content means this is someone's data and only gets marked. Empty
 * means the scan found nothing at all — no notes, no attachments, and
 * nothing it had to skip: a folder of PDFs, or one whose files were
 * unreadable, must not be seeded into. One scan decides for the whole batch,
 * so the welcome note landing first cannot make the vault look non-empty to
 * the default objects. Either way the markers land, so deleting a seeded
 * note — or emptying the graph entirely — never re-seeds; a graph that
 * predates a seed (its other markers already set) is marked without being
 * written into. Markers are stamped after their writes: a failed seed
 * retries on the next open, converging to marking once its files exist.
 * Returns whether the graph was the brand-new case.
 */
export async function ensureFirstRunSeeds(options: EnsureWelcomeNoteOptions): Promise<boolean> {
  const [welcomeMarked, objectsMarked] = await Promise.all([
    getIndexMeta(WELCOME_SEEDED_META_KEY),
    getIndexMeta(DEFAULT_OBJECTS_SEEDED_META_KEY),
  ])
  if (welcomeMarked !== null && objectsMarked !== null) {
    return false
  }
  const stats = await vaultScanStats(options.fileGeneration)
  const empty = stats.notes === 0 && stats.attachments === 0 && stats.skipped === 0
  // Brand-new means never considered before AND empty: a graph the welcome
  // marker already knows — even one the user has since emptied — is not a
  // new vault, so a later-added seed only ever records its marker there.
  const brandNew = welcomeMarked === null && empty
  if (welcomeMarked === null) {
    if (empty) {
      const source = upsertFrontmatter(WELCOME_BODY, { id: newNoteId(), pinned: true })
      await writeNote(WELCOME_NOTE_PATH, source, options.fileGeneration)
    }
    await setIndexMeta(WELCOME_SEEDED_META_KEY, 'true', options.indexGeneration)
  }
  if (objectsMarked === null) {
    if (brandNew) {
      await writeDefaultVaultObjects(options.fileGeneration)
    }
    await setIndexMeta(DEFAULT_OBJECTS_SEEDED_META_KEY, 'true', options.indexGeneration)
  }
  return brandNew
}
