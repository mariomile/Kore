import { errorMessage, isAppError } from '../errors'
import { listFiles, readNote } from '../graph/commands'
import { parseNote } from '../markdown'
import {
  createIndexApplyBatch,
  createMtimeTouchBatch,
  INDEX_PATH_BATCH_SIZE,
  type SkippedIndexedNote,
} from './apply-batch'
import {
  applyIndexedNote,
  clearIndex,
  moveIndexedRows,
  reconcileScan,
  removeFromIndexBatch,
  setIndexMeta,
} from './commands'
import { assetReferencingNotePaths } from './asset-refs'
import { gatherAssetDescriptionText } from './asset-description-text'
import { emitIndexApplied } from './index-applied'
import { hashContent } from './hash'
import {
  buildIndexedNote,
  PROJECTION_VERSION_KEY,
  projectionStamp,
  type IndexedNote,
} from './indexed-note'
import { detectExternalMoves } from './move-healing'
import { createPassPacer, INDEX_PASS_YIELD_EVERY } from './pacing'
import { getIndexedFileFacts, getIndexMeta, isProjectionCurrent } from './queries'
import {
  clearReprojectCheckpoint,
  readReprojectCheckpoint,
  REPROJECT_CHECKPOINT_EVERY,
  writeReprojectCheckpoint,
  type ReprojectCheckpoint,
} from './reproject-checkpoint'
import { refreshTagTypeResolutionsSafely } from './resolved-tag-types'

/**
 * The indexing pipeline (Plan 04): read (Plan 02) → parse/extract in TS
 * (Plan 03) → hash → hand the flattened projection to Rust, which applies it in
 * one transaction. The index is a rebuildable cache.
 *
 * Every write carries the index `generation` returned by `openIndex`. Rust
 * no-ops a write whose generation is stale, so a pass started for one graph can
 * never mutate a newly-opened index — cancellation is correct regardless of
 * caller timing (the watcher in Plan 04b indexes outside the serialized open
 * flow). The `AbortSignal` is an optimization that stops a superseded pass early.
 */

export {
  createIndexApplyBatch,
  createMtimeTouchBatch,
  INDEX_APPLY_BATCH_BYTES,
  INDEX_APPLY_BATCH_SIZE,
  INDEX_PATH_BATCH_SIZE,
  indexedNoteWeight,
  type IndexApplyBatch,
  type MtimeTouchBatch,
  type SkippedIndexedNote,
} from './apply-batch'

/**
 * Read, parse, and (re)index a single note for the given index generation.
 * Without an explicit `mtime` the row is stamped "now" — a watcher event means
 * the file just changed, and a real timestamp beats epoch zero (which would
 * sink the note to the bottom of every recency sort and, because reconcile is
 * content-hash gated, never get repaired).
 */
export async function indexNote(
  path: string,
  options: { generation: number; content?: string | undefined; mtime?: number | undefined },
): Promise<void> {
  const content = options.content ?? (await readNote(path))
  const fileHash = await hashContent(content)
  const note = await buildNoteProjection(path, content, {
    fileHash,
    mtime: options.mtime ?? Date.now(),
  })
  await applyIndexedNote(note, options.generation)
}

/**
 * Parse `content` and flatten it into the note's index projection — the one
 * home of the parse → asset-description-gather → build step that every
 * indexing path (single note, rebuild, reconcile, watcher batch) shares.
 * Callers hash first: the hash gates whether this (comparatively expensive)
 * step runs at all.
 */
export async function buildNoteProjection(
  path: string,
  content: string,
  facts: { fileHash: string; mtime: number },
): Promise<IndexedNote> {
  const parsed = parseNote({ path, source: content })
  const assetText = await gatherAssetDescriptionText(parsed.assets.map((asset) => asset.path))
  return buildIndexedNote(parsed, {
    fileHash: facts.fileHash,
    mtime: facts.mtime,
    source: content,
    assetText,
  })
}

/**
 * Re-index every note referencing any of `assetPaths` (Plan 20 search
 * integration). Asset descriptions are generated *after* their notes are
 * indexed, so when one is written the referencing notes' search rows are stale;
 * this folds the new description text into their FTS documents. `indexNote` is
 * not hash-gated, so the unchanged note files re-index unconditionally. A note
 * removed since it referenced the asset is skipped. Pinned to `generation`.
 *
 * The re-applied notes broadcast through {@link emitIndexApplied} — the same
 * post-apply signal the live indexer emits — because these writes bypass the
 * watcher pipeline entirely (`.kore.md` files are untracked by design).
 * Without it, subscribers that follow the index (the embedding sync above
 * all, which must re-embed the notes so the new description text reaches the
 * semantic leg too) would never hear about description-driven changes.
 */
export async function reindexNotesReferencing(
  assetPaths: readonly string[],
  generation: number,
): Promise<void> {
  const notePaths = new Set<string>()
  for (const assetPath of assetPaths) {
    for (const notePath of await assetReferencingNotePaths(assetPath)) {
      notePaths.add(notePath)
    }
  }
  const applied: string[] = []
  try {
    for (const notePath of notePaths) {
      try {
        await indexNote(notePath, { generation })
        applied.push(notePath)
      } catch (cause) {
        if (isAppError(cause) && cause.kind === 'notFound') {
          continue // the note was removed since it referenced the asset
        }
        throw cause
      }
    }
  } finally {
    // Emit even when a later note's re-index threw: whatever was applied is
    // real, and unnotified followers would serve stale vectors until the
    // next backfill.
    if (applied.length > 0) {
      emitIndexApplied(
        applied.map((path) => ({ path, kind: 'upsert' as const })),
        generation,
      )
    }
  }
}

/** Options for the long-running index passes. */
export interface IndexPassOptions {
  /** The index generation from `openIndex`; stale writes are dropped by Rust. */
  generation: number
  /** Aborts the pass early when the active graph changes. */
  signal?: AbortSignal
  /**
   * Called when a note cannot be read/projected, or its projection cannot be
   * written even after retrying outside the batch. A rebuild continues but
   * remains unstamped so the next sync retries the incomplete projection.
   * Without a callback, the failure is thrown.
   */
  onSkippedNote?: (note: SkippedIndexedNote) => void
  /**
   * Called after id-based move healing relocates a note's rows (Plan 17): an
   * external rename observed after the fact. The desktop layer uses it to
   * carry live sessions and rewrite routes, exactly as for an in-app rename
   * — without it, history entries keep pointing at the dead path.
   */
  onMoved?: (from: string, to: string) => void
  /**
   * Called as the pass advances through the file listing — at every pacing
   * break and once at the end — so a first index over thousands of notes can
   * show real progress instead of a frozen shell. `done` counts every listed
   * file the pass has moved past (skipped or indexed); `total` is the listing
   * size; `worked` counts the files actually *read* so far (not skipped
   * read-free by the mtime layer). `worked` is what distinguishes a genuine
   * first index from a routine repeat pass that skips everything — the
   * progress UI must gate on it, or a healthy sub-second pass flashes a
   * "preparing" surface on every open.
   *
   * `fromEmpty` is true only while the pass fills an index that has no
   * complete projection to answer from (a first index, or a wipe). A refresh
   * over existing rows (a projection bump, a reconcile) passes false: the
   * previous rows keep serving lists, search and backlinks, so the app is
   * usable and nothing needs to announce the pass.
   */
  onFileProgress?: (done: number, total: number, worked: number, fromEmpty: boolean) => void
  /**
   * Called (at most once per pass, non-empty) with iCloud-evicted notes whose
   * content the index lacks: files the pass had to skip unread — a reconcile's
   * stale/rowless placeholders, or every placeholder a rebuild couldn't
   * re-index after the wipe. The desktop layer requests targeted downloads
   * for exactly these; the materialized files then arrive as ordinary watcher
   * upserts and are indexed live. Without a caller wired, evicted content
   * simply stays unindexed until it materializes some other way.
   */
  onStalePlaceholders?: (paths: readonly string[]) => void
}

/**
 * Full rebuild: wipe derived tables and re-index every markdown file. Used for
 * explicit repair / schema-bump triggers, not the hot graph-switch path (that's
 * {@link reconcileIndex}). An aborted rebuild may leave a partial index after
 * the wipe; that is intentional for mobile suspension. `index_clear` preserves
 * metadata, so the next foreground sync either rebuilds again for an old stamp
 * or reconciles the missing rows for a current stamp. Both converge without
 * continuing to hold SQLite locks in the background.
 */
export async function rebuildIndex(options: IndexPassOptions): Promise<void> {
  await reprojectAllNotes(options, { mode: 'wipe', fromEmpty: true })
}

/** How a full re-derivation treats the rows that were there before. */
interface ReprojectPlan {
  readonly mode: 'wipe' | 'inPlace'
  /** Whether the index lacks a complete projection to serve meanwhile. */
  readonly fromEmpty: boolean
  /**
   * Resume an interrupted pass from its checkpoint: listed notes sorting at
   * or before `after` already carry the current projection and are not read
   * again, except the `evicted` ones that pass could not read.
   */
  readonly resume?: ReprojectCheckpoint
}

/**
 * The pass behind every full re-derivation: each listed note is read, hashed,
 * projected and applied. The modes differ only in what happens to the rows
 * that were there before.
 *
 * `'wipe'` is {@link rebuildIndex}: unstamp, empty the index, fill it again.
 *
 * `'inPlace'` is the projection-bump pass: notes are re-derived **over** their
 * existing rows. An app update that bumps the projection used to open onto an
 * empty index (no lists, no search, no backlinks) for as long as the vault
 * took to re-read, which on a few thousand notes was the first quarter minute
 * of every such launch. Here the previous projection keeps answering until
 * each note's rows are replaced, and rows whose file is gone (or evicted) are
 * dropped at the end. Only safe from a *stamped* index, whose rows are a
 * complete, merely outdated projection. The stamp stays stale until the pass
 * completes, so readers gated on `isProjectionCurrent` keep treating the
 * index as not current. An interrupted pass of either mode picks up on the
 * next open after its last checkpoint (see `reproject-checkpoint.ts`), so a
 * vault iOS keeps suspending still finishes instead of starting over.
 */
async function reprojectAllNotes(options: IndexPassOptions, plan: ReprojectPlan): Promise<void> {
  const { generation, onSkippedNote, onStalePlaceholders } = options
  const { mode, fromEmpty, resume } = plan
  const onFileProgress = options.onFileProgress
    ? (done: number, total: number, worked: number): void =>
        options.onFileProgress?.(done, total, worked, fromEmpty)
    : undefined
  if (options.signal?.aborted) {
    return // don't wipe the current index for an already-cancelled pass
  }
  if (mode === 'wipe') {
    await beginWipe(options)
    if (options.signal?.aborted) {
      return
    }
  }
  // A fixed order is what makes the checkpoint meaningful: "every note up to
  // this path is done" holds across launches only if the walk is the same.
  const files = (await listFiles()).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const stamp = projectionStamp()
  let sinceCheckpoint = 0
  /** Whether a checkpoint for this projection is stored and must be cleared. */
  let checkpointed = resume !== undefined
  /** Prefix notes the interrupted pass had to skip as evicted placeholders. */
  const unreadInPrefix = new Set(resume?.evicted)
  let skipped = false
  const reportSkipped = onSkippedNote
    ? (note: SkippedIndexedNote): void => {
        skipped = true
        onSkippedNote(note)
      }
    : undefined
  const batch = createIndexApplyBatch(generation, reportSkipped)
  const evicted: string[] = []
  /** Listed, readable notes: the rows an in-place pass keeps. */
  const kept = new Set<string>()
  const pacer = createPassPacer()
  let done = 0
  let worked = 0
  for (const file of files) {
    if (options.signal?.aborted) {
      return
    }
    done += 1
    if (done % INDEX_PASS_YIELD_EVERY === 0) {
      onFileProgress?.(done, files.length, worked)
    }
    await pacer.pause()
    if (options.signal?.aborted) {
      return
    }
    if (file.placeholder === true) {
      // Evicted to iCloud — unreadable until re-download. Its row is gone
      // (wiped, or dropped below), so after this pass the note is missing from search
      // entirely: surface it for a targeted download, and index it on the
      // materialization upsert.
      evicted.push(file.path)
      continue
    }
    kept.add(file.path)
    if (resume !== undefined && file.path <= resume.after && !unreadInPrefix.has(file.path)) {
      continue // re-derived by the interrupted pass this one resumes
    }
    worked += 1
    let projection: IndexedNote
    try {
      const content = await readNote(file.path)
      const fileHash = await hashContent(content)
      projection = await buildNoteProjection(file.path, content, {
        fileHash,
        mtime: file.modifiedMs,
      })
    } catch (cause) {
      if (reportSkipped === undefined) {
        throw cause
      }
      reportSkipped({ path: file.path, message: errorMessage(cause) })
      continue
    }
    if (options.signal?.aborted) {
      return
    }
    await batch.add(projection)
    sinceCheckpoint += 1
    // Once a note has been skipped, stop advancing: the next run must
    // retry it, so it has to resume from before it.
    if (sinceCheckpoint >= REPROJECT_CHECKPOINT_EVERY && !skipped) {
      sinceCheckpoint = 0
      await batch.flush()
      if (options.signal?.aborted || skipped) {
        return
      }
      // The placeholders seen so far all sort at or before this note: the
      // resumed pass reads them if they have materialized by then.
      await writeReprojectCheckpoint({ stamp, after: file.path, evicted }, generation)
      checkpointed = true
    }
  }
  if (options.signal?.aborted) {
    return
  }
  await batch.flush()
  if (options.signal?.aborted) {
    return
  }
  if (mode === 'inPlace') {
    await removeUnlistedRows(kept, options)
    if (options.signal?.aborted) {
      return
    }
  }
  onFileProgress?.(files.length, files.length, worked)
  if (evicted.length > 0) {
    onStalePlaceholders?.(evicted)
  }
  // The rows now match the current projection — stamp it so `syncIndex` can
  // reconcile cheaply from here on. A superseded pass stamps into a stale
  // generation, which Rust drops: the next open then rebuilds again, which is
  // the safe direction to fail in.
  if (!skipped) {
    await setIndexMeta(PROJECTION_VERSION_KEY, stamp, generation)
    if (checkpointed) {
      await clearReprojectCheckpoint(generation)
    }
  }
}

/** Unstamp, then wipe: the opening move of a {@link rebuildIndex}. */
async function beginWipe({ generation }: IndexPassOptions): Promise<void> {
  // Unstamp BEFORE the wipe, so "a rebuild is in flight" is visible to readers
  // rather than inferable only from a version mismatch. `syncIndex` arrives
  // here with an already-stale stamp, but the manual rebuild from Settings and
  // the command palette calls this directly with a current one, and every
  // reader that gates on `isProjectionCurrent` would otherwise see a green
  // light over a table that is empty, then partial. `listPrivateNotePaths` is
  // that reader, and it is the private-note deny list.
  //
  // It also makes an aborted rebuild resume as a rebuild: the stamp only comes
  // back at the end, so a pass cancelled midway leaves the projection honestly
  // marked stale instead of reconciling into a hole.
  await setIndexMeta(PROJECTION_VERSION_KEY, '', generation)
  // A wipe starts over: an earlier pass's progress no longer describes rows,
  // and resuming from it after an interruption would skip a wiped prefix.
  await clearReprojectCheckpoint(generation)
  await clearIndex(generation)
}

/**
 * Drop the rows an in-place pass did not replace: notes deleted since the
 * old projection was written, and evicted placeholders. A placeholder's row
 * goes too (as the wipe always did): kept, it would hold the outdated
 * projection for good, because its materialization upsert arrives with the
 * mtime the row already carries and is skipped read-free.
 */
async function removeUnlistedRows(
  kept: ReadonlySet<string>,
  { generation, signal }: IndexPassOptions,
): Promise<void> {
  const unlisted = [...(await getIndexedFileFacts()).keys()].filter((path) => !kept.has(path))
  for (let offset = 0; offset < unlisted.length; offset += INDEX_PATH_BATCH_SIZE) {
    if (signal?.aborted) {
      return
    }
    await removeFromIndexBatch(unlisted.slice(offset, offset + INDEX_PATH_BATCH_SIZE), generation)
  }
}

/**
 * The open-path sync: hash-reconcile when the stored rows were built by the
 * current {@link projectionStamp}; when they weren't, re-derive every note,
 * over the existing rows if an older app wrote them
 * or from empty if the index was never stamped. Reconcile compares
 * content hashes only, so it can never refresh rows whose *derivation* changed
 * — without this gate, columns added by a migration would keep their defaults
 * forever on unchanged files.
 */
export async function syncIndex(options: IndexPassOptions): Promise<void> {
  await syncNotes(options)
  // Once per open, so a tag inheritance pass that failed after an earlier
  // write heals here instead of waiting for the next definition edit.
  if (options.signal?.aborted !== true) {
    await refreshTagTypeResolutionsSafely(options.generation)
  }
}

async function syncNotes(options: IndexPassOptions): Promise<void> {
  if (await isProjectionCurrent()) {
    return await reconcileIndex(options)
  }
  const stamped = await getIndexMeta(PROJECTION_VERSION_KEY)
  // An unstamped index (fresh graph, or a wipe that never finished) has no
  // complete projection to keep serving, so it rebuilds from empty; a stamped
  // one is refreshed over its rows.
  const hasRows = stamped !== null && stamped !== ''
  const checkpoint = await readReprojectCheckpoint()
  if (checkpoint !== null) {
    // An earlier pass toward this very projection was interrupted (iOS
    // suspends the app as soon as it leaves the foreground). Its prefix is
    // done: continue after it, over the rows, whether that pass began with a
    // wipe or not. The skipped prefix is not re-read, so anything that
    // changed there while the app was closed is caught by the reconcile that
    // follows, which reads only those files.
    console.warn(
      `index: resuming the projection ${checkpoint.stamp} pass after "${checkpoint.after}"`,
    )
    await reprojectAllNotes(options, {
      mode: 'inPlace',
      fromEmpty: !hasRows,
      resume: checkpoint,
    })
    if (options.signal?.aborted !== true && (await isProjectionCurrent())) {
      await reconcileIndex(options)
    }
    return
  }
  // Loud on purpose: a rebuild is expected once per projection bump or fresh
  // graph. Seeing this on *every* open means the stamp (or the whole index
  // file) isn't persisting between launches — a pathology that would
  // otherwise be indistinguishable from a slow reconcile.
  console.warn(
    `index: stored projection version ${stamped === null ? 'none' : `"${stamped}"`} ≠ ${projectionStamp()} — ${hasRows ? 'refreshing every note in place' : 'full rebuild'}`,
  )
  return await reprojectAllNotes(options, {
    mode: hasRows ? 'inPlace' : 'wipe',
    fromEmpty: !hasRows,
  })
}

/**
 * Reconcile the index with disk (the open path): re-index files whose content
 * hash changed, and drop rows for files that no longer exist. Cheaper than a full
 * rebuild on an already-populated index, and abortable on graph switch. Writes
 * carry `generation`, so even a pass that races a connection swap can't corrupt
 * the newly-opened index — Rust drops its stale writes.
 *
 * The full-listing comparison lives in Rust ({@link reconcileScan}): one IPC
 * round-trip returns only the files needing a read — mtime moved, mtime too
 * fresh to trust, or no row yet — with their stored facts riding along, plus
 * the rows whose files vanished. On a healthy graph the delta is empty and
 * the whole pass is that single call. Hashes stay the authority for "did
 * content change": a read whose hash matches skips the write, re-stamping the
 * row's mtime when it disagreed with the listing (an echo-time stamp, or a
 * provider rewrote it) so the mismatch can't cost a re-read on every future
 * pass. Changed notes apply in shared `index_apply_batch` transactions.
 */
export async function reconcileIndex(options: IndexPassOptions): Promise<void> {
  const { generation, signal, onMoved, onSkippedNote, onFileProgress, onStalePlaceholders } =
    options
  const scan = await reconcileScan(generation)
  if (signal?.aborted) {
    return
  }
  if (scan.stalePlaceholders.length > 0) {
    // Evicted notes whose content the index lacks: request their downloads
    // now so they materialize (and index, via watcher upserts) while the
    // pass works through the readable candidates.
    onStalePlaceholders?.(scan.stalePlaceholders)
  }
  /** Stored facts per candidate path; healed moves graft the orphan's in. */
  const facts = new Map<string, { mtime: number; fileHash: string }>()
  for (const candidate of scan.candidates) {
    if (candidate.storedMtime !== null && candidate.storedHash !== null) {
      facts.set(candidate.path, { mtime: candidate.storedMtime, fileHash: candidate.storedHash })
    }
  }
  /** Rows to drop at the end: scan orphans, minus heals, plus TOCTOU ghosts. */
  const removals = new Map(scan.orphans.map((orphan) => [orphan.path, orphan]))

  // Id-based move healing (Plan 17): a row whose file vanished plus a new
  // file carrying the same frontmatter id is a rename observed after the
  // fact — an external tool or a sync pull moved it while Kore wasn't
  // looking. Move the rows instead of delete+create, so embedding vectors
  // survive. Best-effort throughout: any failure degrades to the plain pass
  // below (the arrival is indexed fresh, the removal loop drops the orphan).
  // Placeholders can't be arrivals: Rust never lists them as candidates.
  const arrivalPaths = scan.candidates
    .filter((candidate) => candidate.storedHash === null)
    .map((candidate) => candidate.path)
  /** Arrival content read for pairing — the main pass below reuses it. */
  let arrivalContent = new Map<string, string>()
  try {
    const healScan = await detectExternalMoves([...removals.keys()], arrivalPaths, { signal })
    arrivalContent = healScan.content
    for (const move of healScan.moves) {
      if (signal?.aborted) {
        return
      }
      try {
        await moveIndexedRows(move.from, move.to, generation)
      } catch (err) {
        // A refused/failed move (e.g. a row appeared at the destination in a
        // race) degrades to today's delete+create.
        console.error(`id-based move failed (${move.from} → ${move.to}):`, err)
        continue
      }
      // Do not graft the orphan's hash onto `to`: path-derived claims
      // (`kind`, `daily_date`) live on the row, so a notes/↔daily/ rename
      // with identical content would otherwise skip the re-apply and keep
      // the old kind. Live healing already re-indexes the destination;
      // embeddings survive because `apply_note` does not drop chunks.
      removals.delete(move.from)
      onMoved?.(move.from, move.to)
    }
  } catch (err) {
    // A failed detection (e.g. the id lookup) must not cost the reconcile.
    console.error('id-based move healing failed; reconciling plainly:', err)
  }
  if (signal?.aborted) {
    return
  }

  const batch = createIndexApplyBatch(generation, onSkippedNote)
  const touches = createMtimeTouchBatch(generation)
  const total = scan.candidates.length
  const pacer = createPassPacer()
  let done = 0
  let worked = 0
  for (const candidate of scan.candidates) {
    if (signal?.aborted) {
      return
    }
    done += 1
    if (done % INDEX_PASS_YIELD_EVERY === 0) {
      onFileProgress?.(done, total, worked, false)
    }
    await pacer.pause()
    const stored = facts.get(candidate.path)
    worked += 1
    let content = arrivalContent.get(candidate.path)
    if (content === undefined) {
      try {
        content = await readNote(candidate.path)
      } catch (err) {
        // The file moved/was deleted/locked between the scan and here (TOCTOU).
        // If it's gone and had a row, that row is now a ghost — remove it this
        // pass; for a transient error keep the row and retry next pass.
        if (isAppError(err) && err.kind === 'notFound' && stored !== undefined) {
          removals.set(candidate.path, {
            path: candidate.path,
            storedMtime: stored.mtime,
            storedHash: stored.fileHash,
          })
        }
        continue
      }
    }
    const fileHash = await hashContent(content)
    if (stored?.fileHash === fileHash) {
      // Content unchanged. If the stored mtime doesn't match the listing (an
      // echo-time stamp, or a provider rewrote it), re-stamp it so the next
      // pass takes the read-free path — left alone it mismatches forever.
      if (stored.mtime !== candidate.modifiedMs) {
        if (signal?.aborted) {
          return
        }
        await touches.add({ path: candidate.path, mtime: candidate.modifiedMs })
      }
      continue // unchanged
    }
    if (signal?.aborted) {
      return // re-check after the awaits — don't write for a superseded pass
    }
    const projection = await buildNoteProjection(candidate.path, content, {
      fileHash,
      mtime: candidate.modifiedMs,
    })
    if (signal?.aborted) {
      return
    }
    await batch.add(projection)
  }
  if (signal?.aborted) {
    return
  }
  await batch.flush()
  if (signal?.aborted) {
    return
  }
  await touches.flush()
  onFileProgress?.(total, total, worked, false)

  const removalPaths = [...removals.keys()]
  for (let offset = 0; offset < removalPaths.length; offset += INDEX_PATH_BATCH_SIZE) {
    if (signal?.aborted) {
      return
    }
    await removeFromIndexBatch(
      removalPaths.slice(offset, offset + INDEX_PATH_BATCH_SIZE),
      generation,
    )
  }
}
