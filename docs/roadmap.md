# Roadmap

Feature backlog for this fork, roughly by priority. Shipped work moves to the
bottom rather than being deleted, so the list doubles as a changelog of the
customization effort.

## Next up

- **Styled note export** — HTML/PDF export of a single note in the app's
  design language.

## Backlog

- **Global quick capture** — a system-wide shortcut opening a mini window
  that appends a line to today's daily note without focusing the app.
- **Task reminders** — native notifications for tasks with due dates.
- **Recurring-task respawn from the editor checkbox** — completing a
  repeat task by clicking its checkbox inside the note editor doesn't spawn
  the next occurrence (meowdown exposes no editor-side task-toggle
  callback); Tasks-view completions now spawn in every case, live session
  included.
- **Mobile parity for the All-notes grid view** — the card grid currently
  ships on desktop only.

## Shipped (this fork)

- Per-note version history: a History section in the note and daily details
  rail over the graph's local Git backup — timeline of every commit that
  changed the note, full preview or per-save line diff, and one-click
  restore that snapshots the current state first (so a restore is itself
  just another version, never a loss).
- Lore's own Apple identity: bundle ids `app.lore.*` (desktop flavors, iOS,
  share/widget extensions), iCloud container `iCloud.app.lore` (shown as
  "Lore" in Files/Finder), App Groups `group.app.lore(.dev)`, product names
  Lore / Lore Beta / Lore Dev, StoreKit/IAP ids, updater endpoints pointed
  at this repo (safe-fail until own keys exist), keychain service `lore` —
  with a one-time signing checklist in docs/lore-apple-signing.md.
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
