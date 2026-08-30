# Kore roadmap

**Updated:** 2026-08-30.
**Direction (decided 2026-08-30, app-first):** Kore is first the best
local-first notes app with agents: fast and powerful on desktop, with the
iPhone app as an excellent capture and reading companion. The Personal OS
program (multi-account Connections, grants, durable runtime) remains the
adopted long-term direction but is **not the active backlog**; it resumes on an
explicit decision, not by drift.
**Status:** Nothing below is claimed as delivered. Shipped work is in the
[delivery log](delivery-log.md); what is in progress right now is in
[STATE.md](STATE.md).

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
measured pain, but known open items get closed (see Now) and regressions are
treated as bugs.

**Automations principle (user decision, 2026-08-30):** Kore ships **no default
routines or workflows**. Every automation is created explicitly by the user;
the app may at most *recommend* routine templates (e.g. a weekly project
review) from a future routines page, never preinstall or auto-enable one.

## Now

In order. Sizes are relative complexity for agent-executed work, not time.

**Craft parity (user decision, 2026-08-30):** Kore converges on Craft's
visual and interaction register — dissolving scroll edges instead of
clipped bars, live-preview cards, quiet circular chrome, one motion
register — with the left sidebar explicitly staying Kore's own and no
structural change. Sliced in [Plan 28](plans/28-craft-parity.md); slice 1
(the scroll veil) shipped in this wave.

**2026-08-30: all four items below shipped** (1–2 earlier in the day, 3 in
v0.38.0, 4 in v0.39.0 with the backlog-B polish pass; details in the
[delivery log](delivery-log.md), live state in [STATE.md](STATE.md)). Now
is empty until the pending live checks and the next explicit decision
(B05c preview tabs was declined on 2026-08-30, closing the backlog-B
pass) — the entries stay listed for the record until the next roadmap
review.

1. **MCP in read-only chat, behind explicit approval.** Today MCP servers ride
   agent chat in edit mode only; read-only chat is zero-egress by design.
   Outcome: "search my mail" in a normal chat via the user's own MCP servers,
   with no Connection program built. Constraint: zero-egress stays the default;
   an explicit per-conversation opt-in with visible approval is required, so
   this needs a short privacy design note before code. Size: small-medium.
2. **Chat image attachments out of base64.** Attachments are held as base64
   `data:` URLs in memory and DB (open item in
   [memory budgets](memory-budget.md)); move them to disk with references.
   Size: small-medium. Close with the one-time memory-budget measurement on the
   current build, which has never been run.
3. **Agent memory: reliable recall and reusable skills.** Two bounded halves:
   (a) recall the agent can be trusted with: facts from vault/journal surface
   when relevant, verified with concrete recall scenarios; (b) skills as
   user-taught reusable procedures, richer than today's per-graph skill file.
   Sharpen scope against real usage before building. Size: medium.
4. **S3 minimal durable runtime** (entered from Next by user decision,
   2026-08-30, together with a backlog-B polish pass): a run lock shared by
   every window, a durable in-flight marker with launch recovery, a user
   Stop that reaches the engine, and a native scheduler tick. Bounded by R4
   — no queue generalization. Decision and boundaries in
   [TDR 0007](decisions/0007-durable-runtime-minimal.md). Size: medium.

## Next

Ordered candidates; each enters Now by explicit decision.

- **iPhone device-pass session.** The accumulated physical-device checks
  (keyboard/IME, chat with a real key, Siri/Action button, GitHub connect
  under suspension) gate any "mobile fast and powerful" claim. Requires the
  user and their device.
- **S3 minimal durable runtime** — entered Now (item 4) by user decision on
  2026-08-30; see [TDR 0007](decisions/0007-durable-runtime-minimal.md) for
  what the slice includes and deliberately leaves out.
- **S1/S2 Connections program** ([Plan 26](plans/26-account-safe-read.md)):
  deferred while MCP-via-CLI covers external access. Enters Now when
  multi-account isolation becomes a real need or MCP friction hurts.
- **Memory follow-ups** that emerge from Now item 3.

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
- **S5 structured knowledge** (stable-ID relations): current Collections
  suffice until relations break in real use.
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
are absorbed by the device-pass session in Next. No bump, Apple signing,
TestFlight, or release action is part of this update.

## History

Everything this fork has shipped is recorded in the
[delivery log](delivery-log.md). Entries there are historical reports, not
fresh certifications; new target work belongs above.
