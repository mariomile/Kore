### Purpose

This document helps AI agents and automated systems interact with the Reflect repo safely and effectively. It summarizes setup, workflows, CI parity, testing, directories, and environment variables.

### What is Reflect

Reflect is a modern note‑taking tool with a TypeScript codebase. This repo contains Reflect V2, a rewrite of the original Reflect code-base to make it offline-first, markdown backed, and open source.

### Naming

Two names coexist and are both intentional — do not "fix" one into the other:

- **Reflect** is the upstream project this repo forked from; internal
  identifiers keep its names (`@reflect/*` packages, `reflect-*` crates, the
  `reflect` CLI, `.reflect/` index directory).
- **Kore** is this fork and the only name a user ever sees: the repository,
  the `productName` in `apps/desktop/src-tauri/tauri.conf.json` and its
  overlays (the bundle is `Kore.app`; the flavors are Kore / Kore Beta /
  Kore Dev), the window title, the iOS home screen, the iCloud Drive folder,
  and every permission prompt.

Two exceptions keep older spellings on purpose, and renaming either one
breaks working installs:

- Apple technical identity stays `app.lore.*` and `iCloud.app.lore` —
  changing it breaks signing and iCloud, and macOS would treat the build as
  a different app.
- The keychain service in `apps/desktop/src-tauri/src/secrets.rs` stays
  `"lore"`: renaming it orphans every API key already stored by an
  installed app.

### Product Principles

Drawn from the product docs — read these for deeper context:
[V1 Overview](docs/reflect-v1-overview.md) · [V2 Product Vision](docs/reflect-v2-product-vision.md) · [V2 Grounding Brief](docs/reflect-v2-grounding-brief.md) · [Indexing Strategy](docs/reflect-v2-indexing-strategy.md) · [Sync Strategy](docs/reflect-v2-sync-strategy.md)


- **Daily notes first.** The app opens to today's note. All capture flows into the daily note by default.
- **Association over hierarchy.** `[[Wiki Links]]` replace folders. The note graph is the organizing model; there are no folders.
- **Markdown is the source of truth.** Notes are `.md` files (`daily/YYYY-MM-DD.md`, `notes/`). SQLite under `.reflect/` is a rebuildable projection of the notes — with one durable exception: the `chat_*` tables hold AI chat history, which is not derivable from markdown. Index wipes and rebuilds must leave them untouched.
- **No Reflect-hosted APIs.** LLM calls go directly to user-approved providers (OpenAI, Anthropic, etc.). Sync goes to GitHub/iCloud/Git. Never proxy through Reflect infrastructure.
- **BYOK AI.** AI features use user-supplied keys. Never assume Reflect operates AI infrastructure.
- **`private: true` is a hard block.** Notes with this frontmatter flag must never have their content sent to any external service — AI, transcription, or otherwise. Enforce at every call site.
- **Keyboard-native UX.** Every core workflow must be reachable from the keyboard. This is product identity, not polish.
- **Minimal UI.** Do less, and do it well. Don't add surfaces that compete with the editor.
- **Secrets in the OS keychain.** API keys and credentials never go in markdown, Git, or `.reflect/`.
- **Portable data.** Full export (JSON, markdown, HTML) must work from day one.
- **No Electron.** Desktop shell is Tauri.
- **MIT open-source core.** Write as if the code is public and will be critiqued.

### Agent workflow

- **Verify before answering.** When answering factual questions about what the code
  does, read the relevant source first and trace behavior to the final output. If
  you have not verified something, say so instead of guessing.
- **Plan proportionally.** For non-trivial, ambiguous, or high-risk changes, form a
  short plan before editing and ask for sign-off when the direction affects public
  APIs, migrations, release behavior, or broad UX. Simple localized fixes can
  proceed once the relevant context is understood.
- **Use a dedicated worktree or branch.** Check `git status` before editing and
  before staging. Preserve unrelated user changes; ask before publishing if the
  worktree is dirty, the PR scope is ambiguous, or staging would include changes
  you did not make.
- **Prefer the clean design.** Optimize for the correct open-source shape rather
  than the smallest diff. Avoid compatibility shims, dual paths, or legacy behavior
  unless the product/release context requires them.
- **Verify locally.** Run typecheck, lint, and targeted tests for the code you
  touched. If a required check cannot run, report the reason and the residual risk.
- **Publish completed work.** When a requested implementation is complete and
  verified, create or use an appropriate branch, commit the intended changes, push,
  open a normal ready-for-review PR, and wait for CI/checks, Bugbot, review
  comments, merge conflicts, and other blockers to settle.

### Development workflow

Development happens on `master` (the only long-lived branch); branch from it and
target it with PRs. Publishing a Kore build is a **bump** (see
[Cutting a Kore release (bump)](#cutting-a-kore-release-bump) below) — not the
upstream notarized `Release` workflow. See
[docs/macos-distribution.md](docs/macos-distribution.md) and
[docs/kore-apple-signing.md](docs/kore-apple-signing.md#publishing-a-kore-release).

PR titles must be conventional commits (`feat:` / `fix:` / `chore:` …, enforced by
CI). The title becomes the squash-commit message, and — for `feat`/`fix` — is the
user-facing changelog entry, so write it as behavior, not implementation. Do not
use `feat!:` or `BREAKING CHANGE:` footers; see [CONTRIBUTING.md](CONTRIBUTING.md).

The app version lives solely in `apps/desktop/package.json`. Feature PRs must not
touch it, the changelog (`apps/desktop/CHANGELOG.md`), or the manifest under
`.github/release-please/`. Those three move together, and only through the
Release PR — see below.

### Cutting a Kore release (bump)

When the user says **bump**, **fai bump**, or **fai partire il bump**, do this
and nothing else. Do not diagnose Apple signing secrets, wait on TestFlight, or
retry the notarized **Release** workflow.

1. Confirm the work to ship is already on `origin/master`.
2. Merge the open `chore: release X.Y.Z` PR — the one **Release PR**
   (`.github/workflows/release-please.yml`) keeps refreshed against `master`.
   Merging it *is* the bump: it sets `version` in `apps/desktop/package.json`,
   prepends `apps/desktop/CHANGELOG.md`, and advances
   `.github/release-please/manifest.stable.json`, all in one commit.

   Only when there is no Release PR (nothing since the last release carried a
   `feat:`/`fix:` title) bump by hand — and by hand means doing everything the
   Release PR does, in one commit: `version` in `apps/desktop/package.json`
   (patch by default), the matching `apps/desktop/CHANGELOG.md` entry, and
   `.github/release-please/manifest.stable.json`. Moving only the version is
   what produced the drift this procedure now guards against: versions
   published with no changelog entry, and a lagging manifest that makes the
   next Release PR re-list commits that already shipped.
   `release-please-workflow.test.mjs` fails CI when the three fall out of
   step.
3. Point the `release/dmg` branch at current `master`. It is a pointer, not
   history — `--force` is expected when previous pointer-retrigger commits
   sit on that branch:

   ```bash
   git fetch origin master
   git push --force origin origin/master:release/dmg
   ```

4. Watch the **Release DMG** workflow (`.github/workflows/release-dmg.yml`).
   That build creates the `v<version>` tag and publishes `Kore v<version>`
   (unsigned Apple Silicon DMG plus updater `latest.json`). That is the bump;
   it is done when that run succeeds.

Publishing lives entirely in step 4. The Release PR workflow deliberately
creates no release and no tag (`skip-github-release`): when it also created
them, they landed as untagged, asset-less drafts the in-app updater could
resolve as "latest".

Do not run `pnpm release:macos` or wait for `.github/workflows/release.yml`
(signed + notarized macOS + TestFlight). That pipeline is a separate
upstream path this fork does not use for day-to-day publishes; it and
`testflight.yml` stay available on `workflow_dispatch` only.

Daily loop:

1. Make your changes
2. Run typecheck (`pnpm typecheck`)
3. Run lint (`pnpm lint`) — fix any errors; `pnpm fix` auto-fixes where possible
4. Run specific tests for your changes (`pnpm test --run path/to/test`)

`pnpm check` runs typecheck + lint together. Run it before declaring any work done.

### Running tests

There are too many tests for you to run them all, so you will just have to run the ones that are specific to whatever logic you've written.

Local unit tests:

```bash
# Run vitest tests
pnpm test --run path/to/test
```

Desktop JS tests are split into Vitest projects (details in
`docs/contributing/testing.md`):

- `*.test.tsx` files run in a real browser via Vitest browser mode +
  Playwright (the `browser` project). Chromium by default;
  `REFLECT_TEST_BROWSER=webkit` runs WebKit (the engine of the production
  Tauri webview); `DEBUG=1` opens a headed window. One-time setup:
  `pnpm --filter @reflect/desktop test:install`.
- `*.test.ts` files are pure logic and run in node (the `node` project). A
  logic test that drives the DOM is named `.test.tsx` so it lands in the
  browser project.
- `console.warn` / `console.error` fail tests (`vitest-fail-on-console`).
  Pre-existing noise is allowlisted in
  `apps/desktop/src/test-utils/allowed-console.ts`; PRs may only shrink that
  list, and a new entry needs a stated reason.

Rust tests (the Cargo workspace: desktop shell, `reflect` CLI, capture host,
shared crates, and the Tauri plugins — see the layout below):

```bash
# Prefer per-crate runs; cargo test --workspace also works
cargo test -p reflect-cli
cargo test -p reflect-open
```

**Before any cargo build/check/test that compiles the desktop crate** (including
`--workspace` commands and clippy), the sidecars (the `reflect` CLI and the
`reflect-capture-host` native-messaging host) must be staged once per checkout:

```bash
pnpm --filter @reflect/desktop sidecar
```

Otherwise tauri-build fails with `resource path binaries/<name>-<triple> doesn't exist`
(`pnpm tauri dev`/`build` stage them automatically; details in [docs/cli.md](docs/cli.md)).

### Repo layout

Reflect is a **Turborepo + pnpm monorepo** around a **Tauri 2** desktop/mobile app: a
React + TypeScript frontend bundled by Vite, embedded in a Rust native shell. The Rust
crates form a single **Cargo workspace** rooted at the repository root.

```
Kore/
├── apps/
│   ├── desktop/            # @reflect/desktop — the Tauri 2 app
│   │   ├── src/            # React frontend (main.tsx, app.tsx, desktop-root.tsx, platform-root.tsx,
│   │   │                   #   components/, editor/, hooks/, lib/, mobile/, providers/, routing/,
│   │   │                   #   styles/, dev/, test-utils/); calls Rust via @tauri-apps/api
│   │   ├── src-tauri/      # Tauri native shell (Rust crate `reflect-open`)
│   │   │   ├── src/        # lib.rs (#[tauri::command] handlers, plugins), db/, fs/, git/,
│   │   │   │               #   icloud/, conflict/, plus per-feature modules (watcher.rs,
│   │   │   │               #   embed.rs, secrets.rs, settings.rs, calendar.rs, pty.rs, …)
│   │   │   ├── tauri.conf.json          # build hooks, windows, bundle targets (incl. iOS)
│   │   │   ├── tauri.<platform>.conf.json  # desktop overlays: bundle the reflect CLI sidecar
│   │   │   ├── tauri.{dev,beta,ios,ios.dev}.conf.json  # flavor overlays (Kore Dev / Beta / iOS)
│   │   │   ├── capabilities/            # Tauri 2 permission grants (default/desktop/ios/mobile)
│   │   │   ├── icons/, icons-beta/, icons-dev/  # App icons per release channel
│   │   │   ├── gen/                     # Generated schemas + platform projects (hand-written
│   │   │   │                            #   Swift for widgets/share lives under gen/apple/)
│   │   │   ├── skills/, xcode-scripts/  # Agent-CLI graph skill; Xcode build phases
│   │   │   └── ios.project.yml          # iOS XcodeGen template
│   │   ├── scripts/        # build-sidecar.mjs, generate-icons.mjs, release-macos.mjs,
│   │   │                   #   release-ios.mjs (+ their .test.mjs suites)
│   │   ├── e2e/            # run-e2e.mjs — Chromium smoke of the Vite app (no Tauri shell)
│   │   ├── dist/           # Vite build output (frontendDist in tauri.conf.json)
│   │   └── public/         # Static assets served by Vite
│   ├── cli/                # `reflect` — self-contained Rust read/discovery/capture CLI (docs/cli.md)
│   ├── extension/          # @reflect/extension — Chrome MV3 capture extension (WXT; see its README)
│   └── native-host/        # `reflect-capture-host` — native-messaging spooler sidecar (Plan 11)
├── packages/
│   ├── core/               # @reflect/core — the TS business logic (markdown/, indexing/, graph/,
│   │                       #   embeddings/, ai/, settings/, tags/, sync/, actions/, ipc/, …)
│   ├── db/                 # @reflect/db — generated Kysely schema + the IPC dialect
│   └── utils/              # @reflect/utils — small dependency-free helpers (ISO date math)
├── crates/
│   ├── index-schema/       # Shared SQLite migrations for <graph>/.reflect/index.sqlite
│   │                       #   (one schema for the desktop writer + CLI reader)
│   └── graph-paths/        # Shared graph-relative path classification + vault walker
│                           #   (kept in lockstep with packages/core/src/graph/paths.ts)
├── plugins/                # First-party Tauri 2 plugins: tauri-plugin-keyboard (iOS keyboard
│                           #   pinning + haptics), tauri-plugin-recording (native audio memos)
├── fixtures/               # TS ↔ Rust parity corpora (fold keys, path classification,
│                           #   frontmatter/index parity — see fixtures/parity/README.txt)
├── design-system/          # Design tokens, components, and UI guidelines (see design-system/readme.md)
├── docs/                   # Product/architecture docs + plans/, decisions/, contributing/, porting/
├── Cargo.toml              # Root Cargo workspace: reflect-open, reflect-cli, reflect-capture-host,
│                           #   reflect-index-schema, reflect-graph-paths, and the two Tauri plugins
└── turbo.json, pnpm-workspace.yaml
```

### Related repos

- **Meowdown:** the local checkout lives at `~/repos/meowdown`. Meowdown is the
  first-party hybrid/live-preview Markdown editor that Reflect uses through
  `@meowdown/core` and `@meowdown/react`. When investigating editor behavior,
  markdown round-tripping, keybindings, slash menus, wiki links, task checkboxes,
  paste/drop handling, or mobile editor quirks, check that repo as well as this
  one. If the root cause is in Meowdown, fix it there and open the PR against the
  Meowdown project rather than papering over it in Reflect.

**Design system**

All UI work should follow the design system. Note that
[`design-system/readme.md`](design-system/readme.md) documents the **upstream
Reflect brand** (its marketing claims — pricing, E2EE, GPT-4 — do not describe
this app); the operative resources for app UI are the tokens, the shadcn
components in `apps/desktop/src/components/ui/`, and this fork's design
language described in the README. Key resources:

- `design-system/tokens/` — CSS custom properties for color, typography, spacing, and motion
- `design-system/components/` — reusable React primitives (Button, Input, Badge, etc.)
- `design-system/guidelines/` — color, type, spacing, and brand specimens
- `design-system/styles.css` — global entry point that imports all tokens

**Frontend ↔ Rust bridge**

- Define commands in `apps/desktop/src-tauri/src/` (registered in `lib.rs`'s `invoke_handler`) with `#[tauri::command]`.
- Call commands from the frontend with `invoke` from `@tauri-apps/api/core`.
- Add Tauri plugins in `apps/desktop/src-tauri/Cargo.toml` (Rust) and grant permissions in `apps/desktop/src-tauri/capabilities/`.

**Common commands** (run from the repo root)

```bash
pnpm dev              # turbo dev across packages (Vite on http://localhost:1420)
                      #   add ?platform=ios to the URL to preview the MOBILE tree in a
                      #   plain browser (dev-only in-memory bridge + seeded demo graph)
pnpm tauri dev        # Full Tauri app with hot reload (stages the CLI sidecar first)
pnpm tauri:dev        # `pnpm tauri dev` with the dev overlay → the "Kore Dev" flavor (green icon, own identifier; coexists with Kore / Kore Beta)
pnpm build            # turbo build pipeline → apps/desktop/dist/
pnpm tauri build      # Native app bundle, incl. the reflect CLI sidecar
# Kore day-to-day publish: bump via release/dmg (see "Cutting a Kore release" above).
# pnpm release:macos is the separate signed+notarized local path, not the bump.
pnpm tauri:ios:dev "iPhone 17 Pro"  # Run the Tauri iOS target in the simulator (docs/contributing/mobile-simulator.md)
pnpm release:ios preflight --build-number=123  # Check iOS/TestFlight signing, App Store Connect app record, and upload auth
pnpm release:ios testflight --build-number=123 --wait  # Build and upload the iOS app to TestFlight
```

**iOS simulator**

The mobile app is the Tauri iOS target of `apps/desktop`, not a separate
package. Use `pnpm tauri:ios:dev "iPhone 17 Pro"` from the repo root (or
`pnpm tauri:ios:dev --host` for a physical device); debug builds are the dev
flavor (`app.lore.ios.dev`, shown as `Kore Dev`) and need that script's
config overlay, so do not run plain `tauri ios dev`. List
available simulator names with `xcrun simctl list devices available`. The first
run can be quiet while Xcode compiles Rust, Swift plugin code, and native
dependencies. See `docs/contributing/mobile-simulator.md` before committing
changes under `apps/desktop/src-tauri/gen/apple/`, because Tauri/Xcode may
normalize generated project and plist files.

**iOS TestFlight**

Use `pnpm release:ios` for TestFlight work; do not hand-roll `tauri ios build`
and `altool` unless debugging the helper itself. Start with
`pnpm release:ios preflight --build-number=<number>`, then run
`pnpm release:ios testflight --build-number=<number> --wait` or upload an
existing IPA with `pnpm release:ios upload --ipa=<path> --wait`.

The iOS bundle identifier is `app.lore.ios`, intentionally separate from the
old Capacitor TestFlight app (`app.reflect.ReflectMobile`). The release helper
verifies the IPA bundle identifier and `ITSAppUsesNonExemptEncryption=false`
before upload. See `docs/ios-testflight.md` for App Store Connect setup, local
keychain fallback (`reflect-notary`), API key CI secrets, and troubleshooting.

# Code Conventions

Write code as if this open-source repository will be reviewed closely by other
engineers. Favor small, composable modules, explicit contracts, tests that
document behavior, and the existing local patterns over new abstractions.

## Structured Code Style

- Keep files focused and single-responsibility. Split out helpers, hooks, and
  components when a module starts doing more than one thing.
- Use kebab-case for directories, TypeScript files, and React component files.
- Prefer `@/` imports where the project already uses them.
- Avoid comments unless they explain non-obvious decisions or complex logic.
  Do not add comments that merely restate the code.
- Always write documentation for public APIs.
- Never use single-character variable names.
- Always run build/typecheck/lint before declaring implementation work done.

## TypeScript

- Prefer interfaces for object definitions.
- Use type aliases for unions, intersections, and mapped types.
- Never use `any` or `as any`.
- Avoid type assertions unless they are genuinely necessary.
- Use strict, idiomatic TypeScript with proper null handling.
- Use discriminated unions and type guards for variant data. Export helper
  predicates when they clarify a public contract.
- Use readonly fields for immutable data.
- Use generics for reusable type patterns.
- Keep shared types in `types.ts` files or close to their consumers when local.
- Use explicit return types for public functions.
- Prefer function declarations for named functions and arrow functions for
  callbacks.
- Prefer async/await over Promise chains.
- Prefer functional patterns over classes.

## Data Boundaries

- Use Zod for all incoming or untrusted data, including JSON, IPC payloads,
  external API responses, file-derived metadata, and worker payloads.
- Normalize casing once at the boundary; TypeScript types should be camelCase.
- Do not use type assertions to parse JSON.
- When pulling database types from Kysely, use the appropriate helper type such
  as `Selectable<T>`, `Insertable<T>`, or `Updateable<T>` instead of raw table
  types in public function parameters or returns.
- Handle Promise rejections properly, but do not add broad defensive error
  handling unless the call site needs it.

## React

- Favor named exports for components.
- Keep one React component per file unless a tiny private helper component is
  inseparable from its parent.
- Name React props interfaces with the component name plus `Props`, for example
  `ButtonProps`.
- Do not add `use client` or `use server` directives.
- Do not `import * as React from 'react'`; import the specific React APIs.
- Never call hooks conditionally.
- Keep logic as low as possible in the tree. Prefer providers and small hooks for
  shared state.
- Move large mutation handlers, parsing, persistence, and business logic into
  helpers or hooks instead of embedding them inside components.
- `zod` and `react-hook-form` are available; use them for validated forms.

## UI and Styling

- Use Tailwind CSS, React, shadcn/ui components, Radix, and Tailwind Aria.
- Icons come from `@/components/icons` and nowhere else — one Solar-derived
  family, documented in `apps/desktop/src/components/icons/readme.md`. Add a
  missing glyph to that set instead of importing a second icon library.
- Generate responsive designs and provide default props for reusable React
  components.
- Always check `apps/desktop/src/components/ui/` before building custom UI.
- For popups, popovers, dropdowns, dialogs, tooltips, menus, comboboxes, and
  other overlays, use the existing shadcn component from
  `apps/desktop/src/components/ui/`. If the shadcn primitive is missing locally,
  install or generate it there and use it. Never hand-roll an overlay primitive
  when shadcn already covers it.
