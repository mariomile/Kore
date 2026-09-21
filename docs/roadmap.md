# Kore roadmap

**Updated:** 2026-09-21, against `9ee8d04` (v0.70.2, released 2026-09-20).
**Direction (decided 2026-08-30, app-first, unchanged):** Kore is first the
best local-first notes app with agents: fast and powerful on desktop, with the
iPhone app as an excellent capture and reading companion. The Personal OS
program (multi-account Connections, grants, durable runtime) remains the
adopted long-term direction but is **not the active backlog**; it resumes on an
explicit decision, not by drift.
**Status:** Nothing below is claimed as delivered. Shipped work is in the
[delivery log](delivery-log.md); what is in flight right now, with its
verification, is in [STATE.md](STATE.md) — that file wins over this one on any
question of what is done.

Read order: [planning inventory](planning-index.md),
[target architecture](kore-target-architecture.md) (deferred direction), and
the [Plan 25 initiative catalog](plans/25-personal-os.md) (deferred program).
The complete supplied "Lore" specification is preserved as
[source material](kore-architecture-source.md). Kore remains the public project
name; technical and Apple identifiers are unchanged.

Daily outcomes ranked by the user (2026-08-30), the yardstick for what enters
Now: 1. agents on the vault · 2. capture anywhere · 3. semantic search ·
4. Collections · 5. automations · 6. calendar integration.

Speed is a guardrail, not a workstream: no dedicated performance push without a
measured pain, but known open items get closed and regressions are treated as
bugs.

**Automations principle (user decision, 2026-08-30):** Kore ships **no default
routines or workflows**. Every automation is created explicitly by the user;
the app may at most *recommend* routine templates (e.g. the weekly review that
shipped in v0.68.0) from Settings → Agents, never preinstall or auto-enable
one.

## What closed since the last roadmap (2026-08-30 → 2026-09-20)

The previous revision's Now list is spent — all four items shipped, and three
programs finished behind them. Details and verification live in the
[delivery log](delivery-log.md) and [STATE.md](STATE.md); this is the ledger,
not the record.

- **The four Now items shipped.** MCP tools in read-only chat behind a
  per-conversation opt-in ([Plan 27](plans/27-read-mode-mcp-tools.md)), chat
  attachments off base64 plus the never-run memory benchmark (515 MB peak,
  [memory budgets](memory-budget.md)), agent memory as vault recall +
  user-taught skills, and the S3-minimal durable runtime
  ([TDR 0007](decisions/0007-durable-runtime-minimal.md)).
- **Collections became databases.** [Plan 29](plans/29-collections-database.md)
  is complete through T2: typed relations, reverse relations, rollups with
  aggregation, grouping, formula columns, twenty property types, Notion-style
  view tabs with `...` options, and tab reorder by drag or ⌥Arrow (v0.69.0).
  The standalone-collection direction was **withdrawn by the user on
  2026-09-15**: supertags are the only structure users create; notes embed live
  views of tagged notes.
- **Supertags got a face.** Display names without the hash, 217 symbol icons
  with a searchable picker, icons on the sidebar, tag pages and open tabs.
- **The CLI became an agent surface.** [Plan 30](plans/30-cli-agent-parity.md)
  shipped all three layers — read completeness, structured writes, agent
  ergonomics — verified by a live pass on the real graph, and four bundled
  skills install from Settings → Agents.
- **Split panes.** N columns of stacked panes, tab moves by drag and keyboard,
  ⌘-click opens a link in the neighbouring pane.
- **Chat became an editor.** `edit_note` proposes a body hunk the user accepts
  with Enter or rejects with Backspace, nothing written before the accept
  (v0.68.0); a message sent mid-stream steers the reply instead of queueing
  (v0.70.0).
- **Craft parity** ([Plan 28](plans/28-craft-parity.md)) landed slices 1–4 on
  the app side. One item remains, in the Meowdown repo: the per-block ellipsis
  beside the drag grip.

## Now

The live thread, and the debts that outlived the wave above. Order below the
first item is not settled — it needs a user decision, and this file will not
invent one.

1. **AI control of the app itself** (user ask, 2026-09-15: "dall'AI dobbiamo
   poter modificare tutto dell'app, come anche le icone"). Slice 1 shipped in
   v0.69.0: the chat AI sees the icon catalog and proposes a tag icon the user
   accepts in chat. Slice 2 is `set_tag_schema` — the model changing a
   supertag's properties, with the dialog's rename migration extracted into
   `lib/tags` — in flight in
   [PR #237](https://github.com/mariomile/Kore/pull/237). The surface-by-surface inventory, and the rule every slice
   follows (the model must be able to *see* the valid values before it writes),
   is in [the gap map](ai-app-control.md). Size: medium per slice.
2. **The live checks with the user.** Four features are implemented and
   test-green but have never run against a real provider, a real server, or a
   real device: (a) a real MCP server through the Tools toggle in a read-only
   conversation; (b) an image sent in chat, app restarted, conversation
   restored from disk; (c) a question a daily note answers, then teaching a
   skill and invoking it in a fresh conversation; (d) a routine interrupted by
   quitting mid-run, plus Stop from Settings → Agents. Nothing here is code
   work; it is the difference between "tests pass" and "it works". Requires the
   user.
3. **iPhone device pass.** The accumulated physical-device checks
   (keyboard/IME, chat with a real key, Siri/Action button, GitHub connect
   under suspension) gate any "mobile fast and powerful" claim. Requires the
   user and their device. Carried from Next, where it has sat since 2026-08-30.
4. **Meowdown patch debt.** `pnpm-workspace.yaml` pins checked-in patches for
   `@meowdown/core@0.65.6` and `@meowdown/react@0.65.6` (the insertion API and
   the React code-block renderer from
   [Meowdown PR #546](https://github.com/prosekit/meowdown/pull/546)). They come
   out when a released Meowdown carries that PR and a frozen install plus
   `pnpm check` and `pnpm build` pass without them. Size: small, gated
   upstream.

## Next

Ordered candidates; each enters Now by explicit decision.

- **Collections, new scope.** [Plan 29](plans/29-collections-database.md) is
  complete; formula date functions, per-group table aggregates, timeline and
  gallery views, and view-tab rename are named but unbuilt, and wait for a
  fresh user decision rather than drifting in.
- **Split-pane follow-ups.** The pane divider's keyboard accessibility and the
  ghost pane entries left in settings, both named when part 2 shipped.
- **Tasks by project.** The weekly-review template covers the recurring pull;
  a Tasks-view "by project" grouping waits on the note panel proving
  insufficient in real use.
- **S1/S2 Connections program** ([Plan 26](plans/26-account-safe-read.md)):
  deferred while MCP-via-CLI covers external access. Enters Now when
  multi-account isolation becomes a real need or MCP friction hurts.
- **Memory follow-ups** that emerge from recall and skills in real use.

## Later and direction (decision-gated)

- **The Personal OS program**: [Plan 25](plans/25-personal-os.md) stays intact
  as the initiative catalog, [Plan 26](plans/26-account-safe-read.md) as the
  bounded S1 plan, and the
  [target architecture](kore-target-architecture.md) as the adopted direction.
  The [risk register](#risk-register-2026-08-30-review) below still applies
  whenever the program resumes.
- **S4 agent retrieval** (re-scoped 2026-08-30): no first-party
  universal-search subsystem; the agent is the query planner over
  capabilities, with per-item provenance. Lands naturally with the Connections
  program.
- **S5 structured knowledge** (stable-ID relations): Plan 29's typed relations
  and reverse relations cover today's need; revisit only when they break in
  real use.
- **Mobile semantic search**: desktop-only for now, by decision; mobile stays
  lexical.
- **Mobile remote control** (I22): the natural evolution of the companion
  role; requires the durable runtime first.
- Everything P2/P3 in Plan 25 (browser profiles, entity graph, connector/plugin
  SDKs, headless, hosted, collaboration).

## Risk register (2026-08-30 review)

Findings from a full pass over the 138-section source specification and the
current code. They gate the deferred Personal OS program; R1/R2 also explain
why deferring the Connections program is cheap. Blockers change scope
decisions; hard items need their own design before their initiative starts;
cautions are cheap if remembered early.

### Blockers

- **R1 — Gmail scopes are Google restricted scopes (I05/I09, source §6/§63–64/§72–75).**
  `gmail.readonly`/`gmail.send`/`gmail.modify` require OAuth verification plus
  an annual CASA security assessment before Google lets an app ship them to real
  users. The source treats Gmail as the trivial "prove the architecture" case;
  it is the most bureaucratically expensive integration in the plan. For
  single-user use: bring-your-own Google Cloud client in testing mode, which
  caps at 100 test users and expires refresh tokens every seven days, so weekly
  reconnect is the honest UX until verification. Staying on MCP-via-CLI makes
  this someone else's problem, which is part of why S1 is deferred.
- **R2 — Webhook triggers have no public endpoint on a local-first app (I16, source §53/§56).**
  Gmail push needs Cloud Pub/Sub; GitHub/Linear webhooks need a reachable URL.
  Polling with per-Connection sync cursors is the honest local-first primitive;
  name it as I16's mechanism. Push delivery becomes possible only with the
  headless runner (I21) or hosted runner (I27), never on the laptop app alone.

### Hard

- **R3 — Browser Profiles (I17, source §17–19).** Authenticated automation
  meets anti-bot detection (Google, LinkedIn, most SaaS logins), and per-Graph
  leak-proof cookie/session isolation amounts to rebuilding Playwright's
  browser-context isolation. Treat I17 as experimental: a Playwright-style
  sidecar with persistent contexts, or cut it and lean on API/MCP transports.
  The "no session leak between Graphs" exit criterion is a security property to
  prove, not just implement.
- **R4 — The durable runtime is a workflow engine if built generally (I07, source §43–50).**
  Jobs, scheduler, locks, retries, event bus, and checkpointed resume are
  Temporal-class scope. The "S3 minimal" bound in Next is the answer: states,
  attempts, one runtime-global lock, recovery; resist generalization until a
  second consumer demands it.
- **R5 — Entity resolution (I18, source §37–38).** Cross-source identity is a
  research-grade problem. First pass: exact-key matches only (email address,
  account ID), no fuzzy name matching, and un-merge support before any merge
  automation.
- **R6 — Headless runner is an internet-facing service (I21, source §82).**
  Auth, TLS, patching, and secret custody on a possibly less-trusted machine,
  maintained by one person. Require a written threat model before starting;
  default to a private overlay network posture (Tailscale-style) instead of
  open ports.
- **R7 — Memory poisoning through portable memory (I11/I20, source §78–81).**
  An external MCP client can write memory that other agents later treat as
  trusted, and nothing in the source propagates a Resource's
  `external_untrusted` label into memory records distilled from it. Extend the
  existing memory-write approval to every external caller, and carry provenance
  and trust labels into `MemoryRecord` as a contract, not a convention. Also
  relevant to Now item 3: recall improvements must not weaken write review.

### Caution

- **R8 — "Formula" is one word in the source and a full expression engine in
  practice (I15, source §25/§28).** Parser, types, dependency graph, incremental
  recompute, cycle detection. Adopt an existing sandboxed expression evaluator;
  do not invent a language.
- **R9 — Gmail has no send idempotency (I08/I09, source §97–98).** The
  spec-mandated "halt on uncertain state" is therefore the default path for the
  flagship demo write. Design the reconciliation UX with the durable runtime.
- **R10 — Connection uniqueness is under-specified (I02, source §69).** The
  `connector + external account + auth_context` constraint never defines
  `auth_context`. Define it (transport plus authorization method) before the
  registry schema lands, or the schema either allows real duplicates or blocks
  the legitimate second transport.
- **R11 — resolved by the 2026-08-30 S4 re-scope.** The source's synchronous
  multi-source search box (I13, §76–77) had no latency budget; it is no longer
  built. Agent-led retrieval streams tool calls in chat, where latency is
  visible and expected. Kept for the record.
- **R12 — The metrics list implies an observability stack (I19, source §62/§95).**
  Keep counters and durations in SQLite surfaced by the Action Center; drop the
  org-grade time-series checklist.
- **R13 — Security tests are not all one-time gates (I29, source §105).**
  Injection, SSRF, and malicious-MCP output are open-ended adversarial classes;
  schedule a recurring red-team pass rather than a single certification.
  Trust-level tagging bounds the blast radius of injection; it does not prevent
  steering within an agent's authorized capabilities.

## Retained fork follow-ups

[Plan 25 B01–B09](plans/25-personal-os.md#existing-backlog-retained-outside-the-new-program)
retains beta channel (parked), Cursor steering (provider-dependent),
graph/browser/tab polish, Meowdown glyph alignment, mobile queue/device checks,
Git HTTPS auth, and AI-assisted sync-conflict resolution. B07's device checks
are absorbed by the device-pass session in Now. Release mechanics (bump,
Apple signing, TestFlight) are procedure, not backlog: see
[CLAUDE.md](../CLAUDE.md#cutting-a-kore-release-bump).

## History

Everything this fork has shipped is recorded in the
[delivery log](delivery-log.md). Entries there are historical reports, not
fresh certifications; new target work belongs above.
