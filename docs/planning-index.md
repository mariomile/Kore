# Kore planning inventory

**Updated:** 2026-08-30.
**Scope:** Every Markdown document under `docs/`, plus root/implementation entry
points listed below. Fixture Markdown, generated permission references, package
changelogs and design specimens are not product planning documents.

## Read order and authority

1. Current user request and repository `AGENTS.md` define scope and permissions.
   [STATE.md](STATE.md) records what is currently in progress and the next step;
   read it before starting or resuming program work, and update it whenever a
   session moves the program.
2. [Target architecture](kore-target-architecture.md) and
   [TDR 0006](decisions/0006-personal-os-boundaries.md) define the next-wave direction.
3. [Roadmap](roadmap.md) orders work;
   [Plan 25](plans/25-personal-os.md) owns initiative scope, dependencies and gates.
4. [Supplied specification](kore-architecture-source.md) preserves all original
   requirements; Plan 25 maps every section and makes conflicts explicit.
5. Earlier plans, decisions, grounding, and porting docs explain the baseline.
   Their old status/deferred labels do not override current source or the new plan.

Document status is not product status. “Implemented” in an older document is a
report from that document's date, not a fresh runtime or release verification.
The source evidence in the target architecture was inspected at `ab96c077`.

## Catalog

The inventory contains **97 documents under `docs/`**, including this index.

### Active next-wave planning

| File | Title / purpose | Planning role / status |
|---|---|---|
| [STATE.md](STATE.md) | Kore working state | What is in progress now and the next step; updated by every session that moves the program. |
| [roadmap.md](roadmap.md) | Kore roadmap | Active priorities, slice build guidance, risk register, gates; no delivery claim. |
| [delivery-log.md](delivery-log.md) | Kore delivery log | Historical shipped-work record moved out of the roadmap; reports, not certifications. |
| [kore-target-architecture.md](kore-target-architecture.md) | Kore: Personal OS target architecture | Canonical next-wave architecture and source-verified gaps. |
| [plans/25-personal-os.md](plans/25-personal-os.md) | Plan 25 — Kore Personal OS | Complete catalog: I01–I29, S1–S5, B01–B09, acceptance and traceability. |
| [plans/26-account-safe-read.md](plans/26-account-safe-read.md) | Plan 26 — Account-safe read (Slice S1) | Bounded implementation plan for S1 (I01–I05, minimal I08, Gmail I09, setup I10); planned, nothing implemented. |
| [decisions/0006-personal-os-boundaries.md](decisions/0006-personal-os-boundaries.md) | TDR 0006 — Kore Personal OS boundaries | Accepted target boundaries D01–D10; implementation decisions remain open. |
| [kore-architecture-source.md](kore-architecture-source.md) | Source: Lore product and technical architecture specification | Verbatim supplied input, 138 sections; reference, not implementation evidence. |
| [planning-index.md](planning-index.md) | Kore planning inventory | This inventory and document precedence. |

### Numbered implementation plans and conventions

| File | Title / purpose | Planning role / status |
|---|---|---|
| [plans/00-overview.md](plans/00-overview.md) | Reflect V2 — First-Version Implementation Roadmap | Historical wave overview; dated status labels are not current audit results. |
| [plans/01-foundation-and-toolchain.md](plans/01-foundation-and-toolchain.md) | Plan 01 — Foundation & Toolchain | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/02-graph-and-file-storage.md](plans/02-graph-and-file-storage.md) | Plan 02 — Graph & File Storage | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/03-markdown-document-model.md](plans/03-markdown-document-model.md) | Plan 03 — Markdown Document Model | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/04-local-index-sqlite.md](plans/04-local-index-sqlite.md) | Plan 04 — Local Index (SQLite) | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/05-markdown-editor.md](plans/05-markdown-editor.md) | Plan 05 — Markdown Editor (meowdown) | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/06-daily-notes-and-routing.md](plans/06-daily-notes-and-routing.md) | Plan 06 — Daily Notes & Routing | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/07-backlinks.md](plans/07-backlinks.md) | Plan 07 — Backlinks | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/08-lexical-search-and-command-palette.md](plans/08-lexical-search-and-command-palette.md) | Plan 08 — Lexical Search & Command Palette | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/09-semantic-search-and-embeddings.md](plans/09-semantic-search-and-embeddings.md) | Plan 09 — Semantic Search & Local Embeddings | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/10-ai-copilot-sidebar.md](plans/10-ai-copilot-sidebar.md) | Plan 10 — AI Copilot Sidebar | First-wave read-only contract; later fork edit mode exists; I07/I11/I13 extend it. |
| [plans/11-link-capture.md](plans/11-link-capture.md) | Plan 11 — Link Capture | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/12-backup-and-sync.md](plans/12-backup-and-sync.md) | Plan 12 — Backup & Sync (Git, GitHub-first) | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/13-import-export-portability.md](plans/13-import-export-portability.md) | Plan 13 — Import / Export / Portability | Historical closed scope; do not infer current feature absence from closure. |
| [plans/14-cli-read-discovery.md](plans/14-cli-read-discovery.md) | Plan 14 — CLI (Read / Discovery) | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/15-hardening-packaging-release.md](plans/15-hardening-packaging-release.md) | Plan 15 — Hardening, Packaging & Open-Source Release | Existing implementation/reference plan; verify source and residual acceptance before work. |
| [plans/16-generic-git-remotes.md](plans/16-generic-git-remotes.md) | Plan 16 — Generic Git Remotes (Bring Your Own Host) | SSH/path baseline; HTTPS credential-helper follow-up B08. |
| [plans/17-readable-filenames.md](plans/17-readable-filenames.md) | Plan 17 — Readable filenames | Existing ULID/file identity baseline; I06 extends it. |
| [plans/18-tasks.md](plans/18-tasks.md) | Plan 18 — Tasks (post-release add-on) | Historical add-on plan; roadmap records later tasks/recurrence/reminders. |
| [plans/19-mobile.md](plans/19-mobile.md) | Plan 19 — Mobile companion (iOS first, Android next) | Mobile baseline and residual device work; I22 adds runner control. |
| [plans/20-asset-descriptions.md](plans/20-asset-descriptions.md) | Plan 20 — Asset Descriptions | Document reports implemented on 2026-06-16; not rerun here. |
| [plans/21-icloud-drive-sync.md](plans/21-icloud-drive-sync.md) | Plan 21 — iCloud Drive Sync (macOS + iOS) | Documented iCloud baseline; I23 governs new runtime-state separation. |
| [plans/22-mobile-github-connect.md](plans/22-mobile-github-connect.md) | Plan 22 — Mobile GitHub Connect (iOS) | Document reports implemented with device validation outstanding. |
| [plans/23-mobile-ai-chat.md](plans/23-mobile-ai-chat.md) | Plan 23 — Mobile AI Chat (iOS) | Document reports implemented/simulator checks; real-key device pass remains. |
| [plans/24-quick-note-intent.md](plans/24-quick-note-intent.md) | Plan 24 — Quick Note Intent (Siri / Shortcuts / Action button) | Document reports simulator pass; physical Siri/Action-button checks remain. |
| [plans/architecture-conventions.md](plans/architecture-conventions.md) | Architecture & Conventions | Existing conventions; native runtime target supersedes blanket TS-only policy ownership. |
| [plans/libraries.md](plans/libraries.md) | Libraries & Dependencies | Historical dependency choices; confirm installed versions before implementation. |

### Earlier architecture decisions

| File | Title / purpose | Planning role / status |
|---|---|---|
| [decisions/0001-raw-sql-writes-over-ipc.md](decisions/0001-raw-sql-writes-over-ipc.md) | TDR 0001 — Raw SQL writes over the Rust IPC bridge | Existing decision record; unchanged except explicit target supersession. |
| [decisions/0002-index-bridge-followups.md](decisions/0002-index-bridge-followups.md) | 0002 — Index/IPC bridge follow-ups | Index/IPC follow-ups; inspect current source before scheduling. |
| [decisions/0003-mobile-shell.md](decisions/0003-mobile-shell.md) | TDR 0003 — Mobile app shell: Tauri 2 mobile | Existing decision record; unchanged except explicit target supersession. |
| [decisions/0004-all-notes-trash-and-tag-scope.md](decisions/0004-all-notes-trash-and-tag-scope.md) | TDR 0004 — All Notes: OS-native trash, no in-app trash view or tag manager | Existing decision record; unchanged except explicit target supersession. |
| [decisions/0005-tag-types-and-collections.md](decisions/0005-tag-types-and-collections.md) | TDR 0005 — Tag types and collections: a tag may own a schema | Current Collection ownership contract; I14/I15 extend it without a second data model. |

### Product vision and upstream grounding

| File | Title / purpose | Planning role / status |
|---|---|---|
| [reflect-v1-all-notes.md](reflect-v1-all-notes.md) | Reflect V1: "All Notes" Behavior | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v1-backlink-menu.md](reflect-v1-backlink-menu.md) | Reflect V1: Backlink Menu & Date Generator | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v1-mobile-audio-memos.md](reflect-v1-mobile-audio-memos.md) | Reflect V1 Mobile: Audio Memos Grounding Brief | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v1-mobile-overview.md](reflect-v1-mobile-overview.md) | Reflect V1 Mobile Overview | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v1-overview.md](reflect-v1-overview.md) | Reflect V1 Overview | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v2-grounding-brief.md](reflect-v2-grounding-brief.md) | Reflect V2 Grounding Brief | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v2-indexing-strategy.md](reflect-v2-indexing-strategy.md) | Reflect V2 Indexing Strategy | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v2-mobile-grounding-brief.md](reflect-v2-mobile-grounding-brief.md) | Reflect V2 Mobile Grounding Brief | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v2-product-vision.md](reflect-v2-product-vision.md) | Reflect V2 Product Vision | Historical product/grounding reference; not a current implementation checklist. |
| [reflect-v2-sync-strategy.md](reflect-v2-sync-strategy.md) | Reflect V2 Sync Strategy | Historical product/grounding reference; not a current implementation checklist. |

### Desktop feature porting plans

| File | Title / purpose | Planning role / status |
|---|---|---|
| [porting/README.md](porting/README.md) | Porting Reflect v1 features to Reflect v2 | Porting reference/checklist; original exclusions and status are dated. |
| [porting/ai-menu-and-prompts.md](porting/ai-menu-and-prompts.md) | Porting the AI menu and prompts | Porting reference/checklist; original exclusions and status are dated. |
| [porting/assets.md](porting/assets.md) | Porting assets (images and file attachments) | Porting reference/checklist; original exclusions and status are dated. |
| [porting/audio-memos.md](porting/audio-memos.md) | Porting audio memos | Porting reference/checklist; original exclusions and status are dated. |
| [porting/backlink-hover-previews.md](porting/backlink-hover-previews.md) | Porting backlink hover previews | Porting reference/checklist; original exclusions and status are dated. |
| [porting/calendar-meetings-integration.md](porting/calendar-meetings-integration.md) | Porting calendar / meetings integration | Porting reference/checklist; original exclusions and status are dated. |
| [porting/contacts-integration.md](porting/contacts-integration.md) | Porting contacts integration | Porting reference/checklist; original exclusions and status are dated. |
| [porting/deep-links.md](porting/deep-links.md) | Porting deep links | Porting reference/checklist; original exclusions and status are dated. |
| [porting/editor-keyboard-shortcuts.md](porting/editor-keyboard-shortcuts.md) | Porting editor keyboard shortcuts | Porting reference/checklist; original exclusions and status are dated. |
| [porting/note-aliases.md](porting/note-aliases.md) | Porting note aliases | Porting reference/checklist; original exclusions and status are dated. |
| [porting/note-templates.md](porting/note-templates.md) | Porting note templates | Porting reference/checklist; original exclusions and status are dated. |

### Mobile feature porting plans

| File | Title / purpose | Planning role / status |
|---|---|---|
| [porting/reflect-mobile/README.md](porting/reflect-mobile/README.md) | Porting Reflect V1 Mobile features to Reflect v2 mobile | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/app-shell-and-navigation.md](porting/reflect-mobile/app-shell-and-navigation.md) | Porting the app shell and navigation | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/assets-and-images.md](porting/reflect-mobile/assets-and-images.md) | Porting assets and images | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/audio-memos.md](porting/reflect-mobile/audio-memos.md) | Porting audio memos (mobile) | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/auth-encryption-and-accounts.md](porting/reflect-mobile/auth-encryption-and-accounts.md) | Porting auth, encryption, and accounts | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/daily-notes.md](porting/reflect-mobile/daily-notes.md) | Porting daily notes | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/editor-and-keyboard.md](porting/reflect-mobile/editor-and-keyboard.md) | Porting the editor and keyboard experience | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/native-entry-points.md](porting/reflect-mobile/native-entry-points.md) | Porting native entry points | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/note-actions-sharing-and-export.md](porting/reflect-mobile/note-actions-sharing-and-export.md) | Porting note actions, sharing, and export | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/search-and-all-notes.md](porting/reflect-mobile/search-and-all-notes.md) | Porting search and All Notes | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/share-extension.md](porting/reflect-mobile/share-extension.md) | Porting the share extension | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/sync-offline-and-data.md](porting/reflect-mobile/sync-offline-and-data.md) | Porting sync, offline, and the data layer | Mobile porting reference/checklist; validate against current Tauri client. |
| [porting/reflect-mobile/tasks.md](porting/reflect-mobile/tasks.md) | Porting the Tasks tab | Mobile porting reference/checklist; validate against current Tauri client. |

### Historical security work

| File | Title / purpose | Planning role / status |
|---|---|---|
| [security-pass/final-report.md](security-pass/final-report.md) | Security Pass – Final Report | Historical 2026-06 security pass; not certification for I29/new runtime. |
| [security-pass/findings.md](security-pass/findings.md) | Security Pass – Findings | Historical 2026-06 security pass; not certification for I29/new runtime. |
| [security-pass/plan.md](security-pass/plan.md) | Security Pass – Plan | Historical 2026-06 security pass; not certification for I29/new runtime. |
| [security-pass/status.md](security-pass/status.md) | Security Pass – Status | Historical 2026-06 security pass; not certification for I29/new runtime. |

### Contributor guidance

| File | Title / purpose | Planning role / status |
|---|---|---|
| [contributing/adding-a-command.md](contributing/adding-a-command.md) | Adding a native command | Implementation/verification guidance, not a separate product backlog. |
| [contributing/adding-a-setting.md](contributing/adding-a-setting.md) | Adding a user setting | Implementation/verification guidance, not a separate product backlog. |
| [contributing/editor-architecture.md](contributing/editor-architecture.md) | Editor architecture | Implementation/verification guidance, not a separate product backlog. |
| [contributing/mobile-simulator.md](contributing/mobile-simulator.md) | Running the iOS simulator | Implementation/verification guidance, not a separate product backlog. |
| [contributing/testing.md](contributing/testing.md) | Testing | Implementation/verification guidance, not a separate product backlog. |

### Operational and implementation references

| File | Title / purpose | Planning role / status |
|---|---|---|
| [cli.md](cli.md) | The `reflect` CLI | Current reference/runbook; check source/environment before executing. |
| [deep-links.md](deep-links.md) | Deep links | Current reference/runbook; check source/environment before executing. |
| [generic-git-remotes.md](generic-git-remotes.md) | Back up to any git host (SSH) | Current reference/runbook; check source/environment before executing. |
| [icloud-sync.md](icloud-sync.md) | iCloud Drive Sync | Current reference/runbook; check source/environment before executing. |
| [ios-testflight.md](ios-testflight.md) | iOS TestFlight Builds | Current reference/runbook; check source/environment before executing. |
| [kore-apple-signing.md](kore-apple-signing.md) | Kore: Apple identity & signing checklist | Current reference/runbook; check source/environment before executing. |
| [macos-distribution.md](macos-distribution.md) | macOS Distribution Builds | Current reference/runbook; check source/environment before executing. |
| [multi-window.md](multi-window.md) | Multiple windows & cross-window communication | Current reference/runbook; check source/environment before executing. |
| [privacy.md](privacy.md) | What leaves the device, and when | Current reference/runbook; check source/environment before executing. |
| [readable-filenames.md](readable-filenames.md) | Readable filenames & note identity | Current reference/runbook; check source/environment before executing. |
| [upstream-merges.md](upstream-merges.md) | Pulling upstream reflect-open changes into Lore | Current reference/runbook; check source/environment before executing. |

## Other entry points, not additional roadmaps

| Document | Role |
|---|---|
| [README](../README.md) | Current product presentation and planning entry links |
| [AGENTS](../AGENTS.md) / [CLAUDE](../CLAUDE.md) | Repository operating instructions; no changes made by this update |
| [CONTRIBUTING](../CONTRIBUTING.md) | Contribution/review workflow |
| [Design system](../design-system/readme.md) | UI tokens and guidance; upstream marketing is not Kore's feature contract |
| [Desktop README](../apps/desktop/README.md) | App development reference |
| [Core README](../packages/core/README.md) | Existing shared logic boundary |
| [Index schema README](../crates/index-schema/README.md) | Shared persistence/index schema reference |
| [CLI README](../apps/cli/README.md) | Existing CLI package reference |
| [Extension README](../apps/extension/README.md) | Capture extension reference |
| [Native host README](../apps/native-host/README.md) | Capture sidecar reference |

## Where to update planning next

- Change order or gate status in the roadmap, and detailed scope/evidence in Plan 25.
- Record boundary decisions in `docs/decisions/`; do not silently reinterpret old TDRs.
- Keep the original supplied specification intact; add operational clarifications to
  the maintained target/plan instead of editing the quoted source.
- Link any new bounded implementation plan here and back to its Ixx initiative.
- Move an initiative to completed only with source revision, relevant tests,
  runtime/platform evidence and remaining release/device blockers.
- Keep B01–B09 residual work visible; do not erase it when reprioritizing the program.
