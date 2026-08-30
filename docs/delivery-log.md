# Kore delivery log

**Scope:** Historical record of work shipped by this fork, preserved verbatim from
the previous roadmap. Entries record prior work, not a fresh source/runtime/release
certification; terminology and implementation descriptions can differ from current
code. New target work belongs in the [roadmap](roadmap.md), not here.

## Shipped (this fork)

- A task belongs to the project it links. Tasks used to belong only to
  the note they were written in, so "all tasks of project X" had no
  answer once tasks scattered across daily notes. Now a task's own line
  wiki-linking a note makes it that note's task, and every regular
  note's context rail carries a Tasks panel: the note's own open
  checkboxes first, then every open task anywhere that links it — each
  naming its source note (click jumps there), each completable in place
  through the same commit the Tasks view uses. Membership is computed
  from the existing tasks and backlinks projections (link-to-line
  containment over the parser's shared UTF-16 offsets; a calendar
  `[[YYYY-MM-DD]]` link stays a due date, never a reference), so no
  schema or Rust changed. With the tag page and collections this closes
  the project loop: `#project` board for the portfolio, the project's
  note for its tasks, capture anywhere in between. The companion product
  principle is recorded in the roadmap: no default routines ship, ever —
  automations are user-created, recommended at most.

- The tag schema dialog teaches what it builds. Configuring a supertag
  used to mean raw plumbing: an always-on frontmatter-key input, options
  as comma-separated text, a flat 14-entry type list, and no hint that a
  Select powers the kanban. Now a live views strip under the property
  list shows which collection views the draft unlocks — lit pills name
  the property powering Board or Calendar, dark ones say exactly what to
  add — reading availability from the same predicates the board and
  calendar themselves use, so the hint cannot drift. An empty schema
  offers one-click starter presets (Task board, Reading list, People)
  that seed editable rows without saving anything. Options became
  removable chips in their real collection colors with an inline add
  field; the frontmatter key folded behind a small mono chip that
  auto-derives from the name (an invalid or duplicate key pops its
  editor open); every property type carries a glyph; a freshly added row
  focuses its name. The save, rename-migration and conversion flows are
  untouched.

- A tag is a page, not a filter state. Opening a tag — from the sidebar, the
  All Notes pills, or the Custom menu — now lands on that tag's own page on
  the same route: the tag is the title (with an "All notes" breadcrumb back),
  the filter pills stay behind on the unfiltered view, the workspace tab
  renames to `#tag`, and the sidebar highlights the tag's row instead of All
  notes. A typed tag carries its schema gear beside the title — the
  collection entry point that used to hide behind the sidebar's hover gear —
  and an untyped tag offers a "Create a collection" call-to-action opening
  the same schema dialog (TDR 0005). All Notes itself is unchanged, as are
  every collection view, persisted preference, and the selection/trash
  machinery, which all key off the route that did not move.

- Agent memory the agent actually uses (v0.38.0). Chat recall: at send time
  the message's significant terms (bilingual stopwords; mentions, URLs and
  code stripped) drive one OR-composed FTS query over the index, and the
  top three passages ride the model-bound message with path, title and
  date, fenced as vault data beside the mention block. Private notes are
  excluded in the SQL itself — `search_fts` indexes them, so the palette's
  local search still finds them while recall never surfaces one — and any
  failure degrades to no recall, never a blocked send. User-taught skills:
  one markdown file per skill under `agents/skills/` (frontmatter
  description, H1 name, steps); prompts carry only the catalog and the
  agent reads a skill on match; `private: true` hides one, and new or
  changed skills route through the existing pending-approval queue, so no
  durable instruction lands without review.

- A minimal durable runtime under agent runs (v0.39.0, TDR 0007). One
  process-wide FIFO run lock in Rust — chat edit turns and routines now
  serialize across every window, so activity ledgers can no longer
  cross-attribute; leases die with their webview and each fresh JS context
  sweeps its own window's. One durable in-flight marker (atomic single
  slot under the app data dir — the lock makes one slot correct): a run
  the process was killed under resurfaces on the next launch as an
  "interrupted" history entry with the normal backoff, instead of
  vanishing. The running routine shows in the Agents screen with a Stop
  that reaches the native process-tree kill (a user stop records history
  without a failure strike), and a native minute tick keeps schedules
  firing when a hidden window's JS timers throttle under App Nap.
  Deliberately out, per the R4 bound: job tables, a durable event-run
  queue, execution with no webview, approval checkpoints.

- The backlog-B polish pass (v0.39.0 and the commits after it), closing
  the follow-ups earlier entries left open. Tabs: drag to reorder along
  the strip (clicks, double-click pin and middle-click close intact), and
  a list-all-tabs menu — every open tab by full title, the active one
  checked — as the overflow affordance. Browser: Clip to note, spooling
  the same link-capture envelope the Chrome extension produces (new
  `in-app-browser` source), so a clip rides the whole existing pipeline —
  drain, dedup, daily-note placement, enrichment; the address bar,
  back/forward and reload had already shipped. Graph: nodes colored by
  their first tag (stable hue over the theme-safe palette), a header
  search that lights matches up in place without rebuilding the layout,
  and the local view — ⌥-click a node to focus its two-hop neighborhood,
  with a "focused on … · Show all" chip; plain click still opens the note.
  Preview-tab semantics remain open, gated on a product decision.

- One release channel, and tagging that belongs to one workflow. Two
  release-please components tracked the same master branch, so the beta and
  stable Release PRs listed the same commits and neither published anything.
  Both also created their GitHub releases as drafts and handed the tag to the
  notarized `release.yml` this fork does not run, leaving nine untagged,
  asset-less draft releases behind. That is a live hazard rather than clutter:
  the in-app updater reads `releases/latest`. The beta component is gone and
  the survivor carries `skip-github-release`, so tagging and publishing belong
  solely to `release-dmg.yml`, whose `tauri-action` creates the tag and uploads
  the DMG, the updater artifacts and `latest.json` in one shot. Merging the
  Release PR is now the bump; the hand-bump remains the no-Release-PR fallback.
  `manifest.stable.json` and the changelog were realigned to the versions
  actually live, and a test now fails the build when the manifest falls behind
  `package.json`.

- The right rail opens on Details. The switcher shipped all five panels as
  permanent segments, but Details is the only one tied to what the route is
  already showing, so it is now the whole band by default and Chat, Calendar,
  Browser and Terminal move behind a "+" beside it. Picking one from the "+"
  opens it and gives it a segment so the switcher can return to it; unticking
  it takes the segment away again, falling back to Details when that was the
  panel on screen. The open set is per-window session state, like the panel
  choice it joins.

- The title-bar band, split in two. All five controls sat in one left cluster,
  which put the search lens and the mic hard against the surface pills. The band
  is now two window-drag control groups: pills hold the left edge, lens and mic
  hold the right, and the gap between them still drags the window.

- Voice-note transcription model on iPhone. Mobile settings carried the
  auto-format toggle but not the model behind it, so a memo recorded on the
  phone was stuck on the built-in default while the desktop could choose.
  Shipped alongside a test-suite repair worth its own line: three
  `vi.mock(...)` factories resolved to a different module id than the component
  imported, so they never intercepted and the tests drove the real components.
  The tasks screen was failing 26 of 66 locally while CI passed them; the
  integrations pair asserted text the real field also renders, so it passed on
  the component it believed it had replaced. The browser suite now runs green
  locally end to end: 217 files, 1,797 tests.

- Mobile, free. The paid-access gate and the upstream product integrations are
  gone from the iOS app, which also gains floating navigation capsules and
  shared note capture.

- Six settings and surfaces that did not do what they said. The right rail now
  mirrors the content column (a 44px switcher band over a floating card, sunken
  off the window edges like the note pane), and its left gutter doubles as the
  resize divider's lane: the embedded browser's native child webview covers the
  card, so a divider sharing those pixels was unreachable whenever the Browser
  panel was up. Tags leave the rail for the left sidebar, the rail's Chat panel
  stops stealing focus from the note you were editing, and the search-engine
  setting finally reaches the blank tab (the in-app browser's home page was a
  hardcoded DuckDuckGo URL, so picking Google changed only the address bar).

- The ONNX thread pool, when it never takes effect. ONNX Runtime keeps only the
  first configuration a process offers it and reports `false` from `commit` for
  every later one. `commit_environment` read that as cosmetic and returned `Ok`
  either way, so a first commit lost to an environment configured elsewhere left
  inference on fastembed's defaults, every core spinning, behind a runtime that
  looked configured and was not. That also made `embed_bench`'s
  `.expect("production ONNX thread pool")` inert: from the second benchmark in a
  process the pool was silently the default while the numbers were read as
  production's. The outcome is now computed once and shared.

- Native embedding memory, bounded and measured. Four texts per native request
  and library call, a 128 KiB admission limit, eight admitted requests and FIFO
  execution; chunking bounds unbroken text at 1,500 UTF-16 units without
  dropping content or splitting surrogate pairs; idle release protects active
  model references and publishes before a new load can race the old watchdog.
  The paired 32-text experiment cut native peak footprint by 81.9% with no
  throughput regression in that sample. Native footprint and lifetime peak are
  now reported separately from RSS. Boundaries and reproduction commands live in
  [memory budgets](memory-budget.md); the incident itself is in the
  [performance audit](performance-audit-2026-08-27.md). These are native
  benchmark figures, not a certification of the app-wide budgets.

- The embedding backfill that drove the machine into swap. Backfill fed every
  pending note to the embedder in one call; with BatchLongest padding and 29 KB
  chunk outliers that pushed ONNX Runtime's arena past 30 GB. The runtime batch
  is now capped at a fixed size in `embed.rs` (mirrored as a shared constant for
  the TypeScript side), chunk length is hard-capped so one outlier cannot
  inflate a batch, and note embedding is batched in the pipeline with a
  cancellation check between batches, wired through to the live embeddings UI.
  The app icon was replaced in the same round: the supplied white-on-transparent
  Kore mark now sits on a near-black squircle following the macOS icon grid,
  regenerated for every target from a 1024 master.

- One icon set. The app drew from three families at once — `lucide-react`
  across the product chrome, ten SVGs traced from V1 (a *filled* pin sitting
  next to hairline strokes), and a hand-drawn SF-Symbols-alike set at stroke
  1.7 for the nav rail, which put two different document glyphs on screen at
  the same time. All three are gone, replaced by
  [Solar](https://www.figma.com/community/file/1166831539721848736)'s
  `-linear` family: one 24×24 grid, a 1.5px stroke, rounded terminals, in the
  register Linear and Craft use. The glyphs are baked into React components at
  author time (`scripts/generate-icons.mjs` → `components/icons/`), so the SVG
  paths land in review like any other source and the app ships no icon
  runtime; the dozen shapes Solar has no linear equivalent for — a bare
  checkmark, the `[[wiki link]]` brackets, the indent carets, the spinner —
  are hand-drawn to the same spec beside them. The nav and palette glyphs also
  lost the liquid-glass well they sat in — 80 lines of tint, sheen, and
  backdrop blur that framed every icon as a chip. What is left is a bare 24px
  slot that only aligns the labels and passes the row's color through, so the
  glyph reads as the mark rather than as something set into a button. One
  surface still holds out:
  `@meowdown/react` draws its own in-editor chrome (the drag grips, the code
  block's copy/edit actions, the link popover) with eight lucide glyphs of its
  own, so closing that last gap is a change in the Meowdown repo.

- Appearance, expanded. The theme picker gains two sober neutrals — Ash
  (white cards on a soft grey page, the Codex/Craft register) and Graphite
  (a flat neutral dark with no blue cast, where Cursor and Notion sit) —
  and the accent row doubles to sixteen presets around the wheel plus the
  custom color. Surfaces stay quiet on purpose: colour is the accent's job,
  which is why the new variants are greys rather than hues. Two new controls
  sit alongside them: **Corners** rescales the whole radius ramp (Sharp /
  Small / Default / Round) through one `data-radius` scope, and Liquid
  Glass gains a **Glass intensity** step (Subtle / Regular / Strong) that
  drives every blur and tint from variables instead of a second copy of
  the rules. All four settings apply pre-paint like the theme, and a token
  test now fails the build if an id ships without its CSS scope.

- The seven-item follow-up round: a right-click menu on notes (every entry
  already existed as a command — the gesture didn't); bulk tag and move over
  an All Notes selection, which could previously only be deleted; a heading
  outline in the context sidebar; `templates/daily.md` seeding new daily
  notes; **vault-wide find and replace**; and a density setting.

  Two of those are worth a line each. Find and replace has its matching layer
  written fresh rather than reusing the unlinked-mentions helpers: an
  adversarial review of that plan found 22 concrete corruption paths, most of
  them from promoting a first-match display helper into a whole-vault writer
  (case folding that isn't length-preserving, fences paired by character
  instead of run length, an H1 rewrite silently renaming the note). Density is
  deliberately a handful of named metrics rather than a global spacing scale —
  the app styles with Tailwind utilities and never reads the `--space-*`
  tokens, and rescaling Tailwind's base unit would desync the list
  virtualizers, whose row heights are numbers in JS.

- Depth pass, Craft-inspired. Every elevation tier is now two or three
  stacked shadows (a tight contact shadow under a wide ambient one) instead
  of one big blur, and in the dark family they carry a hairline of light
  along the top edge — on a near-black background a shadow alone cannot
  separate a surface. Floating layers (menus, selects, dialogs, the command
  palette) are translucent over a real backdrop blur in every theme, not
  only under Liquid Glass, and the palette overlay dims *and* blurs like the
  dialog one. Lucide icons default to a 1.75 stroke app-wide via
  `LucideProvider`, matching the house glyph set instead of lucide's heavier
  2px. Fixed along the way: `spacing.css` is imported after `colors.css` and
  its `:root` elevation tokens tie with `.dark` on specificity, so the
  per-theme shadow recipes had never actually rendered; colors.css now owns
  the ladder alone and a token test keeps it that way.

- Recurring-task respawn from the editor checkbox: completing a `@repeat`
  task by clicking its checkbox inside the note editor now appends the next
  occurrence, matching Tasks-view completions. Meowdown still has no
  editor-side task-toggle callback; the session diffs the pre/post buffers
  for a checkbox-only completion and appends through the live buffer.

- Steering a turn in flight. ⌘-Enter in the composer delivers a message
  into the *running* session instead of cancelling it. Claude Code runs
  with `--input-format stream-json` and a held-open stdin (each inject is
  the next user turn); Codex runs `app-server` and `turn/steer` (same-turn
  inject on the in-flight turn). The transcript shows the steer where the
  reply splits around it. Steerability is a per-engine capability
  (`cliProviderSteerMode`) — Cursor is still one-shot, so ⌘-Enter there
  degrades to the message queue, as it does when a run settles between
  the keypress and the write.

- Script-mode routines (the silent tick). An automation can carry an
  optional gate script that runs deterministically in the vault folder at
  each occurrence, before any model wakes: exit 0 with no output (or
  `{"wakeAgent": false}`) records a *skipped* tick in the run history and
  costs zero tokens; output wakes the agent with that output attached as
  data; a failing or timed-out script counts as a failed run and feeds the
  retry/backoff/pause machinery. The script runs through a new Rust
  command with a 30s timeout, capped output, and a process-group kill so
  a stalled script's children die with it.

- Progressive-disclosure memory. The soul still rides whole, but a memory
  file that outgrows its (now smaller) budget injects a deterministic
  skeleton — headings, first line of each section, elision counts — with a
  pointer to read the file on demand, and the journal keeps whole newest
  entries. The memory block stays near bb's ~4k characters however much
  the vault knows. Alongside it, the memory-write scanner: staged
  proposals get flagged inline in the approval UI, and every edit-mode run
  (chat and routines) scans what actually landed in memory files for
  planted instructions and secrets — a review pointer for the user, never
  a silent rewrite.

- Notes as live cards + @-mentions. The assistant can put
  `::note{path="…"}` on a line of its own and the chat promotes it to a
  card (live title over path) that opens the note — the transcript keeps
  plain markdown, only the renderer promotes it, and unsafe paths never
  become clickable. In the other direction, typing `@` in the composer
  suggests notes (private notes never appear); picking one inserts
  `[[Title]]`, and the send resolves every mentioned note to its *current*
  content, riding the model-bound message in a fenced `<mentioned-note>`
  block. Private notes contribute only their refusal — same hard block as
  read_notes — and all four engine prompts teach both conventions.

- Chat message queue: sending while a turn is still streaming no longer
  drops the message — it parks as a card above the composer and rides
  automatically when the turn settles. Stopping a turn holds the queue
  instead (each card can then be sent or discarded by hand), and New chat
  or switching conversations clears it. Desktop composer only for now —
  the mobile composer's send button doubles as Stop while streaming.

- Routines that stop failing forever: a failed automation retries with
  backoff (30s, then 60s) and pauses itself after three consecutive
  failures instead of erroring on every schedule tick. The pause shows in
  Agents → Automations ("paused after repeated failures") and flipping the
  switch back on resets the counter and re-arms the schedule.

- Mobile All-notes grid: the same persisted `allNotesView` preference as
  desktop switches the All tab between the swipeable row list and a
  two-column masonry of preview cards. Search, filters, and highlights
  apply to both layouts; pin and delete stay with the list.

- Global quick capture: a system-wide shortcut (Shift+Space with ⌘ or Ctrl)
  raises a frameless bar that appends a line to today's daily note through
  the same capture inbox as share-sheet and deep-link writes. An in-app
  command (⌘⇧C) opens the same bar; Settings → Editor turns the global
  binding off if it collides with another app.

- Grok and Cursor as providers. Grok is a first-class brand card riding the
  xAI API (OpenAI-compatible, endpoint pre-filled, key in the OS keychain,
  models by id) — the community Grok CLI was deliberately rejected: it
  auto-approves an unsandboxed shell in headless mode, which the vault's
  privacy rules cannot fence. Cursor joins as a true subscription CLI
  (`cursor-agent`, signed in with the user's Cursor plan, model picked in
  chat): read-only by design — it grounds answers in the vault while a
  workspace `.cursor/cli.json` written fresh each run denies Shell, network,
  writes, Grep, MCP, and every private note, `--mode ask` keeps Cursor's own
  read-only posture, and `--force` (which headless writes require) is never
  passed. Edit mode and automations stay with Claude Code and Codex until
  Cursor's write path is verified against the real CLI.

- Task reminders: once a day, a native notification summarizes the open
  tasks due today and the overdue ones (task due dates are date-only, so
  the reminder fires on the first check of the day the app is awake for —
  launch included). A switch in Settings → Notes → Tasks turns it on and
  asks the OS for notification permission; the sent-day marker is kept per
  graph so a re-render or graph switch can't double-send or suppress one.

- Routine run history: every automation keeps a capped log of its past
  runs — when each started, whether it succeeded, the failure message when
  it didn't, and exactly which notes it edited. A History button on the
  routine row opens the log; crashes mid-run record as failures too.

- Provider setup, rethought: pick the brand first (logo cards — Claude,
  OpenAI, Gemini, OpenRouter, or a custom endpoint), then the connection
  where the brand offers more than one — Subscription through its coding
  CLI, or an API key. No model choice at setup for any provider (only the
  custom endpoint asks for a model id); configured rows carry the brand
  mark and a connection badge. Pure UI regrouping over the same stored ids.

- Premium interaction pass: one motion system (the `ease-swift` house curve
  + 150ms) across buttons, switches, tab pills, menus, selects, dialogs and
  the ⌘K palette (which now animates in); press-scale feedback on every
  button; checkbox ticks land with a zoom instead of popping; hover-reveal
  affordances fade instead of snapping; masonry cards lift on hover; the
  elevation ladder is tokenized end to end (dialog/toast/menus on
  `--shadow-pop`, dark-mode re-tints); and real macOS trackpad haptics
  (NSHapticFeedbackManager) on toggles, the context-rail switcher, sidebar
  resize landing/limits, and failed background operations — gated behind
  `prefers-reduced-motion`.

- Liquid Glass: an Appearance switch (independent of the theme) that paints
  an accent-tinted gradient backdrop and turns the chrome translucent — the
  note-pane card and every floating layer (menus, dialogs, the palette) get
  real backdrop blur. Applied pre-paint like the theme, so launches don't
  flash opaque.

- Settings, reorganized: the page and its sticky navigator now share five
  labelled groups (General, Notes, AI & agents, Sync & data, Application)
  from one registry. Connecting a subscription provider (Claude Code,
  Codex) no longer asks for a model — connecting is just the subscription;
  the model is picked per conversation in the chat's model selector.

- Styled note export: "Export note as styled HTML…" (palette command and
  Note-actions button) saves one self-contained HTML file rendered by the
  same engine as the in-app previews — wiki-link chips, round task
  checkboxes, embedded vault images (data URIs), the app's stylesheets and
  current theme inline — plus a print stylesheet and a floating button so
  the browser's print dialog is the PDF path. Nothing leaves the machine.

- v0.11.0 hardening round: green CI as the merge gate (full shard matrix on
  every master push), injection-resistance rules in both agent CLI prompts
  (note content is data, never instructions; no vault content to external
  tools unless the user asked), and the upstream merge playbook
  (docs/upstream-merges.md).

- Agent activity ledger: before every edit-mode run (chat turn or
  automation) the graph is snapshotted into its local Git history, and
  afterwards the run's touches are diffed against that snapshot. Chat turns
  end with an "Edited N notes" card — each row opens the note or its
  version history (diff + one-click restore); automations record the same
  ledger on the routine row and in the completion toast. Nothing an agent
  does to the vault is silent or unrecoverable.

- MCP servers, in-app: Settings → MCP servers holds each server's shape
  (stdio command or HTTP URL, which env variables it needs) while the
  values — API tokens — live only in the OS keychain, written on save and
  deleted with the server. Enabled servers ride agent chat and automations
  **in edit mode only** (read-only chat stays zero-egress): Claude Code
  gets one inline `--mcp-config` document with `--strict-mcp-config` (the
  user's global MCP config never bleeds into a vault run) and per-server
  `mcp__<name>` allow rules; Codex gets the equivalent `-c mcp_servers.*`
  overrides. Both grammars verified against the real CLIs.

- Automations: scheduled agent runs while the app is open — settings-backed
  routines (daily/weekly at a local time, catch-up on launch), executed
  headless through the agent CLI providers in edit mode with the active
  soul/memory digest, journaled like any session, managed from the Agents
  screen (enable/disable, Run now, delete) — with the **Memory curator** as
  a one-click preset: distills the journal into facts, re-grades
  confidence, prunes the stale, and keeps memory under its caps. Plus a
  recall rule in every provider prompt: the digest is the hot set, the
  vault is the long-term memory — search it before "I don't know".

- Shared agent memory (Notion's Lore model, vault-native): `agents/memory/`
  holds `facts.md` — shared facts and decisions with confidence tags
  (`[certain|likely|speculative]`) and provenance signatures, updated in
  place — and `log.md`, the append-only session journal whose tail rides
  into every prompt. The wake-up digest now layers soul → user profile →
  shared facts → recent journal → own memory, each capped with explicit
  consolidation nudges. Optional **memory write approval**: agents stage
  changes to “About you” and shared facts as proposal sections in
  `pending.md`, and the Agents screen approves or discards each one
  deterministically (no model in the loop). All of it plain markdown in
  the vault — nothing leaves the app.
- Agents section (Hermes-agent model, vault-native): `agents/user.md` is
  the shared profile of the user; each agent lives at `agents/<slug>/` with
  a **soul.md** (identity and voice, the user's file, seeded on create,
  injected first into every session, optional `provider:`/`model:` pin in
  frontmatter) and a **memory.md** (the agent's own working memory). The
  Agents screen creates, activates, opens, and deletes profiles; the active
  agent shows as a chip in the chat composer; activating a profile with a
  pinned CLI provider also steers the chat model. Prompt injection is
  capped Hermes-style (soul 6k, user 2k, memory 4k chars) with explicit
  consolidation nudges, `private: true` silences any of the files, and the
  per-graph skill teaches external agents the same layout.
- Agentic chat: an **edit mode** toggle in the composer lets the agent-CLI
  providers (Claude Code / Codex) create and modify notes to carry out a
  request — Codex gets a write grant on the graph subtree, Claude Code gets
  Write/Edit tools — while private notes, `.reflect/`, and `.git/` stay
  fenced by sandbox rules that win over the grant, and Bash/network stay
  off. Both prompts carry a shared editing rulebook (conventions, tasks,
  frontmatter care). Plus **persistent agent memory**: `notes/agent-memory.md`
  ([[Agent Memory]]) is injected into every AI session (BYOK included),
  kept current by agents in edit mode, suggested-only in read mode, honored
  as unsendable when marked `private: true`, and taught to external agents
  through the per-graph skill.
- Per-note version history: a History section in the note and daily details
  rail over the graph's local Git backup — timeline of every commit that
  changed the note, full preview or per-save line diff, and one-click
  restore that snapshots the current state first (so a restore is itself
  just another version, never a loss).
- Kore's own Apple identity: bundle ids `app.lore.*` (desktop flavors, iOS,
  share/widget extensions), iCloud container `iCloud.app.lore` (shown as
  "Kore" in Files/Finder), App Groups `group.app.lore(.dev)`, product names
  Kore / Kore Beta / Kore Dev, StoreKit/IAP ids, updater endpoints pointed
  at this repo (safe-fail until own keys exist), keychain service `lore` —
  with a one-time signing checklist in docs/kore-apple-signing.md.
  Internal names (`reflect://`, the `reflect` CLI, `.reflect/`, the
  capture host) deliberately unchanged.
- Agent CLI, rounded out: `backlinks` (who links here, from the app's own
  resolution), `recent` (latest notes), `new` (create a note with the app's
  frozen filename-slug rules, H1, and optional template seeding with
  placeholders expanded), and `capture --to` (append to any note, not just
  today's daily) — all with the same privacy re-checks; writes stay
  structural and never overwrite.
- Agent surface, leveled up: the `reflect` CLI gains `tasks` (the graph's
  open tasks from the index, private notes filtered) and `capture` (the
  CLI's only write — an atomic, append-only list item or `+ [ ]` task into
  today's daily note, private dailies refused); the per-graph agent skill
  (Settings → Agents) now also teaches authoring conventions — layout,
  wiki links, task/priority/due-date syntax, frontmatter, templates — and
  the in-app chat prompts explain the task syntax to the AI.
- ChatGPT sign-in for the Codex provider, in-app: the add-provider dialog
  shows the CLI's auth status and runs the whole OAuth flow from a button
  (the CLI's localhost callback + the OS browser); sign-out included.
  Credentials stay with the CLI — the app never sees them.
- Attachment viewer, expanded: DOCX (converted locally, rendered fully
  sandboxed), CSV/TSV (as a table, delimiter-sniffed), and plain text
  (txt/md/log/json) join PDF and HTML.
- One link-routing rule everywhere: web links open the in-app browser from
  the editor and every static surface alike (Alt-click = OS browser).
- Graph view: the whole graph's notes and resolved wiki links as a
  force-directed map on a canvas (own deterministic layout, no viz
  dependency) — pan, cursor-anchored zoom, hover to spotlight a
  neighborhood, drag to rearrange, click to open. Node size follows
  inbound links; hubs and small graphs are labeled. Daily notes are
  hidden by default with a toggle. Sidebar row + palette command
  (`nav.graphMap`). Follow-ups: local view scoped to the open note,
  tag coloring, search-to-highlight.
- Template placeholders: template bodies expand `{{date}}` (user's date
  format), `{{date:iso}}`, `{{time}}`, and `{{title}}` (the target note's
  display title) at insertion, from both the picker and the `/` menu.
  (Templates themselves — `templates/` folder, picker, slash menu,
  create/rename — predate this fork's roadmap.)
- In-app browser: clicking a web link in a note opens the page in a
  separate Tauri webview window instead of leaving the app (⌘-click keeps
  the OS browser). The `browser-*` window label matches no capability and
  remote URLs never receive the invoke bridge, so pages get a plain webview
  with zero IPC exposure; the shell refuses every non-http(s) scheme.
  Follow-ups: URL bar + back/forward chrome, "clip to note".
- Right context rail: a full-height sidebar mirroring the left one, with
  icon-only panel tabs for Details (the route's contextual sidebar), Chat
  (the same session as the chat route), and Calendar (month + day events on
  any route). The note pane floats between the rails as a rounded card.
- Note tabs, two surfaces over one model: a strip above the note pane
  (Daily notes as the fixed tab zero, pinned tabs collapsed to an icon,
  close on hover/middle-click, double-click to pin) and an Open section
  in the sidebar. Persisted in settings and restored at launch;
  `⌃Tab`/`⌃⇧Tab` cycle, `⌘W` closes. Follow-ups: drag reorder,
  overflow menu, preview-tab semantics.
- In-app HTML & PDF attachment viewer: `assets/*.pdf` / `assets/*.html`
  open in a viewer dialog off the asset protocol (PDF via the webview's
  native renderer, HTML fully sandboxed — no scripts, no same-origin),
  with one-click "Open externally" as the fallback.
- Design language overhaul (Craft/Linear-style tokens: ink hairlines,
  charcoal dark, one shadow recipe per depth tier) with themes (Space,
  Midnight, Paper) and accent colors incl. custom.
- Unlinked mentions panel under Backlinks with one-click link conversion.
- All-notes masonry card view (list/grid toggle, persisted).
- Subscription AI providers via local CLIs (Claude Code, Codex) alongside
  BYOK, with per-note privacy enforced at the CLI sandbox level.
- Chat: export, save-reply-as-note, per-conversation instructions,
  summarize-note command.
- Tasks: persistent filters, priorities, recurring tasks.
- Sidebar tag browser, saved searches, Insights view, mobile parity pass.
