# Pulling upstream reflect-open changes into Lore

Lore forked [team-reflect/reflect-open](https://github.com/team-reflect/reflect-open)
and has since diverged heavily: the Apple identity and updater channel are
Lore's own, and whole subsystems (the `reflect` CLI, the Agents section,
shared memory, automations, in-app MCP, the activity ledger) exist only
here. Upstream still ships fixes worth taking — editor, indexing, sync,
mobile — so merges stay worthwhile, but they are a deliberate chore, not a
button press. This page is the playbook.

## One-time setup

```bash
git remote add upstream https://github.com/team-reflect/reflect-open.git
git fetch upstream
```

## Cadence

Merge on demand, not on a schedule: when upstream lands a fix or feature we
want, or roughly once a quarter to keep the drift bounded. Small frequent
merges beat one giant one — every skipped month grows the conflict surface.

## The merge itself

Always merge, never rebase — `master` is published history.

```bash
git fetch upstream
git checkout -b upstream-merge master
git merge upstream/main        # expect conflicts; see hotspots below
pnpm install && pnpm fix && pnpm check
pnpm --filter @reflect/desktop test
cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings
```

Land it through the normal branch flow and let CI (the full shard matrix)
judge it before fast-forwarding `master`.

## Conflict hotspots

Files where both sides move often — resolve with intent, not mechanically:

- `packages/core/src/settings/schema.ts` and every settings-literal test
  (`settings-provider.test.tsx`, `settings-screen.test.tsx`): both sides add
  keys. Union the keys, then update the test literals — CI shard 1 is where
  stale literals fail.
- `apps/desktop/src-tauri/src/lib.rs` command registration and
  `packages/core/src/exports/*`: both sides append. Union, keep sorted
  groupings.
- `packages/core/src/ai/**`: Lore rewired chat around agent profiles, CLI
  providers and MCP. Prefer Lore's structure; port upstream's logic changes
  into it rather than taking upstream files wholesale.
- `apps/desktop/src/providers/chat-provider.tsx`: same rule — Lore's edit
  mode, run lock and ledger wiring must survive.
- Lockfiles (`pnpm-lock.yaml`, `Cargo.lock`): never hand-merge. Take either
  side, then regenerate with `pnpm install` / `cargo update --workspace`.

## Never take from upstream

These are identity, not code — an upstream hunk touching them is always
resolved to Lore's side:

- Bundle identifiers (`app.lore.*`) and product names in
  `apps/desktop/src-tauri/tauri.conf.json` and its overlays.
- The updater `pubkey` and `endpoints` (they pin Lore's release channel and
  signing keypair; upstream's would brick auto-update).
- Keychain service names (`lore`, legacy `reflect-open` migration path in
  `secrets.rs`).
- `.github/workflows/release-dmg.yml` and Lore's release/versioning flow.
- `README.md` branding and `docs/` pages that describe Lore-only systems.

## After the merge

- Bump the app version and cut a release if the merge changes user-facing
  behavior (the updater only fires on a version increase).
- Note the merged upstream commit in the merge commit message
  (`Merge upstream/main at <sha>`) so the next merge has a clean baseline.
