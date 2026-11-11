# @kore/core

All of Reflect's TypeScript business logic. Platform-agnostic by design:
nothing in this package imports `@tauri-apps/*` — the native shell is reached
through an injected bridge, so the same code runs in the desktop app, in plain
vitest, and (later) in the CLI.

## The bridge

Every native call funnels through two seams:

- **`setBridge(bridge)`** installs the transport (`invoke` + `listen`) once at
  startup. The desktop app adapts Tauri; tests pass an in-memory fake. With no
  bridge installed, command bindings throw a descriptive error and
  `hasBridge()` returns `false` (used to gate native-only features in browser
  dev).
- **`call(command, args, schema)`** is the single point where an untyped IPC
  response becomes a typed value: every response is zod-validated, every
  rejection is coerced to the shared `AppError` contract. Application code
  never calls the bridge directly — it uses the typed per-domain bindings
  below.

## Domains

| Module | What it owns |
|---|---|
| `graph/` | Graph file storage (Plan 02): path helpers (`dailyPath`, `notePath`), zod schemas, and the typed file commands (`readNote`, `writeNote`, `listFiles`, recents). |
| `markdown/` | The document model (Plan 03): frontmatter parsing, the canonical Lezer grammar with the `[[wiki link]]` extension, extraction (`parseNote`), source-level edits, and pure wiki-link resolution policy. |
| `indexing/` | The SQLite projection pipeline (Plan 04): build/apply note projections, full rebuild and hash-based reconcile, the live watcher subscription, and the Kysely read getters. |
| `ipc/` | The bridge + `call` seam described above. |
| `errors.ts` | The `AppError` discriminated union shared with Rust. |

## Indexing: which entry point?

- **`indexNote(path, { generation })`** — one note changed; parse and apply it.
- **`reconcileIndex({ generation })`** — the graph-open path: re-index files
  whose content hash changed, drop rows for deleted files. Cheap on an
  already-populated index.
- **`rebuildIndex({ generation })`** — wipe and re-index everything. For
  explicit repair and schema bumps, not the hot path.
- **`subscribeIndexChanges(generation)`** — live re-indexing driven by the Rust
  file watcher; the *sole* incremental path (our own saves flow file → watcher
  → index like any external edit).

**`generation`** is the index session token returned by `openIndex()`. Every
write carries it; Rust silently drops writes whose generation is stale, so a
pass started for one graph can never corrupt a newly-opened index. If you add
a write path, thread the generation through — never cache one across a graph
switch.

## Conventions

- zod-validate everything that crosses an external boundary (IPC responses,
  file contents, watcher events). Don't re-validate rows from our own SQLite
  projection — they're trusted (see Plan 04 §2).
- TypeScript surfaces are camelCase; Rust serializes camelCase via serde, so
  no mapping happens outside the boundary layers.
- Tests live next to the module they cover and double as its usage docs.
