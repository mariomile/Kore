### Purpose

This document helps AI agents and automated systems interact with the Reflect repo safely and effectively. It summarizes setup, workflows, CI parity, testing, directories, and environment variables.

Finish the current task with the minimum sufficient approach. Do not add
engineering, abstractions, tests, or process that the requested outcome does not
need. Planning can be rigorous, but execution should stay lean. If the clean
design requires a broader change, stop and explain why instead of quietly
expanding scope.

### Execution discipline

#### Workflow

1. Understand the requirement before touching code. Do not change code and then
   infer the intent from the result.
2. Use stronger reasoning for planning or clarification when needed. Default to
   lighter execution once the plan is clear.
3. Do not spend reasoning on the entire session. Increase it only for a specific
   decision that needs it.
4. Work single-threaded by default. Split work across agents only after the task
   has proven that parallel ownership will help.
5. Enable only the skills the task actually needs. Do not install heavyweight
   process skills for a small change.
6. Before execution, write the smallest useful plan for non-trivial work:
   - Goal
   - Non-goals
   - Acceptance criteria
   - What stays untouched

#### Failure modes

Avoid these patterns:

1. Fixing only the visible symptom before understanding the requirement.
2. Piling patches, compatibility layers, duplicate implementations, or copies on
   top of a root-cause fix that could have stayed clean.
3. Redesigning an area repeatedly and making every maintenance pass expensive.
4. Continuing from a false premise. Correct the premise before adding more
   reasoning.
5. Reading the code directly but using search or guessing instead of the evidence
   already available.
6. Adding tests as cover for expanded scope, new abstractions, or insufficient
   understanding.

#### Action boundaries

Before starting, restate what the user wants, the intended scope, what is
explicitly out of scope, and the definition of done when any of those are not
already obvious from the request.

Any irreversible operation requires explicit user authorization before execution.
The following are normally reversible and do not require a separate confirmation
when they are already within the requested scope:

- Git revert, restore, or branch switch
- Moving files to a backup directory inside the repo
- Running tests, viewing diffs, generating plans, or read-only analysis

Stop and switch to a smaller plan if you catch yourself:

- Adding abstraction, framework, or configuration layers the task does not need
- Designing for possible future use
- Stacking constraints only to satisfy earlier constraints
- Touching many unrelated files
- Creating a second implementation to preserve obsolete logic
- Using test additions as the reason to keep building

#### Testing discipline

Tests serve the current change's acceptance criteria and nothing else.

1. Prefer the existing tests closest to the changed behavior.
2. Do not add tests when existing tests already prove the change.
3. Add a test only when existing tests cannot cover the changed behavior or the
   user explicitly requested tests.
4. New tests should cover at most the main path and one critical failure path.
5. Do not expect tests to prove completeness.
6. Do not backfill unrelated modules.
7. Do not introduce new test frameworks or infrastructure.
8. Do not write snapshot matrices, parameterized grids, or end-to-end suites
   unless the request requires them.
9. Do not test boundaries the current requirement did not ask for.
10. Do not let test volume justify additional abstraction.

Before adding a test, answer:

- Which acceptance criterion does it verify?
- Would existing tests miss this regression without it?
- Is the test simpler than the implementation it protects?

If test code becomes longer or more complex than the implementation, treat that
as an overengineering warning.

#### Model allocation

- Requirement clarification and plan review: Stronger reasoning.
- Writing or changing code and running tests: Medium-low or lighter execution.
- If execution starts stacking architecture or expanding scope: Stop and rewrite
  a minimal plan before continuing.

#### Pre-completion checklist

- Restated intent and acceptance criteria when they were not already explicit
- Used the minimum sufficient approach
- Marked non-goals clearly
- Read the relevant code directly instead of guessing
- Changed only the minimum file set
- Ran the closest existing tests
- Added no tests for scenarios outside the request
- Added no new dependencies or directory structures
- Kept the diff small, with no leftover debug code
- Did not do extra work merely to make the result look more complete

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

- **Track program work in [docs/STATE.md](docs/STATE.md).** Read it before
  starting or resuming work on the Personal OS program, and update it in the
  same session as the work it records: tick what became true (with how it was
  verified), set the next step, refresh the date. Work recorded only in a chat
  summary is lost.
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
upstream path this fork does not use for day-to-day publishes.

### Cutting a mobile bump (TestFlight)

When the user says **bump mobile** (or asks to ship the iPhone build), point
the `release/testflight` branch at current `master` — the same pointer
pattern as `release/dmg`:

```bash
git fetch origin master
git push --force origin origin/master:release/testflight
```

That fires the **TestFlight** workflow (`.github/workflows/testflight.yml`):
an iOS build on a macOS runner, uploaded to App Store Connect with an
App-Store-Connect export and a UTC-timestamp build number. It requires the
`APPLE_API_KEY`, `APPLE_API_ISSUER`, and `APPLE_API_KEY_CONTENT` repository
secrets (see docs/ios-testflight.md); the run fails on its first step,
naming the missing ones, when they are not configured. The desktop bump
never gates on this — mobile and desktop publish independently.

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
│   ├── graph-paths/        # Shared graph-relative path classification + vault walker
│   │                       #   (kept in lockstep with packages/core/src/graph/paths.ts)
│   └── note-policy/        # Shared frontmatter parsing + first-H1 title extraction
│                           #   (one policy for the desktop backup path + CLI reader)
├── plugins/                # First-party Tauri 2 plugins: tauri-plugin-keyboard (iOS keyboard
│                           #   pinning + haptics), tauri-plugin-recording (native audio memos)
├── fixtures/               # TS ↔ Rust parity corpora (fold keys, path classification,
│                           #   frontmatter/index parity — see fixtures/parity/README.txt)
├── design-system/          # Design tokens + the Inter webfont (see design-system/readme.md)
├── docs/                   # Product/architecture docs + plans/, decisions/, contributing/, porting/
├── Cargo.toml              # Root Cargo workspace: reflect-open, reflect-cli, reflect-capture-host,
│                           #   reflect-index-schema, reflect-graph-paths, reflect-note-policy, and
│                           #   the two Tauri plugins
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
`design-system/` carries the design **tokens** and the Inter webfont, and
nothing else: UI primitives are the shadcn components in
`apps/desktop/src/components/ui/`, and icons come from
`apps/desktop/src/components/icons/`. Key resources:

- `design-system/tokens/`: CSS custom properties for color, typography, spacing, and motion
- `design-system/styles.css`: global entry point that imports all tokens
- `apps/desktop/src/components/ui/`: the shadcn components. Check here before building custom UI
- The fork's own design language is described in the README

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
