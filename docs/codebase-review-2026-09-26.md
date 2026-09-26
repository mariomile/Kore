# Kore performance and reliability review — 2026-09-26

Reviewed `origin/master` at `1985fa6fc212c5966d696b8360ae80b98b538982` (Kore 0.74.0). The remote head was fetched and checked again during the review. The supplied worktree was clean but 101 commits behind; it was aligned to that commit in detached HEAD before inspection.

**Remediation update:** After Mario installed 0.74.0 and authorized fixes, a first implementation batch was prepared on `mario-codex/reliability-and-native-ui`. R1–R6 and the Cmd+K focus handoff have local fixes and passing checks. The audit below records the original baseline; the final section records current implementation status and remaining limits.

The highest-priority work is making explicit note mutations report and preserve the correct outcome under failed or overlapping writes. Five reliability defects and one search-work amplification issue were reproduced. Two additional performance opportunities are supported by source/build evidence, but their runtime gains have not been measured.

## Original audit scope and evidence

- **Goal:** Find actionable performance and reliability improvements in the current codebase, including remaining issues after #241, #245 and #247.
- **Acceptance:** Trace each finding to current source, a concrete trigger, observable impact and a bounded remedy; distinguish reproduced behavior from optimization hypotheses.
- **Non-goals:** Implement fixes, change architecture or dependencies, publish a PR, merge, release, or edit pre-existing note content.
- **Untouched:** Application source, lockfile, versions and migrations. The sole retained repository addition is this report. The subsequently requested native QA created two clearly named synthetic notes in the active graph; see the native QA section.

Inspection covered note sessions and mutation callers, rebuild/live indexing, embedding synchronization and native admission, SQLite bridge changes, palette queries, collection loading, graph rendering and production bundle output. This is a targeted audit, not an exhaustive certification or a native-app benchmark.

Reproductions execute the actual TypeScript implementation with controlled I/O; they do not induce disk failures on a real vault. The search reproduction renders the real palette in Chromium while keeping retrieval promises unresolved. No external AI request was made.

## Findings, in priority order

### R1 · P1 — A failed body mutation rolls back typing performed during the write

**Location:** `apps/desktop/src/editor/note-session-state.ts:425–430`.

`commitBodyEdit` captures the old header/body, applies a transform and awaits `flush()`. If the write fails, it unconditionally restores that old snapshot in both the session and editor. An `editorChanged` occurring during the asynchronous write is therefore erased along with the failed transform. Task edits and type/chat transformations reach this path.

**Reproduced:** Start a body transform, hold the write pending, type `USER TEXT TYPED DURING SAVE`, then reject the write. The returned error is `temporary I/O failure`, but the final buffer is the original paragraph without the newly typed text.

**Smallest remedy:** Make rollback conditional on the document revision still matching the transformed snapshot. If it has changed, preserve the current buffer as unsaved and surface the error. Avoid restoring a whole old document over newer edits.

**Acceptance:** A delayed failed write must not remove text entered after the transform started. The existing immediate-failure test does not exercise this interleaving.

### R2 · P1 — A frontmatter commit reports success after its write failed

**Location:** `apps/desktop/src/editor/note-session-state.ts:375–377`; error capture at `119–122`.

The save chain catches write errors and stores them in session state, so `flush()` resolves. `commitFrontmatter` then returns `true` unconditionally. `commitNoteFrontmatter` treats that value as persistence success and returns to its caller.

**Reproduced:** A session with a rejecting write receives `{ private: true }`. Result: `returned: true`, `diskPrivate: false`, `bufferPrivate: true`, `error: "disk full"`.

**Impact:** Property, pin and privacy actions can report completion without persisted bytes. `toggleNotePrivate` (`lib/note-private.ts:25`) returns the new state, and `use-bridged-note-toggle.ts:79–83` retains its optimistic indication. Gist publication also relies on rejection to compensate for a failed local record (`lib/note-gist.ts:98–108`). The editor's generic save error still exists; it does not correct the action's successful result. This reproduction establishes a persistence/privacy-state discrepancy, not observed external disclosure.

**Smallest remedy:** Give explicit commits the actual write outcome and reject on failure, retaining the unsaved document for retry. Keep routine autosave error presentation distinct from an explicit action's completion contract.

**Acceptance:** A failed explicit property/privacy commit rejects; action callers show failure and do not retain a successful optimistic state. Do not discard the user's buffer to achieve that.

### R3 · P1 — Concurrent transforms of a closed note lose one update

**Location:** `apps/desktop/src/lib/note-frontmatter.ts:99–109`.

The disk fallback of `commitNoteBodyTransform` performs read/transform/write without the per-note serialization already used for frontmatter. Two operations can read the same old document and each replace the whole file. Native atomic file replacement protects a single write, not this read/modify/write sequence.

**Reproduced:** Starting with `#alpha #beta`, two concurrent transforms remove one tag each. Both resolve successfully, but the final file contains `#alpha` again. A reachable caller is `hooks/use-apply-note-type.ts:62`; different chat proposal cards are gated by tool-call ID, not by note (`chat-proposal-card.tsx:102`).

**Smallest remedy:** Reuse a single per-document mutation queue for body and frontmatter edits within the webview, keyed by graph generation and path. Recheck the open-session owner before a disk fallback, as the frontmatter path already does. Do not create independent queues for two operations that both replace the same file.

**Acceptance:** Concurrent body/body and body/frontmatter changes preserve both updates; opening the note while a fallback read is pending cannot overwrite newer editor content. Cross-process conflict behavior still needs its own native validation.

### R4 · P1 — One unreadable file aborts a rebuild after clearing the index

**Location:** `packages/core/src/indexing/indexer.ts:249–258`; watcher startup in `apps/desktop/src/providers/graph-index.ts:222–278`.

`rebuildIndex` clears the projection stamp and index before listing/reading files. Unlike application of an invalid SQLite projection, failure to read or project a single note is not handled per note. It aborts before the remaining batch is flushed. On initial graph startup, `createGraphIndex` subscribes and starts the watcher only after `syncIndex` succeeds; failure leaves progress at `idle`.

**Reproduced:** Listing `[a,b,c]`, with `b` disappearing before its read, yields `reconciling → stamp cleared → index cleared → read/buffer a → read b → sync error → idle`. No flush, read of `c`, subscription or watcher startup occurs in this initial-start scenario.

**Impact:** Search, backlinks and indexed lists remain empty or partial. A persistent unreadable file repeats the problem on reopening. Markdown files are not deleted, and durable chat history is not the wiped projection.

**Smallest remedy:** Handle read/projection errors per file: ignore files that genuinely disappeared, surface other skipped files and continue processing healthy notes. Preserve an explicit incomplete/retry state rather than stamping an incomplete pass as fully healthy.

**Acceptance:** One deleted/unreadable file cannot prevent healthy notes from reaching the index or stop live indexing from becoming available. Test this separately from DB apply failures.

### R5 · P2 — One embedding failure drops unrelated queued notes

**Location:** `apps/desktop/src/components/embeddings-sync.tsx:100–109` and `126–129`.

`drainFollow` copies `pendingFollow` into a local array and clears the map. A rejection while processing one item exits the loop; the outer catch logs the failure, but later items from that snapshot are neither processed nor requeued.

**Reproduced:** A queued batch `[a,b,c]` with `a` rejecting calls only `a`. A later event for `d` produces calls `[a,d]`; `b/c` are not recovered. Native admission can produce transient failures when its eight-request capacity is occupied (`embed_batch.rs:72–75`).

**Impact:** Semantic search and Similar notes can remain stale or missing for healthy notes until another edit or backfill reaches them.

**Smallest remedy:** Isolate errors per job and continue with the rest. Preserve bounded retry state for failed work without immediately looping on permanent errors or resurrecting superseded upserts/removals.

**Acceptance:** Failure of `a` does not drop `b/c`; subsequent updates still coalesce correctly. Current sync tests cover coalescing and lifecycle, but not this rejection path.

### R6 · P2 — Palette typing can enqueue obsolete semantic searches

**Location:** `apps/desktop/src/components/command-palette/use-palette-results.ts:43` and `105–120`; `packages/core/src/embeddings/retrieve.ts:173–185`.

`useDeferredValue` schedules rendering, but the query function starts a fresh hybrid retrieval for each settled prefix. It neither consumes an abort signal nor suppresses superseded work. Hybrid retrieval also waits for the semantic leg before returning its already-started lexical result.

**Browser reproduction:** Feed the 11 successive prefixes of `performance` at 80 ms intervals while retrieval promises remain pending. The real palette starts all 11 retrievals before any completes. This is a controlled slow-retrieval scenario, not a measurement of normal ONNX latency. Native execution admits at most eight requests, so the frontend can generate more work than the native queue accepts under load.

**Smallest remedy:** Keep lexical feedback prompt; debounce/coalesce semantic submission and discard superseded work before native admission. Prefer one active semantic request plus the latest pending query over an unbounded stream of prefixes. Cancellation must have an effect before IPC admission; an unused abort signal alone is insufficient.

**Acceptance:** A burst of changing input does not enqueue every prefix, and the final query cannot wait behind obsolete work. Measure final-result latency and native request count under simultaneous backfill.

## Further performance opportunities

These are optimization candidates, not measured user-visible regressions.

1. **Load AI provider implementations when needed.** The fresh production build emits a shared `src-CUKN3CUz.js` chunk of **1,366.63 kB minified / 358.69 kB gzip**, statically imported by the entry point and listed in `index.html` module preloads. Its source map contains `ai`, OpenAI, Google, Anthropic and other core code. `packages/core/src/ai/language-model.ts:1–4` imports all provider factories statically; chat delivery also imports its engine eagerly. Introduce lazy boundaries at actual AI invocation points and measure startup/first-AI-action tradeoffs. The whole chunk is not removable AI overhead, and its bytes are not an estimate of RAM or saved startup time.

2. **Avoid loading list-only data for every collection layout.** `all-notes-screen.tsx:209–231` always loads `listNotes` and global tag facets, then separately loads the collection projection. The facets UI is shown only on the unfiltered route; notes are also sorted and scanned for Inbox membership on tag routes. First gate the unused facets and list-only computations; load bulk-action support data when needed. Measure cold tag-page query count, IPC bytes and time to usable rows on the existing `?seed=large` fixture before considering broader pagination. Virtualization already bounds rendered rows, but not these queries or transformations.

## Codebase direction

Use three small, independently reviewable changes:

1. **Reliable mutations:** R1–R3. One explicit success/failure contract and a shared existing per-document queue; preserve newer edits on failure.
2. **Recoverable background work:** R4–R5. Per-item failures must not discard healthy work; make incomplete state observable and retryable.
3. **Bounded interactive work:** R6, then the measured bundle/query opportunities. Optimize request production and cold loading before introducing new caching layers or replacing the editor.

Keep the improvements already present: virtualized lists/boards/daily stream, bounded embedding batches, native admission control, sleeping graph animation, the recent editor rendering changes, and SQLite read-bridge work. The old ONNX incident is not evidence of a current leak. File length warnings alone do not justify splitting modules or a broad refactor.

## Validation and limits

| Check | Result |
| --- | --- |
| Frozen install of current lockfile | Passed; no dependency/lockfile edits. Existing Git-hook setup warning in this worktree. |
| `pnpm check` | Passed, exit 0; existing max-lines warnings. |
| `pnpm build` | Passed, 2 tasks; existing large-chunk/plugin timing warnings and a nonfatal Turbo I/O warning. |
| Nine existing targeted Node suites | **167 passed**. |
| Existing embedding-sync and collection-board browser suites | **30 passed** in Chromium. |
| Temporary palette amplification reproduction | **1 passed** in Chromium; removed from repository after execution. |
| Controlled persistence reproductions | Three defects reproduced against actual TS source; parent reran all three. |
| Controlled rebuild/embedding reproductions | Both defects reproduced against actual TS source with controlled dependencies. |
| Native Tauri/I/O/iCloud/ONNX benchmark | Not run. No native latency, memory or failure-frequency claim. |

Targeted Node command:

```sh
pnpm test --run \
  apps/desktop/src/editor/note-session.test.ts \
  apps/desktop/src/editor/note-session-frontmatter.test.ts \
  apps/desktop/src/editor/document-binding.test.ts \
  apps/desktop/src/lib/note-frontmatter.test.ts \
  packages/core/src/indexing/pipeline.test.ts \
  packages/core/src/indexing/live.test.ts \
  packages/core/src/embeddings/pipeline.test.ts \
  packages/core/src/embeddings/retrieve.test.ts \
  apps/desktop/src/lib/query-client.test.ts
```

Temporary local evidence is under `/tmp/kore-review-*`: check/build/test/browser logs, `persistence.cjs` and its output, and `palette.test.tsx` (copied from the existing palette harness with one reproduction). These temporary paths are convenience evidence; the scenarios and observed outcomes above are the durable record. Browser tests required an unsandboxed launch because Chromium could not start within the macOS sandbox.

Passing the existing tests does not refute these findings: the missing coverage is chiefly asynchronous interleavings and per-item failure recovery. No production source was changed, and no commit, push or release was performed.

## Native application QA — follow-up requested by Mario

### Environment and evidence boundary

These checks used the actual macOS application `app.lore.desktop`, through its native accessibility surface and screenshots, rather than a browser preview. About Kore reported **0.73.0 (0.73.0)**; the update notification offered **0.74.0**. No update was installed. Consequently, native observations below are established on 0.73.0, while R1–R6 above concern `origin/master` 0.74.0. They are not interchangeable release evidence.

The active graph was Kore Brain. Changes were confined to two newly created synthetic notes. No external AI request was initiated, and no destructive, sync-conflict or disk-failure test was performed against the real graph. The ordinary background index and backup remained active. Persistence here means successful navigation away and reopening, updated indexed surfaces, and visible backup-history entries; a cold process restart and independent disk-byte audit were not performed.

### N1 · P2 — Dismissed property popovers remain visibly over the editor

**Observed repeatedly in the installed native application.** Assigning `#project` succeeded, but the Type chooser remained painted with its search reset. Opening Status could leave both menus visible together. In an isolated later check, opening Status and pressing Escape left its menu visibly over the note; a second Escape after further inspection still did not remove it. Screenshots confirmed the visible overlay, so this is more than a stale accessibility entry. Navigating to another note cleared it.

**User impact:** The UI suggests a property menu is still interactive while keyboard input can reach the editor or underlying table. During the earlier Status keyboard attempt, Down/Return added a blank paragraph to the synthetic note rather than producing the expected selection. A subsequent screenshot showed the editor caret while the Status menu remained visible. A user may accidentally edit the note while trying to operate what looks like an open menu.

**Important qualification:** The controls were opened through accessibility activation. Coordinate-based pointer activation was unavailable in the control tool. This establishes the observed native/accessibility interaction, not identical behavior for every physical mouse interaction. Also, `Status: to do` eventually appeared in both property surfaces; this is **not** evidence that Status never saves. The more precise defect is the mismatch between visible overlay and active interaction state. A logically closed popup retained during its exit lifecycle is a hypothesis, not a proven root cause.

**Source trace on current master:** `components/notes/note-type-picker.tsx:102–105` explicitly closes after choosing; `components/tags/select-property-editor.tsx:35–39` closes single-select choices. Both use `components/ui/popover.tsx`, whose popup has enter/exit animation classes. The relevant component files are unchanged from v0.73.0, but #247 upgraded Base UI from 1.7 to 1.8; that dependency difference prevents declaring the installed behavior reproduced on 0.74.0.

**Next bounded action:** Reproduce this exact sequence on native 0.74.0, including ordinary pointer and keyboard activation; inspect logical open state, focus and exit-animation completion together before changing the wrapper. Acceptance: selecting or dismissing a single-select menu removes its visual surface, Escape restores usable focus, and opening a second property never leaves a stale first menu. Preserve deliberately persistent multiselect behavior.

### N2 · P2 candidate — Immediate typing after Cmd+K can enter the note

**One native observation; not yet a confirmed general regression.** With the Beta editor focused, a batched Cmd+K followed immediately by typing `SENTINELLA-BETA-0926` left `S` at the editor cursor and `ENTINELLA-BETA-0926` in the palette input. Once the palette was visibly ready, entering the complete query worked and Return opened the correct note. The stray letter was removed from the synthetic note and its removal was verified.

**Possible impact:** Very fast shortcut-to-typing input can modify a note and alter the search query. The tool may deliver the first character sooner than an ordinary user; this single observation does not establish frequency or typical human timing. Investigate focus transfer around `components/command-palette/command-palette.tsx` and `palette-provider.tsx` only after a controlled native repetition at realistic key intervals. Do not infer a retrieval/indexing defect from this case.

### Completed user-journey checks

| Journey | Native result |
| --- | --- |
| Create two notes with H1 titles | Passed after recovering from tool input errors; both acquired title-derived `notes/…` paths. |
| Unicode persistence (`caffè`, `perché`, Japanese text, emoji) | Passed after navigating away and reopening Alpha. |
| Complete a checkbox in the editor | Passed; the checked state survived reopening. |
| Find the remaining task in the global Tasks view, complete it there, reopen its note | Passed; both Alpha checkboxes were checked in the editor. |
| Assign the existing Project type | Membership passed: note header, Details and Project collection reflected it; dismissal failed as N1. |
| Search a unique token in note body | Passed once palette input was focused; result and preview matched Beta, and Return opened it. |
| Reciprocal wikilinks and incoming backlinks | Passed; each synthetic note had the other as an incoming backlink, and backlink navigation opened Alpha. |
| Rename Beta through its H1 | Passed; the tab and canonical path became Beta Renamed, and Alpha's wikilink updated automatically. |
| Check backlink after rename | Passed; renamed Beta still showed Alpha's updated reference. |
| Undo and redo a selected body-text replacement | Passed for Cmd+Z and Cmd+Shift+Z; the original test sentence was restored at the end. |
| Backup history appears after editing | Passed as a visible-history check; Add/Update entries appeared. Version restoration was not tested. |
| Escape in the command palette | Passed in contrast to the property-overlay behavior. |

### Tool limitations and remaining scope

Coordinate clicks returned `noWindowsAvailable`; a ScreenCaptureKit error and intermittent clipboard-paste timeouts also occurred. Some timed-out paste operations had already changed the editor, so state was checked before retries. These failures and the initially malformed synthetic title are **not classified as Kore defects**. Rename notifications lingered in the accessibility tree, but screenshots did not show the corresponding toast; that alone is insufficient evidence of a stuck rename. The rename and link update themselves completed.

No quantitative native performance, memory, large-vault, cold-start, iCloud, crash recovery, mobile, audio, external-provider or update-installation validation is claimed. The native smoke checks do not replace the controlled failure reproductions above. Screenshots and accessibility observations are recorded in the task conversation; this report contains the durable reproduction steps and outcomes.

Two fixtures remain in Kore Brain for reproduction:

- `QA Native 2026-09-26 Alpha` — `notes/qa-native-2026-09-26-alpha.md`, Project type, two completed synthetic tasks, reciprocal link to Beta Renamed.
- `QA Native 2026-09-26 Beta Renamed` — `notes/qa-native-2026-09-26-beta-renamed.md`, unique body-search token and reciprocal link to Alpha.

The application was left on Beta Renamed with the residual property menus cleared by navigation. No production code was changed for these checks.

## Native 0.74.0 retest and first fix batch

About Kore independently confirmed **0.74.0 (0.74.0)** after the user installed the update. `origin/master` was fetched again and remained at `1985fa6f`. Implementation uses the dedicated `mario-codex/reliability-and-native-ui` branch. The subsequent “Procedi” extends this batch to R6 and PR preparation. No release, dependency change or installed-app replacement is included.

**Scope:** Correct confirmed data-preservation/recovery defects and the shortcut focus boundary. Keep versions, public schemas, dependencies and unrelated product behavior unchanged. Acceptance combines red/green failure reproductions, targeted regression suites, type/lint checks and production build. Bundle splitting and collection-query optimization remain outside this batch.

### What changed in the retest

- **N1 still occurs through native accessibility control:** Both Type and Status remained visibly over the editor after Escape, including after the window's exposed Raise action. However, a separate WebKit reproduction using the real Popover wrapper and normal **150ms** animation duration successfully removed the popup. The ordinary suite normally forces reduced motion, so this was an additional diagnostic rather than reusing its near-zero animation. Base UI's unmount path waits for animation completion; native-window rendering/occlusion during automation remains an unconfirmed alternative explanation. A direct mouse/keyboard check was requested from the user. No speculative Popover change was made.
- **N2 recurred with fast input:** One immediate Cmd+K/type sequence was clean; another inserted the first `S` into the synthetic Beta title and sent the remaining query to the palette. The unintended title change actually propagated to its filename and Alpha's link. The original title, canonical path and reciprocal link were restored and verified. This remains timing-dependent, but the shortcut's deferred focus handoff was independently reproduced with a browser regression.

### Implemented corrections

| Finding | Local correction | Evidence |
| --- | --- | --- |
| R1: rollback erases concurrent typing | Roll back a failed transform only while the transformed document is unchanged; retain newer edits and the visible save error otherwise. | Delayed failure + typing regression. |
| R1 follow-up: retry could duplicate a retained append | A typed save-retry error distinguishes an already-applied edit. Chat shows **Retry save** and retries persistence without reapplying, including across card remount. Reject is disabled while the edit is already retained. | Real session + rendered chat-card test: append, concurrent typing, disk error, remount, retry; one append on disk. |
| R2: false frontmatter success | Explicit frontmatter commits reject a failed write while retaining the unsaved buffer for retry. | Disk-full/private-flag regression. |
| R3: closed-note write races | Body and frontmatter mutations use the same per-note/generation queue; body fallback checks owner before/after reading and binds reads to generation. | Concurrent body/body/frontmatter and ownership regressions. |
| R4: one unreadable file breaks rebuild/startup | Handle per-note read/projection failures through the existing skip callback, process healthy notes, start the watcher and leave incomplete rebuilds unstamped. | Healthy notes survive a bad file; watcher starts; a subsequent healthy sync restores the stamp. |
| R5: failed embedding drops unrelated jobs | Isolate each job failure; retry once after other paths, yielding to newer events for the same path. | Failure continuation and deletion superseding a failed upsert. |
| R6: obsolete queries consume embedding capacity | Show lexical results immediately; debounce hybrid admission by 180ms, serialize active work and cancel superseded consumers. Wait for both hybrid legs even when SQL fails; clear superseded lexical errors after hybrid success. | 11 prefixes at 80ms produce one retrieval instead of 11; pending work admits only the latest query, and closing cancels queued work. Core failure regression proves the embedding finishes before releasing admission. |
| N2: focus not ready for immediate input | Flush only the `palette.open` shortcut/menu state update synchronously, allowing the existing input autofocus before dispatch returns. | WebKit regression failed before the change; shortcuts, macOS shortcuts and real palette suites pass afterward. |

The retained-edit retry recognizes a later successful autosave/close flush. If the edit is still unsaved and its session has been invalidated, it refuses and asks the user to review the note; it does not write through a stale owner or silently reapply the proposal. General recovery after losing that session is not implemented. Startup indexing omissions use the existing error log callback; the manual rebuild already has a warning toast.

### Final validation for this batch

- `pnpm check`: Passed, exit 0. Existing file-length warnings remain; `note-session-state.ts` now also exceeds that advisory threshold. No lint errors.
- `pnpm build`: Passed, exit 0, both build tasks successful. Existing chunk-size and nonfatal Turbo I/O warnings remain.
- **148 Node tests passed:** 133 across note session, session frontmatter, note mutation, graph-index lifecycle and indexing pipeline suites, plus 15 retrieval tests.
- **66 WebKit tests passed:** 49 shortcut/macOS shortcut/palette tests, plus 17 chat-card/embedding-sync tests. These render the changed UI paths but do not replace native verification of a rebuilt app.
- The standalone normal-duration Popover diagnostic passed in WebKit; its temporary test was moved to `/tmp/kore-popover-native-investigation.test.tsx` rather than retained as an unrelated regression.
- Independent read-only review verified R4/R5 and the shortcut fix. Review of R6 caught a residual error banner and early hybrid rejection, both reproduced red/green and corrected. Review of R1 first caught the duplicate-append retry case, which prompted the additional correction and integration test.

Logs: `/tmp/kore-fixes-final-{check,build,node,webkit}.log`, `/tmp/kore-shortcuts-{red,green}.log`, `/tmp/kore-popover-webkit.log`, `/tmp/kore-search-final-{check,build}.log`, `/tmp/kore-palette-final-green.log`, `/tmp/kore-retrieval-settlement-{red,green}.log`, and the focused mutation/background logs recorded during execution.

**Remaining:** N1's native-only visual residue still needs isolation from automation/foreground effects. The bundle/collection-query opportunities remain unimplemented. The request-count improvement is a controlled test result, not a measured native latency gain. The fixes are committed on the dedicated review branch and are not part of the installed 0.74.0 application; no patched-native runtime or release verification is claimed.
