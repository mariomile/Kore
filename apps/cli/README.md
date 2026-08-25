# reflect-cli

`reflect` — the read/discovery/capture CLI over a graph (Plan 14), bundled
with the desktop app as a Tauri sidecar and usable standalone.

Self-contained Rust: it reads the graph's markdown files directly and opens
`.reflect/index.sqlite` strictly read-only — no Node runtime, no running
desktop app, no IPC. Its modules mirror the small contract owned by
`@reflect/core` (paths, fold keys, frontmatter, title derivation, slugs,
hashing, FTS match syntax); each names its TS counterpart and is
parity-tested against the same fixtures (`fixtures/`, `apps/cli/tests/parity.rs`).

The only writes are structural: `capture` (an append-only list item) and
`new` (an atomic no-clobber note create). In-place edits belong to markdown
editing, which the desktop app picks up live.

Full command reference and design notes: [docs/cli.md](../../docs/cli.md).
Test with `cargo test -p reflect-cli`.
