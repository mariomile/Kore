---
name: kore-agent-memory
description: Read and maintain the agents/ folder of a Kore graph — the shared user profile, shared facts and session log, per-agent souls and working memory, staged memory proposals, and user-taught skills. Use before longer tasks in a Kore graph, when the user asks an agent to remember something, or when the user mentions agent memory, souls, or vault skills.
---

# Kore agent memory

The `agents/` folder is the graph's agent home. Kore's own chat injects
these files into every AI session; external agents (Claude Code, Codex,
Cursor) should read them the same way and route what they learn to the
right file. Everything is plain markdown: visible, editable, linkable,
synced, versioned. A file flagged `private: true` never reaches any model.

## Files

| Path | Owner | Contents |
|---|---|---|
| `agents/user.md` | shared | Durable facts about the user: role, preferences, how they like to work. Read first. |
| `agents/memory/facts.md` | shared | One bullet per durable fact or decision every agent relies on. |
| `agents/memory/log.md` | shared | The session journal: one `## YYYY-MM-DD — <agent>` entry per work session, newest last. |
| `agents/memory/pending.md` | shared | Staged memory proposals awaiting the user's approval (only when write approval is on). |
| `agents/<slug>/soul.md` | the user | A profile's identity, voice, and boundaries. Read it, respect it, never rewrite it. Its frontmatter may pin a `provider` and `model`. |
| `agents/<slug>/memory.md` | that agent | The profile's own working memory: lessons, conventions, project state. Keep it current. |
| `agents/skills/<slug>.md` | the user | Reusable procedures the user taught; frontmatter `description` says when to use one. |

The default profile slug is `assistant`.

## Formats

**facts.md** — one bullet per fact, updated in place (never duplicated),
each tagged with confidence and signed:

```markdown
- The newsletter ships on Tuesdays. [certain] — assistant, 2026-09-10
- Mario prefers Italian in chat, English in code. [certain] — codex, 2026-09-02
- The Sordi launch may slip to October. [speculative] — assistant, 2026-09-08
```

Confidence tags: `[certain]`, `[likely]`, `[speculative]`.

**log.md** — append one section per session, a few bullets, newest at the
bottom (the digest reads the tail, so recency wins by construction):

```markdown
## 2026-09-10 — assistant

- Drafted the Q4 plan in [[Q4 Plan]]; open question on hiring.
- Learned: the app's Tasks page ignores square checkboxes.
```

**pending.md** — when it exists with proposal sections, the vault uses
write approval. Do not edit `user.md` or `facts.md` directly; stage the
change instead. Heading `## <date> <agent> → <target path>`, then the
bullets that approval will append:

```markdown
## 2026-09-10 assistant → agents/memory/facts.md

- The newsletter now ships on Wednesdays. [certain] — assistant, 2026-09-10
```

**skills/<slug>.md** — an H1 as the name, a frontmatter `description`, and
the procedure as steps. Save a refined workflow here when the user says
"save this as a skill".

## When to write what

| You learned… | Write to |
|---|---|
| Something durable about the user (preference, role, constraint) | `user.md` (or a pending proposal) |
| A fact or decision every agent should rely on | `memory/facts.md` (or a pending proposal), updating the existing bullet if one exists |
| What happened this session | `memory/log.md`, one new section |
| A lesson about how you work in this graph | your `agents/<slug>/memory.md` |
| A reusable procedure the user wants kept | `agents/skills/<slug>.md` |

## Rules

1. **Read `user.md`, `facts.md`, the tail of `log.md`, and your profile's
   `soul.md`/`memory.md` before a longer task.**
2. **Short and curated.** Update a fact in place; do not append a second
   version. Keep log entries to a few bullets.
3. **Never store secrets, credentials, or content from private notes** in
   any memory file.
4. **Respect ownership.** `soul.md` and `skills/` are the user's; shared
   files under approval go through `pending.md`.
