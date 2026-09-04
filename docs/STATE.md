# Kore working state

**Updated:** 2026-09-04 at `f0de5ec5`+ (collections daily loop: schema
edits and rows from the table, sort chains, any/all filters, side peek,
tag page description, daily line to note; TDR 0005 Amendments A and B).
**Rule:** Every session that moves the program updates this file before its
summary: tick what became true and how it was verified, set the next step,
refresh the date. What is done and what is next live here and only here. Why
things are built this way lives in [docs/decisions/](decisions/); what the
product is lives in the [roadmap](roadmap.md) (app-first) with the Personal OS
direction in [Plan 25](plans/25-personal-os.md). The full shipped history stays
in the [delivery log](delivery-log.md); this file tracks only the active work.

## Current focus

**Collections as databases (user decision 2026-08-31, [Plan 29](plans/29-collections-database.md)).**
Collections must behave like real databases — relating to one another, Notion
databases / Tana supertags as the reference. Slice R1 (typed relations)
shipped this session: a `relation`/`relations` property can declare a
`target: <tag>`; its picker then offers only that collection's rows through
`suggestRelationTargets` (the same verified `[[` addresses, scoped through the
`tags` projection) plus a "Create in #target" entry that births a titled row
carrying the tag and links it in one gesture (verified: schema round-trip +
scoped-suggester flow tests, dialog save test, and a hand-driven dev-app run —
typing #person/#book, pointing Company at a target, creating a row from the
picker). The save path bug this found — `frontmatterPatchToYaml` spelling the
schema block key-by-key and dropping the new field — is fixed and pinned by a
serializer test. N1 followed in the same session: a note carrying a typed
tag presents its fields above the body (`NotePropertiesHeader`, sharing the
rail section's hook and field face — one write channel, three surfaces),
skipped on daily notes; verified by component tests and a dev-app run
editing a field in place. R2 and R3 landed next, same session: a `reverse`
property type ("rows of #tag whose property links here") computed view-only
by `attachReverseRelations` from the existing projections — absent when
nothing links, so footers count honestly — with its Of/Via config in the
schema dialog (verified: unit tests plus a dev-app run where #book grew a
People column listing the #person rows whose `company` links each book);
and rollups gained sum/average/min/max over numeric sources (unit-tested;
the dialog's aggregation picker lists them from the schema enum). M1 was then decided by the
user (2026-08-31): **the hashtag is the supertag** — writing `#tag`
anywhere, a daily included, deliberately makes the note an instance, so
membership stays as derived and no row/mention split is built. V1a shipped
after it: the ` ```collection ` fence gained `sort:` and `filter:` lines
(the filter menu's vocabulary, tolerant parse, serializer round-trip,
applied through the same `applyCollectionFilters` as the tag page —
verified by core round-trip tests, a widget component test, and a dev-app
slash-insert). The same session also landed the tag-page cleanup
(breadcrumb title, one table per typed tag, delineated grid cards),
pasted-link preview cards, readable scrolling tabs, and the dialog-width
root fix; all of it shipped as v0.44.0. V1b and T1 followed (2026-09-01):
the table gained a per-tag "Group by" whose shelves are the board's own
lanes minus rank-sort and empty lanes (`tableGroupRows`; saved views
snapshot the nullable `tableGroup`; selection order and shelves computed
once in the screen), and four property types landed with vault-honest
semantics — `created` as a frontmatter stamp written only when Kore births
the row (filesystem birthtime lies under git/iCloud sync; imports and
hand-tagged notes keep their own history), `updated` as a pure view over
the indexed mtime (`attachTimestampColumns` + the `$updated` sort
sentinel via `effectiveCollectionSort`), `person` as a relation scoped to
`#person` (`relationTargetOf`, create-from-picker, initials disc, board
lanes), `phone` as tel-input text (verified: core stamp/attach/sort units,
schema round-trip, settings tolerance for pre-V1b saved views, browser
tests for the grouped table, person picker, read-only stamp editors, CSV
import skipping view-only columns — plus `pnpm check` and the full suites).
The queue then emptied in the same session: **V2a** — the board lanes by
`multiselect` too (a card in every lane its list carries; a drop gains the
target option and sheds the lane it left, so a two-lane card moved out of
one honestly stays in the other; board-only, since duplicate rows have no
place in the table's flat selection order), **V2b** — the fence gained
`group: <key>` (tolerant parse, serializer round-trip, applied through the
same `tableGroupRows` as the tag page), and **T2** — `formula` columns per
I15: a small pure evaluator (`evaluateFormula`: literals, `prop("key")`,
arithmetic, comparisons, boolean logic, `if`/`concat`/`round`/`abs`/
`min`/`max`/`length`/`empty`/`format`) attached last in the derived chain
so expressions read rollups/reverse/timestamps; formulas evaluate one
shared snapshot (no ordering effects, no cycles), errors are deterministic
cell text, nothing executes side effects or I/O, and nothing lands in
frontmatter. Verified: evaluator + attach + embed round-trip + board-lane
units, browser tests for the grouped embed and multiselect drops, `pnpm
check`, and the full suites. **Plan 29's slices are complete** — formulas
date functions, per-group aggregates, timeline/gallery are future scope.

**Craft parity (user decision 2026-08-30, [Plan 28](plans/28-craft-parity.md)).**
With Craft screenshots as the reference, the direction is set: Kore
converges on Craft's visual and interaction register — dissolving scroll
edges, live-preview cards, quiet circular chrome, one motion register —
without touching structure (the left sidebar explicitly stays Kore's own).
A side-by-side against the reference shots (user correction, same day)
established the gap is the whole register, not one effect — scale and
air, space over hairlines, cards as documents, floating chrome — so
slice 1 (this session) lands all four on the main surfaces: display-size
subjects and screen titles, the daily stream's space-plus-one-hairline
day grammar, live-preview grid cards, and the scroll veil with glass
table headers. Slice 2 followed in the
same session: typed grid cards carry property chips (the table's badge
hues, the user's date format), closing the gallery-view ask, with
board/calendar aligned to the card language. Slice 3 (2026-08-31): header
icon buttons normalized onto one round quiet recipe, and the daily
stream's floating ‹ date › pill (follows the focused day, hops days,
label jumps to today); the line audit found strip/panel edges already
clean, so the sticky table header's one hairline stays deliberate.
Slice 4's app side (same day): the context rail's sections become
grouped rows (one edit in the shared SidebarSection), and the selected
block softens to Craft's tinted field via the `--meowdown-node-outline`
seam. Remaining, in the meowdown repo: the per-block ellipsis beside the
drag grip.

**Collections UX pass (user decision 2026-08-30).** The Now ladder shipped
through v0.38.0–v0.40.0 (recall + skills, S3-minimal runtime per
[TDR 0007](decisions/0007-durable-runtime-minimal.md), the backlog-B polish
pass, advisories cleared). A state-of-collections analysis then established
that the capability is real (working table/board/calendar, saved views,
filters, CSV) while discoverability is the deficit, and the user approved
building its recommendations, fused with their own ask: a tag should open
as **its own page**, not as All Notes with a filter on. Slice 1 (this
session) is that tag page; queued next are the optional properties header
above the note body, a gallery view that shows properties, and rollup
sum/avg. Also still open: the live checks below. B05c preview tabs stays
declined; the backlog-B pass is closed.

## What is true now

- [x] **Collections: the daily loop** (user decision 2026-09-04 after the
  gap review against Tana and Notion; [TDR 0005 Amendment B](decisions/0005-tag-types-and-collections.md)).
  Slice 1, the table: the header "+" adds a property by name and type,
  each column has a menu (sort, then-by, hide, edit, delete), the last
  line "+ New" births a titled row. Slice 2, the Tana loop: the tag page
  renders its definition note's body with an Edit link; clicking a `#tag`
  in a daily offers "Turn this line into a #tag note" (line text titles
  the note, the line becomes `[[Title]] #tag`). Slice 3: sort chains
  (settings, saved views, repeated `sort:` fence lines), an All/Any filter
  switch (`match: any` in the fence), and the side peek (one selected row
  previews in the context rail). Verified: collection-table 16/16,
  filter-menu, embed, peek, tag-description, tag-actions suites plus the
  wide perimeter (core + editor + all-notes + notes + tags + sidebar:
  225 files, 2804 tests) on Chromium, changed `.test.tsx` on WebKit,
  `pnpm check` exit 0, and a dev-app run on `#link` (added a column,
  created a row, peeked it).

- [x] **Every tag is a collection** (user decision 2026-09-04, Tana as the
  reference; [TDR 0005 Amendment A](decisions/0005-tag-types-and-collections.md)).
  A tag page opens as its collection table whether or not `tags/<name>.md`
  exists — Title and Updated over the rows, the header gear and the
  table's "+" open the schema dialog, and the first saved property writes
  the definition note. The "Create a collection" pill, the plain list view
  on tag pages, and the sidebar's "Has a collection" glyph are removed; the
  ` ```collection ` fence and the `/` menu accept every tag. Verified:
  all-notes screen + collection-flow + embedded-collection + slash-items
  suites on chromium and webkit (42/42), the wider all-notes/tags/sidebar/
  notes/core-tags run 288/288, `pnpm check` clean.

- [x] **Notes open instantly** (user report, 2026-08-31: "Loading note…"
  visible on some opens; "le note dovrebbero aprirsi instantaneamente").
  Root causes found and fixed in the open path: reopening a note re-read
  it over IPC every time (now: an in-memory per-graph content cache serves
  the pane's first read, verified against disk immediately through the
  existing external-change reconciliation — stale serves self-heal under
  the same clean-adopt / dirty-conflict contract as any external edit),
  and on desktop an iCloud-evicted note (Optimize Mac Storage) downloaded
  *inside* `note_read` on open (now: the iCloud controller requests
  pending note downloads on start and every resume, notes only, mirroring
  mobile's policy — the vault re-warms in the background). Verified: cache
  suite 4/4 (node), warm-open suite 3/3 + full note-document suite 38/38
  and iCloud controller 19/19 (chromium), typecheck + lint clean, dev
  E2E smoke (open → type → rename → tab hop → reopen keeps content).

- [x] **Default vault objects** (user ask, 2026-08-30): a brand-new vault
  is born with four typed supertags under `tags/` — Project
  (Status/Due/Priority), Person (Email/Company/Birthday/Phone), Company
  (Website/Industry/Location), Meeting (Date/Attendees/Project) — each a
  plain definition note with an explanatory body. Seeded by
  `ensureFirstRunSeeds` (the welcome note's own mechanism, one scan, one
  meta marker per seed): only a never-seen, completely empty vault gets
  them; existing vaults — the user's included — are marked without a
  write, and deleting an object never brings it back. The schema dialog's
  presets now derive from the same `DEFAULT_VAULT_OBJECTS`, so a deleted
  default is one click from returning on any tag. Content, never
  behavior, per the automations principle. Verified: core source
  round-trip + write tests, first-run suite 6/6, provider seeding suite,
  dialog 8/8, `pnpm check` exit 0.

- [x] **Projects slice 2: the portfolio pulse.** Collection rows now show
  where work is waiting: the table's subject cell and the board's cards
  carry a small open-task count badge — the same membership rule as the
  Tasks panel (written in the note, or a task line linking it), read in
  one batched `countOpenTasksForNotes` over the existing projections
  (shared predicate with the panel read, chunked IN() lists, no schema,
  no Rust). Zero renders nothing, so collections that never carry tasks
  (books, people) stay clean. Verified: batch flow scenario on real SQL
  (own+linked, completed excluded, due-date links ignored), badge tests
  in the table and board suites, embedded-collection re-green,
  `pnpm check` exit 0.

- [x] **Projects slice 1: a task belongs to the project it links.** The
  gap the project-management analysis named — tasks live only in their
  note, so "all tasks of project X" was unanswerable — closes with a
  line-level rule: an open task belongs to a note when its own line
  wiki-links it (`+ [ ] call the surveyor [[House]]` in a daily note) or
  when it is written in the note itself. `getOpenTasksForNote` reads it
  from the existing `tasks` × `backlinks` projections (link-to-line
  containment matched in TS over the shared UTF-16 offsets; calendar
  `[[YYYY-MM-DD]]` targets stay due dates, never references — no schema
  change, no Rust), and every regular note's context rail gains a Tasks
  panel: own tasks first, then linked ones naming their source note
  (click jumps there), checkbox completing through the Tasks view's own
  commit. Recorded product principle the same day: **no default
  routines** — automations are always user-created; a future routines
  page may only recommend templates (roadmap). Verified: 4 real-SQL flow
  scenarios on the production migration chain (containment across astral
  chars, dedupe, due-date exclusion, completed excluded), section suite
  3/3 + context-rail suites 14/14 on chromium, `pnpm check` exit 0.

- [x] **Collections slice 2: the schema dialog earns its job** (user ask,
  2026-08-30: "migliorare la UX/UI della pagina di creazione dei super
  tag"). The Configure-tag dialog now teaches what it builds: a live
  views strip under the property list says which collection views the
  draft schema unlocks — lit pills name the property powering Board or
  Calendar, dark ones say exactly what to add — reading availability from
  the same predicates the board and calendar use (new
  `lib/tags/schema-views.ts`, now their single source of truth). An empty
  schema offers three one-click presets (Task board, Reading list,
  People) that seed editable rows — the fastest honest path to a working
  kanban. Property rows lost their plumbing: the frontmatter key folds
  behind a mono chip (auto-derived from the name; an invalid or duplicate
  key pops the editor open itself), select/status options are removable
  chips in their real collection colors with an inline add field, the
  type picker carries a glyph per type, and a freshly added row focuses
  its name input. Save, rename-migration, and conversion flows unchanged.
  Verified: dialog suite 9/9 (3 new tests), property-editors,
  collection-board/calendar, collection-flow, embedded-collection and
  all-notes screen suites all green on chromium (webkit in CI);
  `pnpm check` exit 0.

- [x] **Collections slice 1: the tag page.** A routed tag
  (`{kind:'allNotes', tag}`) renders as the tag's own page: `#tag` is the
  title with an "All notes" breadcrumb back, the filter pills stay on the
  unfiltered view only, the workspace tab renames to `#tag` (same singleton
  surface tab), and the sidebar lights the tag's row instead of All notes.
  A typed tag shows its schema gear beside the title; an untyped one shows
  a "Create a collection" CTA opening the same TagConfigDialog — the
  discoverability fix the collections analysis called for. All Notes
  (tag=null), every collection view, and all persisted per-tag preferences
  are untouched; nothing about the route moved, so back/forward and scroll
  memory hold. Verified: all-notes screen + collection-flow suites 35/35,
  sidebar 32/32, tabs-strip and route-content suites green on chromium
  (webkit in CI), `pnpm check` exit 0.

- [x] **Backlog-B pass, first slice: tab drag-reorder (B05a) and browser
  Clip to note (B04d).** Tabs reorder by drag along the strip (dnd-kit, the
  sidebar-pinned pattern; order persists in the settings tab list; clicks,
  double-click pin, and middle-click close keep working via the 4px
  activation distance). The in-app browser's toolbar gains Clip to note: it
  reads the shown page and spools the same link-capture envelope the Chrome
  extension produces (new `in-app-browser` source), so a clip rides the
  whole existing pipeline — drain, dedup, daily-note placement, enrichment;
  non-http(s) pages refuse at the schema. B04's other polish (address bar,
  back/forward, reload) predates this pass — verified already shipped.
  Verified: strip suite 15/15, pane + context-rail suites 28/28 on
  chromium (webkit in CI). Same pass, second slice — **graph polish
  (B03b/c)**: nodes color by their first tag (folded-key order in core's
  `getGraphMap`; stable hue hash over the theme-safe graph palette) and a
  header search lights matching notes up in place (accent fill + label,
  the rest recede; match count in the header; the canvas repaints through
  a ref so a keystroke never rebuilds the layout). Verified: core
  graph-map 2/2, screen suite 3/3 on chromium. Third slice — **B05b tab
  list menu and B03a local view, in its non-breaking variant**: the strip
  gains a list-all-tabs menu (every open tab by full title, active one
  checked; hidden under two tabs) — the overflow affordance without
  measurement logic — and ⌥-clicking a graph node focuses its two-hop
  neighborhood (BFS in `graph-map-focus.ts`; "focused on X · Show all"
  chip; plain click still opens the note, so no existing gesture moved).
  Verified: focus helper 5/5, strip suite 16/16, screen suite 3/3 on
  chromium. B05c preview tabs: **declined by the user (2026-08-30, "not
  for now")** — a single click keeps opening a permanent tab; the backlog-B
  pass is closed.

- [x] **Now item 4 implemented: S3 minimal durable runtime**
  ([TDR 0007](decisions/0007-durable-runtime-minimal.md)). One process-wide
  FIFO run lock in Rust (leases per window, swept on window destroy and on
  each fresh JS context) composed under `withAgentRunLock`, so chat edit
  turns and routines serialize across every window; a durable in-flight
  marker (atomic single slot under the app data dir) that recovery turns
  into an "interrupted" failure entry with normal backoff on the next
  launch, per graph; Stop on the running routine from the Agents screen
  (abort reaches the native process-tree kill; no failure strike); and a
  native minute tick so hidden-window throttling cannot starve schedules.
  Deliberately out (R4): job tables, durable event-run queue, execution
  with no webview, approval checkpoints. Verified: Rust lock/marker unit
  tests, 5 new lock-composition tests and the interrupted-run test in core,
  routines-section browser tests incl. the Stop row (chromium; webkit is
  CI-only in this container), `cargo fmt`/`clippy -D warnings` clean,
  typecheck green.

- [x] **Now item 2 implemented: chat attachments out of base64.** Bytes go to
  `.reflect/chat-attachments/<conversation>/` at send time via new
  generation-pinned Rust commands (closed path shape, atomic writes); the
  persisted row keeps only the path; rendering rides a strict carve-out in
  the `reflect-asset://` protocol; BYOK sends hydrate restored attachments
  per send; conversation delete sweeps the directory; legacy inline rows
  still load. Verified: 10 Rust unit tests (validators + protocol carve-out),
  30 core tests, 64 browser tests on chromium (webkit locally green except
  the known pre-existing model-picker flake, which is green on CI with
  retries); `pnpm check` exit 0; `cargo fmt`/`clippy` clean.
- [x] **Now item 2's measurement run.** Native embedding benchmark on the
  current build (bounded mode, 32 texts × 5 cycles, cached model): peak
  native footprint 515 MB, stable, no growth after idle model drop. Recorded
  in [memory budgets](memory-budget.md).

- [x] **Now item 1 implemented: MCP tools in read-only chat**
  ([Plan 27](plans/27-read-mode-mcp-tools.md)). Composer Tools toggle (Claude
  Code/Codex with at least one enabled server), confirmation dialog naming the
  servers, per-conversation ephemeral opt-in reset by New chat and
  conversation switch, delivery gate `allowEdits || (chatTools &&
  cliProviderSupportsMcp)`, prompt lines naming the servers, privacy.md
  updated. Verified: 42 core CLI tests and 28 chat-provider browser tests pass
  on chromium and webkit; `pnpm check` exit 0. Not yet exercised against a
  live MCP server in the running app.

- [x] **Now item 3a implemented: automatic vault recall in chat** (#104).
  At send time the message's significant terms (bilingual stopwords,
  mentions/URLs/code stripped) drive one OR-composed FTS query; the top
  three passages ride the model-bound message with provenance, fenced as
  vault data beside the mention block. Private notes excluded at the SQL
  level; mentioned notes left to their mention; failures degrade to no
  recall. Verified: 11 unit tests, 5 real-SQL scenarios on the dev
  bridge's SQLite (daily-note recall with date, bm25 ranking, private
  never surfaces, off-vault silence, mention dedupe), full core suite
  2128/2128, chat browser suites green on both engines in CI.
- [x] **Now item 3b implemented: user-taught vault skills**
  (`agents/skills/`, #106). One markdown file per skill (frontmatter
  `description:`, H1 name, steps); the prompt carries only the catalog —
  name, description, path — and the agent reads a skill on match
  (progressive disclosure, like memory digests). `private: true` hides a
  skill; under write approval, new/changed skills route through the
  existing pending-proposal queue (the approve path already creates a
  missing target), so R7's user-review holds. Not yet exercised in a live
  conversation.
- [x] App-first reprioritization decided with the user (grilling session,
  2026-08-30) and recorded in the roadmap: Now = read-mode MCP, chat
  attachments off base64 + budget measurement, agent memory recall/skills;
  Next = device-pass session, minimal S3, Connections program; Later = the
  rest of the Personal OS program, intact and decision-gated.
- [x] S4 re-scoped by decision: no first-party universal-search subsystem; the
  agent is the query planner over capabilities. Recorded in roadmap and Plan 25
  I12/I13 notes.
- [x] Planning docs restructured: roadmap rewritten (app-first Now/Next/Later,
  risk register R1–R13), shipped history moved to the delivery log, Plan 26
  gains the S1a/S1b split and the Google restricted-scope risk. Verified: all
  relative links in the touched docs resolve; `pnpm check` exit 0.
- [x] Plan 26's starting-point facts re-verified at `029f728f`: no stable Graph
  ID, no `ConnectorDefinition`/`GraphConnectionGrant`/`email.search` symbols in
  `packages/core` or `src-tauri`. Nothing of S1 is implemented.
- [x] Two S3-relevant facts verified in source: the desktop process survives
  window close (`prevent_exit`, `apps/desktop/src-tauri/src/lib.rs:536`) and
  agent CLI processes spawn from Rust (`apps/desktop/src-tauri/src/agent_cli.rs`).

## Next step

1. **Projects, remaining**: slice 3 stays a *recommendation only* per the
   automations principle — a suggested weekly-review routine template on
   a future routines page, whenever that page gets built. Consider a
   Tasks-view "by project" grouping if the note panel proves not enough
   in real use.
2. **Collections** ([Plan 29](plans/29-collections-database.md)) is
   complete through T2 — the UX pass's a/b/c and every planned slice
   shipped. New scope (formula date functions, per-group table
   aggregates, timeline/gallery views) waits for a fresh user decision.
3. **Live checks with the user**: (a) Now 1: real MCP server + Tools toggle
   in a read-only conversation; (b) Now 2: send an image in chat, restart,
   confirm the restored conversation renders it from disk; (c) Now 3: ask a
   question a daily note answers and confirm the recalled passage shows up
   in the reply; teach a skill ("salvala come skill"), approve it from the
   Agents screen, invoke it in a fresh conversation; (d) Now 4: start a
   routine, quit Kore mid-run, relaunch and see the interrupted entry +
   retry; Stop a running routine from the Agents screen.
4. **Memory follow-ups** that emerge from Now item 3 usage (roadmap Next).

## Session log

- 2026-09-04 — Collections daily loop, three slices on one branch
  (schema edits and rows from the table; tag page description + daily
  line to note; sort chains, any/all, side peek). TDR 0005 Amendment B.
- 2026-09-04 — Every tag is a collection: zero-property schema substituted
  at the collection surfaces (`EMPTY_TAG_TYPE`), CTA and typed glyph
  removed, fence and slash menu opened to all tags. TDR 0005 Amendment A.
- 2026-09-01 — Plan 29 V2a + V2b + T2: multiselect board lanes (per-card
  drop writes, list overlay), `group:` in the collection fence (applied by
  the embedded table), and formula columns (pure `evaluateFormula`,
  attached last, deterministic errors, I15's no-side-effects contract).
  Plan 29's slices complete.
- 2026-09-01 — Plan 29 V1b + T1: table row grouping (per-tag "Group by",
  board-lane shelves without rank-sort or empty lanes, saved-view
  `tableGroup`, keyboard nav mapped through the grouped order) and the
  created/updated/person/phone property types (created = creation-time
  frontmatter stamp, updated = view over indexed mtime with the `$updated`
  sort reroute, person = `#person`-scoped relation with initials disc,
  phone = tel text). v0.44.0 had shipped the first wave just before.

- 2026-08-30 — Default vault objects (Project, Person, Company, Meeting)
  seeded into brand-new vaults through the welcome note's first-run
  mechanism; dialog presets unified onto the same definitions. v0.41.0
  shipped just before (the tag page, schema dialog, task↔project link,
  and count badges all in one release).
- 2026-08-30 — Projects slice 2: open-task count badges on collection
  rows (table subject cell + board cards), one batched read sharing the
  slice-1 membership predicate. Slice 1 (#119) merged the same session.
- 2026-08-30 — Projects slice 1, from the project-management analysis the
  user approved: a task's own line linking `[[a note]]` makes it that
  note's task; every note's context rail gains the Tasks panel (own +
  linked, checkbox completes). Product principle recorded in the roadmap:
  no default routines, ever — user-created only, recommendations at most.
- 2026-08-30 — Collections slice 2, on the user's ask: the tag schema
  dialog redesigned — live views strip (Board/Calendar hints from the
  board's and calendar's own predicates, extracted to
  `lib/tags/schema-views.ts`), one-click starter presets on an empty
  schema, options as colored chips, the frontmatter key folded behind a
  chip, typed glyphs in the type picker. Tag page (#116) merged the same
  session.
- 2026-08-30 — Collections slice 1: the tag page (tag as title +
  breadcrumb, tab renamed `#tag`, schema gear in the header for typed
  tags, "Create a collection" CTA for untyped ones; All Notes untouched).
  Preceded by the state-of-collections analysis (capability real,
  discoverability the deficit) and the user's decision to build the
  recommendations, with the tag-as-page UX theirs. v0.40.0 shipped
  mid-session (docs pass + advisory cleanup).
- 2026-08-30 — Backlog-B third slice: list-all-tabs menu (B05b) and the
  graph local view (B03a) as ⌥click-to-focus — chosen over changing the
  primary click, which stays "open the note". v0.39.0 shipped mid-session
  (S3 + the first two polish slices). Only B05c (preview tabs) remains,
  gated on the user.
- 2026-08-30 — Backlog-B pass: tab drag-reorder (B05a), browser Clip to
  note (B04d, riding the existing capture-envelope pipeline with a new
  `in-app-browser` source), graph tag colors + search highlight (B03b/c).
  Audited B03/B04/B05 against the code first: B04's controls were already
  shipped; B03a parked as a user UX call.
- 2026-08-30 — Implemented Now 4, the S3-minimal durable runtime (TDR 0007):
  cross-window run lock, durable in-flight marker + launch recovery, Stop on
  a running routine, native scheduler tick. S3 pulled from Next to Now by
  user decision (with a backlog-B polish pass queued next); v0.38.0 shipped
  earlier in the session (recall + skills).
- 2026-08-30 — Implemented Now 3a (automatic vault recall in chat, #104)
  and Now 3b (user-taught skills under `agents/skills/`, catalog in the
  prompt, teaching routed through the pending-approval queue). Scope for
  item 3 sharpened with the user before building (recall first, both
  halves).

- 2026-08-30 — Implemented Now 2 (attachments off base64, protocol carve-out,
  conversation-delete sweep) and ran the never-run native memory benchmark on
  the current build (peak 515 MB bounded).
- 2026-08-30 — Implemented Plan 27 (MCP tools in read-only chat) behind the
  per-conversation Tools opt-in; privacy.md updated; tests green on both
  browser engines.
- 2026-08-30 — Grilling session with the user: app-first decided; S1/S2/S3
  deferred to Next; mobile confirmed as capture/read companion (remote control
  later); semantic search desktop-only; S5 stays later; agent memory work
  scoped to recall + skills; first item = read-mode MCP with approval.
  Roadmap rewritten as Now/Next/Later.
- 2026-08-30 — S4 re-scoped by decision: no first-party universal-search
  subsystem; the agent is the query planner over capabilities, I12's Resource
  store dropped (sync cursors survive, deferred to I16), R11 resolved.
- 2026-08-30 — Roadmap/spec review and doc restructure; risk register added.
  No application code changed.
