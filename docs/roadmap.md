# Roadmap

Feature backlog for this fork, roughly by priority. Shipped work moves to the
bottom rather than being deleted, so the list doubles as a changelog of the
customization effort.

## Next up

- **HTML & PDF viewing in-app** — open `assets/*.html` and `assets/*.pdf`
  attachments inside Reflect (a viewer pane/window) instead of bouncing to an
  external app. PDF paging and text selection; HTML rendered sandboxed
  (no script escalation from note attachments).
- **In-app browser** — a browser pane for opening external links without
  leaving the app; likely a separate Tauri webview window with back/forward,
  URL bar, and a "clip to note" action. Needs a hard security review
  (separate webview context, no IPC bridge exposure to arbitrary pages).
- **Tabs for open notes** — move between open notes with a tab strip
  (pin/reorder/close, `⌘1…9`, middle-click close). Interacts with the router
  and multi-window support; design first: tabs per window, restored on
  launch.

## Backlog

- **Note templates** — a `templates/` folder with placeholder expansion
  (`{{date}}`, `{{title}}`), pickable from New note and the palette.
- **Global quick capture** — a system-wide shortcut opening a mini window
  that appends a line to today's daily note without focusing the app.
- **Graph view** — a visual map of note links (data already in the index).
- **Task reminders** — native notifications for tasks with due dates.
- **Per-note version history** — a timeline UI over the existing Git backup
  (diff + restore).
- **Styled note export** — HTML/PDF export of a single note in the app's
  design language.
- **Mobile parity for the All-notes grid view** — the card grid currently
  ships on desktop only.

## Shipped (this fork)

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
