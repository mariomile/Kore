# macOS maintenance and performance review

Reviewed baseline: `157b141aed667167d96f5f479b49848fa010ecb8` (0.70.1).
Date: 2026-09-17. Scope: safe, reviewable improvements, not an architecture rewrite.

## Decisions after re-review

Kore is a Tauri app using WKWebView on macOS, not a SwiftUI app. Keep the existing
shell, Markdown ownership, generation guards, SQLite reader/writer separation,
index batching and bounded embedding runtime. No signing identities, entitlements,
iCloud paths, native command contracts, migrations or editor serialization change.

The preceding audit identified candidates, not proven app-wide bottlenecks.
A smaller module is not necessarily faster. A virtualized list is not a paginated
data source, but replacing its contract can break selection and scroll behavior.
An external React store is not automatically better than React state. Existing
memory budgets and proposed latency targets are targets, not observed guarantees.

## Implemented

### Safe chat deletion

`chat-provider.tsx` previously marked a conversation deleted before the database
operation completed, then continued to remove attachment files and clear the UI
even when deletion failed. Saves arriving while that failed delete was pending
could also be skipped by the early deleted-conversation guard.

Deletion now joins the existing per-conversation save chain. It marks the
conversation deleted only after the database call succeeds. Later saves wait for
the result: they proceed after failure, and their existing execution-time guard
skips them after success. A failed delete reports an error and leaves the active
conversation and attachment files alone. A successful delete retains the existing
best-effort attachment cleanup and native generation checks.

No durable retry service has been added. Attachment cleanup failures still log and
can leave orphan files, as before; do not claim automatic recovery for that case.

### Event-driven graph frames

The old canvas skipped drawing when idle but still requested the next animation
frame unconditionally, including for an empty graph. A small graph-specific
scheduler now coalesces requests, stops after settling, pauses on document
visibility changes and cancels pending callbacks/listeners on disposal.

The existing force layout, two steps per frame, labels, hit testing and interaction
policy are unchanged. Pointer events, resizing, search highlighting and root theme
attribute changes request repaint without resetting the layout. The theme observer
is necessary because canvas pixels do not automatically inherit CSS changes.

This eliminates redundant callbacks; it does not establish a measured battery-life
improvement or certify native macOS window-occlusion behavior.

### Reuse supertag validation within one note-list query

Each distinct serialized tag schema, including malformed schemas, is validated
once per `listNotes()` result instead of once per matching note. The cache is local
to the query and contains only raw strings and validity booleans. It cannot leak
across graph switches or retain stale results after a schema edit.

SQL, payloads, ordering, selection, daily-note behavior and Inbox semantics remain
unchanged. This reduces duplicate validation, not the full-list IPC payload. A
10,000-row isolated fixture with one valid and one malformed definition produced
identical rows and reduced decoder invocations from 20,000 to 2. The decoder and
storage boundaries were stubbed: this is a work-count check, not a latency result.

## Intentionally deferred

| Candidate | Why not part of this patch | Evidence required first |
|---|---|---|
| Selective index invalidation | Changed paths alone cannot capture old/new backlink destinations, facets, membership, related views or cross-window state. Incorrect invalidation serves stale data. | Delta contract with old/new dependencies; integration tests; query-count baseline. |
| Note-list pagination | Alters select-all, range selection, bulk operations, pin ordering, scroll restoration and callers requiring the complete vault. | Explicit UI pagination contract and native large-vault profiling. |
| Context selection before attachment hydration | Valid direction, but the selected messages must match the final prompt budget and preserve tool-call/result pairs and image accounting. | Shared context planner, equivalent outgoing payload tests, cancellation and missing-file tests. |
| Streaming batching | Rendering must not gate persistence, stop, tool events or completion; a hidden WKWebView can pause animation callbacks. | Long-chat render profile plus terminal-event, switch and interruption tests. |
| ChatSession extraction | A maintenance candidate, not a demonstrated speed improvement. | Separate behavior-preserving change with lifecycle coverage. |
| Separate durable/index databases | An unnecessary migration risk for these improvements. Current rebuilds already preserve chat tables. | Backup/restore and migration acceptance, only when a concrete need justifies it. |
| Workers, layout replacement or embedding-model replacement | Existing spatial layout and native embedding bounds should not be replaced without a measured bottleneck or retrieval-quality need. | Native profiles and representative multilingual retrieval evaluation. |

## Validation and release boundary

Added regression tests:

- `chat-provider-delete.test.tsx`: real provider/save-queue path with mocked I/O;
  failed deletion preserves files and pending decisions and permits retry;
  successful deletion does not let a pending save resurrect the conversation.
- `graph-frame-scheduler.test.ts`: coalescing, settling, wake-up, visibility pause,
  resumption, cancellation and late callbacks after disposal.
- `note-list-cache.test.ts`: real query compilation with the existing fake IPC
  bridge; shared valid/invalid definitions, unchanged Inbox membership and no
  cross-query cache retention.

Local checks used the exact modified source with isolated React/browser/storage
boundaries: 10/10 checks passed, including reproduction of both original bugs.
TypeScript syntax was checked for all seven changed/new code and test files.
These checks are not a project typecheck, a Vitest run, a packaged app build or a
native performance measurement. The editing environment was Linux without Xcode
and without network access to install the full repository dependencies.

Run the repository CI and inspect its results before merge. Relevant existing
commands (with dependencies installed):

```sh
pnpm check
pnpm build
pnpm test graph-frame-scheduler chat-provider-delete note-list
REFLECT_TEST_BROWSER=webkit pnpm test --project browser chat-provider-delete
```

A release candidate still needs native macOS validation: render the graph, let it
settle, pan/zoom/drag, change theme, switch tabs/graphs, hide/restore the window and
quit/reopen. Verify chat deletion and concurrent save decisions on a disposable
vault. Profile a release build on a named Mac with representative vaults and
separate native, WebKit and helper-process accounting. Do not treat Playwright
WebKit as certification of WKWebView, App Nap, memory footprint or battery use.

This branch is for review. No merge, release, automatic app update or user-vault
mutation is authorized by this implementation.
