# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

See [AGENTS.md](AGENTS.md) for the full project overview, tech stack, repo layout,
common commands, testing setup, database tables, code conventions, and the
development cycle.

Read ALL of it before starting ANY work. This is VERY important. You must read
AGENTS.md in its entirety before continuing.

Two names coexist on purpose and neither is a typo: **Reflect** is the upstream
project this repo forked from (internal identifiers keep it — `@reflect/*`
packages, `reflect-*` crates, the `reflect` CLI, `.reflect/`), while **Kore** is
this fork and the only name a user ever sees. Apple identity stays `app.lore.*`
and the keychain service stays `"lore"`. Never "fix" one into another.

## Layering rules

From [CONTRIBUTING.md](CONTRIBUTING.md) — these decide *where* code goes, and
getting them wrong is the most common way a change is rejected in review:

- **Business logic lives in `packages/core`.** No file, DB, or AI logic in React
  components, hooks, or Tauri command handlers. Components call typed
  `@reflect/core` bindings; `#[tauri::command]` handlers are thin wrappers over
  native primitives. Tiny dependency-free helpers shared across packages go in
  `@reflect/utils`.
- **Rust owns capabilities, TypeScript owns policy.** A Rust command never
  encodes a product rule beyond the primitive it exposes — the watcher emits
  events; *what* to reindex is decided in core.
- **`@reflect/core` and `@reflect/db` never import `@tauri-apps/*`.** A host
  installs a transport at startup via `setBridge`
  (`packages/core/src/ipc/bridge.ts`): the desktop app adapts Tauri
  (`apps/desktop/src/lib/tauri-bridge.ts`), plain-browser dev installs the
  in-memory dev bridge (`apps/desktop/src/dev/`), and tests install fakes rather
  than mocking modules. Components and hooks never touch the bridge directly —
  they call a typed per-domain binding that funnels through `call` in
  `packages/core/src/ipc/invoke.ts`, where every response is zod-validated.

## Checks CI runs that the daily loop doesn't

`pnpm check` (typecheck + lint) plus targeted tests is the daily loop described
in AGENTS.md. These additional gates are what actually turn CI red:

- **Generated DB types.** After changing the SQLite schema
  (`crates/index-schema/`), run `pnpm --filter @reflect/db db:codegen` and commit
  `packages/db/src/schema.gen.ts`. CI fails when it is stale.
- **Rust is `fmt` + `clippy` + `test`.** `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, then
  `cargo test --workspace`. Warnings are errors. Stage the sidecars once per
  checkout first (`pnpm --filter @reflect/desktop sidecar`) or anything that
  compiles the desktop crate fails inside tauri-build.
- **iOS bindings.** Rust touching `apps/desktop/src-tauri` must also pass
  `cargo check -p reflect-open --lib --target aarch64-apple-ios --no-default-features`.
  The TestFlight workflow is the only full iOS build and it never runs on PRs.
- **Both browser engines.** The `browser` Vitest project runs on Chromium *and*
  WebKit (the production Tauri webview engine) on every PR. Verify a `.test.tsx`
  on both:
  `REFLECT_TEST_BROWSER=webkit pnpm exec vitest run --project browser <path>`.
- The eslint pass runs under `node --max-old-space-size=4096` deliberately — its
  type-aware rules peak just past the default heap on a stock runner, and
  without the flag the job dies with "JavaScript heap out of memory" instead of
  reporting a lint error. Keep the flag when touching those scripts.

## Guides for common changes

- Native command, the full Rust → bridge → zod → React path:
  [docs/contributing/adding-a-command.md](docs/contributing/adding-a-command.md)
- User setting (no Rust involved):
  [docs/contributing/adding-a-setting.md](docs/contributing/adding-a-setting.md)
- Editor session/adapter split and the save loop:
  [docs/contributing/editor-architecture.md](docs/contributing/editor-architecture.md)
- Test projects, the `.test.ts` vs `.test.tsx` routing rule, and the
  console-failure allowlist: [docs/contributing/testing.md](docs/contributing/testing.md)
- A code comment citing "Plan NN" points at that plan's design rationale in
  [docs/plans/](docs/plans/) — start at
  [docs/plans/00-overview.md](docs/plans/00-overview.md).
- Editor behavior (markdown round-tripping, keybindings, slash menus, wiki
  links, paste/drop) often bottoms out in Meowdown, the first-party editor
  consumed as `@meowdown/core` / `@meowdown/react`. Fix it there rather than
  papering over it here.

## Cutting a Kore release (bump)

When the user says **bump**, **fai bump**, or **fai partire il bump**, follow this
procedure. Do not diagnose Apple signing secrets, wait on TestFlight, or retry the
notarized **Release** workflow.

1. Confirm the work to ship is already on `origin/master`.
2. Confirm `version` in `apps/desktop/package.json` is the version to publish.
   If it still matches the last published `Kore v*` GitHub release, bump it
   there only (patch unless the user specifies otherwise), merge that to
   `master`, and continue. If a `chore: release X.Y.Z` PR is already open,
   merging it is equivalent. Never edit changelogs or `.github/release-please/`
   manifests as part of this step. Feature PRs must not touch the version.
3. Point the `release/dmg` branch at current `master`. It is a pointer, not
   history — `--force` is expected when previous pointer-retrigger commits sit
   on that branch:

   ```bash
   git fetch origin master
   git push --force origin origin/master:release/dmg
   ```

4. Watch the **Release DMG** workflow (`.github/workflows/release-dmg.yml`).
   That build publishes `Kore v<version>` (unsigned Apple Silicon DMG plus
   updater `latest.json`). That is the bump; it is done when that run succeeds.

Do not run `pnpm release:macos` or wait for `.github/workflows/release.yml`. See
[AGENTS.md — Cutting a Kore release (bump)](AGENTS.md#cutting-a-kore-release-bump)
for the same procedure.
