# Roadmap

Feature backlog for this fork, roughly by priority. Shipped work moves to the
bottom rather than being deleted, so the list doubles as a changelog of the
customization effort.

## Next up

- **In-app browser** — a browser pane for opening external links without
  leaving the app; likely a separate Tauri webview window with back/forward,
  URL bar, and a "clip to note" action. Needs a hard security review
  (separate webview context, no IPC bridge exposure to arbitrary pages).

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
