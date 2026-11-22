import {
  birthPathForTitle,
  errorMessage,
  getBacklinks,
  getLinkSources,
  getPathLinkSources,
  isKoreManagedNote,
  isUntitledNotePath,
  noteFileStem,
  readNote,
  resolveWikiTarget,
  rewriteLinksForTitleChange,
  rewritePathLinksForMove,
  slugPathForTitle,
  titleFilePathForRetitle,
  writeNote,
} from '@kore/core'
import { placeOldTitleAlias } from './alias-placement'
import { clearDraftTitle, setDraftTitle } from './draft-titles'
import { moveNoteCarryingSession } from './move-note'
import type { NoteContentOrigin } from './note-session'
import { composeRenameFailure, type RenamePhaseFailures } from './rename-failure'
import { startOperation } from '@/lib/operations'
import { authoredTitleOf, createTitleRenameTracker } from './title-rename'
import type { TitleRename } from './title-rename'

/**
 * Owns one note's auto-rename lifecycle: the settled-title tracker, serialized
 * link maintenance, old-title alias placement, and the optional **file move**
 * that keeps a Kore-managed filename a projection of the title
 * (`docs/readable-filenames.md`). Adopted and stable-path notes participate in
 * link maintenance but keep their paths.
 *
 * A settled rename can run three phases, each failing independently with an
 * honest report (see `rename-failure.ts`):
 *
 * 1. **Rewrite** inbound title targets and title-mirroring displays;
 * 2. **Alias** the old title onto this note (`alias-placement.ts`) — the
 *    safety net for links the rewrite missed;
 * 3. **Move** the file onto the new title's slug (`move-note.ts`).
 *
 * A *birth* (the first authored title on an untitled note) runs phase 3 alone
 * for Kore-managed notes; other notes already have their permanent path.
 *
 * Extracted from `useNoteDocument` for the same reason the session was —
 * lifecycle coupling (pane teardown, quit, note switches) belongs to an owned
 * object, not to effect-closure flags. The rename path holds no React ref and
 * no session of its own: session liveness comes from the open-documents
 * service at placement time, and status surfaces through the global
 * operations store — a rename is app-level background work, not pane state.
 *
 * The coordinator tracks its note's **current** path: a landed move retargets
 * the live session, the open-documents registration, and this coordinator in
 * place, so a follow-up rename in the same pane session continues the alias
 * chain against the right file.
 */

export interface RenameCoordinatorOptions {
  /** Graph-relative path of the (possibly renamed) note. */
  path: string
  /** Read the graph generation at rewrite time — never captured early. */
  generation: () => number | null
  /**
   * Gate: no rename fires while false (a parked conflict contests the very
   * content the title came from; "keep mine" re-arms, "load theirs" cancels).
   */
  canFire: () => boolean
}

export interface RenameCoordinator {
  /** Wire into the session's `onContent` stream (load/external/saved). */
  content(content: string, origin: NoteContentOrigin): void
  /** Follow an external move that retargeted the open session in place. */
  retarget(nextPath: string): void
  /** A settle point (blur, teardown, quit): fire any pending rename now. */
  settle(): void
  /** Resolves once settled renames' writes have landed (quit awaits this). */
  settled(): Promise<void>
  dispose(): void
}

export function createRenameCoordinator(options: RenameCoordinatorOptions): RenameCoordinator {
  const { generation, canFire } = options
  /** The note's current path — a landed move advances it (Plan 17). */
  let currentPath = options.path
  /** Serializes rewrites — a second settle waits for the first. */
  let chain: Promise<void> = Promise.resolve()
  /** This coordinator's identity in the draft-title store (see `draft-titles.ts`). */
  const draftOwner = {}
  /** Latest source saved or adopted by this session, used only for move ownership. */
  let latestSource = ''

  /**
   * Move the file onto the path its title derives (Plan 17). A failed move
   * leaves the filename drifting until the next settled rename re-derives it.
   */
  const runMove = async (
    target: string,
    gen: number,
    options?: { rewriteInboundPathLinks?: boolean },
  ): Promise<void> => {
    if (target === currentPath) {
      return
    }
    const from = currentPath
    await moveNoteCarryingSession(from, target, gen)
    currentPath = target
    // The note is named now: its tab reads the index under the slug path.
    clearDraftTitle(from, draftOwner)
    // Retarget inbound `[[notes/…]]` path links only after the move landed: a
    // refused move then touches nothing (rollback for free), while the
    // reverse order would strand every rewritten source on a destination that
    // never materialized. The source query still works post-move — the
    // sources' own index rows keep the old target key until they reproject.
    // A per-source failure dangles that source alone, the same residue as
    // before. Births skip this: nothing can hold a path link to a placeholder
    // path that existed only inside this session.
    if (options?.rewriteInboundPathLinks === true) {
      try {
        await rewritePathLinksForMove(from, target, {
          pathLinkSources: getPathLinkSources,
          read: readNote,
          write: (forPath, contents) => writeNote(forPath, contents, gen),
        })
      } catch (cause) {
        console.error('path link rewrite failed:', cause)
      }
    }
  }

  // Rewrite inbound links across the graph, record the old title as an alias,
  // then move only a Kore-managed file onto the new title's slug. Every
  // write carries the generation read at run time (stale → loud rejection in
  // Rust). A rename pending across a graph switch is dropped, never
  // cross-written.
  const runRename = (rename: TitleRename): void => {
    chain = chain.then(async () => {
      const gen = generation()
      if (gen === null) {
        // Unreachable in the current wiring (a rename only arms after a save,
        // which requires a generation; an unmounted pane's ref keeps its
        // non-null value) — but the tracker's baseline has already advanced,
        // so if a future caller gets here the drop must be loud, not silent.
        console.error(
          `rename dropped (no graph generation): "${rename.from ?? ''}" → "${rename.to}" on ${currentPath}`,
        )
        return
      }
      if (rename.from === null) {
        if (!isKoreManagedNote(currentPath, latestSource)) {
          return
        }
        // A birth: the first authored title on an untitled note. Nothing
        // links to a title that never existed — no rewrite, no alias — but
        // the file sheds its placeholder name for the title's slug.
        const operation = startOperation(`Naming "${rename.to}"`)
        try {
          // A birth may land in the note's type folder (`folder:` on the type).
          await runMove(await birthPathForTitle(currentPath, rename.to, latestSource), gen)
          operation.done()
        } catch (cause) {
          console.error('note file move failed:', cause)
          operation.fail(
            `${errorMessage(cause)} — the note keeps its placeholder filename; the title and its links are unaffected`,
          )
        }
        return
      }
      const from = rename.from
      const operation = startOperation(`Renaming "${from}" → "${rename.to}"`)
      // The phases fail independently and the report says what held — the
      // permutations live in `composeRenameFailure`.
      const failures: RenamePhaseFailures = { rewrite: null, alias: null, move: null }
      try {
        // Which file move this retitle carries, if any: a Kore-managed note
        // re-derives its slug name; in a vault that names files after titles
        // (Obsidian), a note named after its old title is renamed in place,
        // and its links then address the new filename. Other notes keep
        // their paths. Decided before the rewrite, which needs the address.
        const managed = isKoreManagedNote(currentPath, latestSource)
        const inPlaceTarget = managed
          ? null
          : await titleFilePathForRetitle(currentPath, { from, to: rename.to })
        let collision = false
        // Whether every link to the old title now addresses the new one, so
        // nothing needs the old title as an alias to keep resolving.
        let linksFollowed = false
        try {
          const result = await rewriteLinksForTitleChange({
            path: currentPath,
            from,
            to: rename.to,
            target: inPlaceTarget === null ? undefined : noteFileStem(inPlaceTarget),
            io: {
              sources: getLinkSources,
              backlinks: getBacklinks,
              read: readNote,
              write: (forPath, contents) => writeNote(forPath, contents, gen),
              resolve: resolveWikiTarget,
            },
            onProgress: operation.progress,
          })
          collision = result.collision
          linksFollowed = !result.destinationBlocked && result.failed.length === 0
        } catch (cause) {
          // A failed rewrite must NOT skip the alias below: the tracker's
          // baseline has already advanced (re-arming would re-fire with a
          // stale `from` after further edits), so the alias is the safety
          // net that keeps every un-rewritten link resolving to this note.
          failures.rewrite = errorMessage(cause)
          console.error('rename link rewrite failed:', cause)
        }
        // An in-place rename follows the links: when they could not all be
        // repointed (the new name belongs to another note, or a source was
        // unwritable), the file keeps the name those links still use.
        const moveTarget = managed
          ? await slugPathForTitle(currentPath, rename.to)
          : linksFollowed
            ? inPlaceTarget
            : null
        let renamedInPlace = false
        if (moveTarget !== null) {
          try {
            await runMove(moveTarget, gen, { rewriteInboundPathLinks: true })
            renamedInPlace = !managed
          } catch (cause) {
            failures.move = errorMessage(cause)
            console.error('note file move failed:', cause)
          }
        }
        // The old title becomes an alias so links the rewrite missed still
        // resolve, except after an in-place Obsidian rename, which only runs
        // once every link moved: there, as in Obsidian, the filename is the
        // only name.
        if (!collision && !renamedInPlace) {
          try {
            await placeOldTitleAlias(currentPath, { ...rename, from }, gen)
          } catch (cause) {
            failures.alias = errorMessage(cause)
            console.error('rename alias placement failed:', cause)
          }
        }
      } finally {
        const failure = composeRenameFailure(from, failures)
        if (failure !== null) {
          operation.fail(failure)
        } else {
          operation.done()
        }
      }
    })
  }

  const tracker = createTitleRenameTracker({
    path: options.path,
    onRename: runRename,
    canFire,
  })

  return {
    content(content: string, origin: NoteContentOrigin): void {
      latestSource = content
      // A ⌘N note keeps its placeholder path until the birth rename settles;
      // publish the typed title so its tab names it right away.
      if (isUntitledNotePath(currentPath)) {
        setDraftTitle(currentPath, authoredTitleOf(currentPath, content), draftOwner)
      }
      if (origin === 'saved') {
        tracker.saved(content)
      } else {
        tracker.baseline(content) // load/external: new ground truth, no rewrite
      }
    },
    retarget(nextPath: string): void {
      if (nextPath === currentPath) {
        return
      }
      clearDraftTitle(currentPath, draftOwner)
      currentPath = nextPath
    },
    settle(): void {
      tracker.settle()
    },
    settled(): Promise<void> {
      return chain
    },
    dispose(): void {
      tracker.dispose()
      clearDraftTitle(currentPath, draftOwner)
    },
  }
}
