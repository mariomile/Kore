# Kore

Plain-file notes for Mac and iPhone: daily notes, wiki links, a graph view,
tabs, local search, and AI over your own Markdown — billed to the ChatGPT or
Claude subscription you already have.

Kore is a personal fork of
[Reflect (reflect-open)](https://github.com/team-reflect/reflect-open) — an
open-source, local-first note app by the Reflect team, MIT-licensed. Kore
keeps Reflect's plain-file model and privacy stance and builds a customized
experience on top: a Craft/Linear-grade design language, note tabs, a dual
sidebar layout, a force-directed graph view, an in-app browser and file
viewer, and subscription AI through local coding-agent CLIs.

The app does not require any account. Notes live in a folder you choose, and
optional services such as AI providers, transcription, iCloud, GitHub, or
another git remote are connected directly by the user.

## What Kore adds on top of Reflect

- **Design language:** ink hairlines, one accent color, raised-pill controls,
  a floating note card between two full-height rails — light and dark, with
  themes (Space, Midnight, Paper) and custom accent colors.
- **Note tabs:** a Linear-style tab strip (`⌃Tab`/`⌃⇧Tab` cycle, `⌘W`
  closes, double-click pins) plus an "Open" section in the sidebar, persisted
  per graph and restored at launch.
- **Dual rails:** the left navigation and the right context rail (Details /
  Chat / Calendar panels) collapse independently — `⌘\` and `⌘⇧\`.
- **Graph view:** every note and wiki link as a force-directed map — pan,
  zoom, hover to spotlight a neighborhood, drag to rearrange, click to open.
- **In-app browser:** web links in notes open in their own window inside the
  app (Alt-click for the OS browser). Pages get a bare webview with zero
  access to your notes.
- **File viewer:** PDF, HTML (fully sandboxed), DOCX, CSV/TSV, and plain-text
  attachments open in-app; anything else falls back to the OS.
- **Subscription AI:** chat with your notes through the locally installed
  Claude Code or Codex CLI — including **Sign in with ChatGPT** from inside
  the app — with `private: true` notes hard-blocked at the CLI sandbox level.
  BYOK providers (OpenAI, Anthropic, Google, OpenRouter) still work.
- **Agents:** named agent profiles with a soul (identity — your file) and a
  memory (its file), a shared user profile and shared memory (signed facts +
  a session journal) every agent reads, edit mode so chat can actually work
  the vault, write approval, and **Automations** — scheduled agent runs
  (with a one-click Memory curator) that keep the whole thing tidy — plus
  **MCP servers** configured in-app (tokens in the OS keychain, never on
  disk) that give agents external tools in edit mode. All of it plain
  markdown under `agents/`, portable and versioned like any note.
- **Everything else:** unlinked mentions with one-click linking, an All-notes
  masonry view, template placeholders (`{{date}}`, `{{time}}`, `{{title}}`),
  task priorities and recurrence, saved searches, and an Insights dashboard.

See [docs/delivery-log.md](docs/delivery-log.md) for the full changelog of the
customization, and [docs/roadmap.md](docs/roadmap.md) for what is planned next.

## Product planning

The next development wave targets a **local-first Personal OS**: Graph-scoped
knowledge, multiple external accounts, persistent agents, structured Objects,
and a durable execution runtime. This is planned direction, not a list of
features already available in the installed app.

- [Roadmap](docs/roadmap.md): Priorities, slice build guidance, risk register,
  and delivery gates.
- [Target architecture](docs/kore-target-architecture.md): Domain, runtime, privacy,
  storage, existing-source baseline, and unresolved design decisions.
- [Plan 25](docs/plans/25-personal-os.md): All 29 initiatives, dependencies,
  first implementation slices, acceptance tests, and source traceability.
- [Planning inventory](docs/planning-index.md): Every planning, decision, porting,
  and supporting reference document in this repository.

## Install

The app ships under the product name **Kore** (the repository is Kore);
the bundle you install is `Kore.app`.

**Install from a release (recommended):** grab the latest `.dmg` from
[Releases](https://github.com/mariomile/Kore/releases) and drag
**Kore.app** into Applications. The build is unsigned, so recent macOS
quarantines the download and claims the app "is damaged" — it isn't; clear
the quarantine flag once from Terminal and open normally:

```bash
xattr -cr /Applications/Kore.app
```

(If macOS still objects: System Settings → Privacy & Security → "Open
Anyway".) From then on the app updates itself from new releases — check
Settings → About, or just wait.

**Or build from source** — prerequisites first (one-time):

```bash
xcode-select --install                # Xcode Command Line Tools
curl https://sh.rustup.rs -sSf | sh   # Rust toolchain
npm install -g pnpm                   # pnpm (Node 22+ required)
```

```bash
git clone https://github.com/mariomile/Kore.git kore
cd kore
pnpm install
pnpm tauri build
```

The installers land in `apps/desktop/src-tauri/target/release/bundle/`:

- `macos/Kore.app` — drag it into `/Applications`
- `dmg/*.dmg` — the same app as a disk-image installer

A locally built app runs without Gatekeeper warnings on the machine that
built it. To produce signed, notarized installers for other Macs (with
auto-update), use `pnpm release:macos` — see
[docs/macos-distribution.md](docs/macos-distribution.md).

Kore ships with its own Apple identity (`app.lore.*`, iCloud container
`iCloud.app.lore`). iCloud sync and iPhone installs need an Apple Developer
account — the one-time checklist is in
[docs/kore-apple-signing.md](docs/kore-apple-signing.md); everything else
(local graphs, Git history, GitHub sync) works with no account at all.

For a quick look without installing, `pnpm tauri dev` runs the app with hot
reload; `pnpm tauri:dev` runs the separate "Dev" flavor that coexists with an
installed build.

## Your Notes Are Files

Kore calls a notes folder a **graph**. A graph is a folder you can inspect,
back up, sync, or edit with other tools:

```text
my-graph/
├── daily/2026-06-12.md     # Daily notes, named by date
├── notes/some-title.md     # Other notes, named from their titles
├── templates/              # Note templates (placeholders expand on insert)
├── assets/                 # Images and attachments
└── audio-memos/            # Audio recordings and transcripts
```

Markdown files are the source of truth. Kore adds search, backlinks, tags,
tabs, and the graph view on top, but the files remain usable in any Markdown
editor.

## Sync and Privacy

For simple file sync across Apple devices, create your graph inside an
iCloud-synced folder. For versioned backup or non-iCloud sync, connect GitHub
in the app or add [any SSH git remote](docs/generic-git-remotes.md).

By default, note content stays on the device. External calls only happen
after you configure a provider, connect a git remote, or use a platform sync
service. `private: true` in a note's frontmatter is a hard block: that note's
content never reaches AI or other content-processing services — enforced for the
CLI providers at the sandbox level, not by prompt. See
[docs/privacy.md](docs/privacy.md) for the full model. User-enabled file sync
and backups include private notes. Git sync excludes chat history and chat
attachments; use Settings → Sync & data → Graph archive on Mac to export and restore
notes, saved chats, attachments and graph automations together.

## Project Layout

Kore is a pnpm/Turborepo monorepo (structure inherited from Reflect):

```text
kore/
├── apps/desktop/          # Mac and iOS app (Tauri 2 shell + React frontend)
├── apps/cli/              # `reflect` CLI — Rust read/discovery/capture tool
├── apps/extension/        # Chrome capture extension
├── apps/native-host/      # Browser capture helper (native-messaging spooler)
├── packages/core/         # Shared TypeScript business logic
├── packages/db/           # Database types and helpers (Kysely + IPC dialect)
├── packages/utils/        # Small dependency-free helpers (ISO date math)
├── crates/index-schema/   # Shared SQLite index schema and migrations
├── crates/graph-paths/    # Shared graph-path classification (Rust ↔ TS parity)
├── plugins/               # First-party Tauri plugins (keyboard, recording)
├── fixtures/              # TS ↔ Rust parity test corpora
├── design-system/         # Design tokens and the Inter webfont
└── docs/                  # Product, architecture, and contributor docs
```

See [AGENTS.md](AGENTS.md) for conventions and the development cycle.

## Development

Common commands from the repository root:

```bash
pnpm dev              # turbo dev: Vite app on http://localhost:1420 (+ extension dev server)
pnpm check            # typecheck + lint
pnpm test             # vitest; use --run path/to/test for one file
pnpm --filter @reflect/desktop e2e  # Chromium smoke of the Vite app (no Tauri shell)

# Rust tests that compile the desktop crate need sidecars staged first
pnpm --filter @reflect/desktop sidecar
cargo test --workspace
```

## Credits and License

Kore is built on [Reflect (reflect-open)](https://github.com/team-reflect/reflect-open)
by the Reflect team. Both the upstream project and this fork are
[MIT](LICENSE)-licensed. Upstream fixes are merged deliberately — see
[docs/upstream-merges.md](docs/upstream-merges.md) for the playbook.
