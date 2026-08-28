# Memory: where it goes, and what holds it down

Kore's resident footprint is not one number. What a user reads in Activity
Monitor is the app process, the WebKit processes behind the webview, and every
helper the app started — an agent CLI with its MCP servers, the in-app
terminal's shell and whatever runs inside it. Those are separate processes with
separate resident sets, and confusing them is how "the app is using 10GB"
becomes unanswerable.

This document is the map: what owns memory, what releases it, and the budgets a
change should not blow through.

## Measure first

**Settings → About → Memory** reports the app's own resident set and every
helper process it owns, heaviest first (`memory_report`, `src/diagnostics.rs`).
Read it before optimizing anything:

- large app RSS, empty helper list → the app itself (webview and chat state are
  the usual suspects; see below);
- small app RSS, heavy helper list → helpers, and the question becomes whether
  they should still be running at all.

One thing the report cannot see: on macOS the WebKit content and GPU processes
are XPC services launched by `launchd`, not children of the app, so they are
outside the tree it walks. What the webview holds is measured from the frontend.

## Helper processes

Every helper Kore spawns is started in **its own process group** and torn down
through `src/process_tree.rs`, never with a bare `kill` on the process we
happen to hold:

```
snapshot the tree  →  SIGTERM the group and every pid in it
                   →  short grace period
                   →  SIGKILL the survivors
                   →  reap the root
```

The snapshot has to come first. Once the root dies the kernel re-parents its
children to `launchd`, and a tree that was findable a moment ago is not. The
process group is what makes the strays findable anyway.

The teardown runs on every exit an agent run or terminal has:

| Path | Trigger |
|---|---|
| `agent_cli_stop` | the chat's stop button, a conversation switch, a new chat, a graph switch (the frontend aborts, which stops the run) |
| end of an agent run | the CLI exited on its own — leftover MCP servers are swept |
| `pty_close` | the terminal view unmounts |
| `AgentCliState::terminate_all` / `PtyState::close_all` | `RunEvent::Exit` — the app is quitting |
| routine script timeout | the tick's deadline (`src/routine_script.rs`) |

A descendant that deliberately detaches itself (double-fork plus `setsid`)
leaves the tree by construction and is out of reach; nothing the supported CLIs
run does that today.

## The embedding model

`all-MiniLM-L6-v2` under ONNX is resident for as long as it is held, so it is
not held forever: after fifteen idle minutes the runtime releases it and
reports `unloaded`. The next semantic query reloads it from the local cache
inside `embed_texts` — a pure disk read, never a download.

Holding the model is not the expensive part — running it is. Peak allocation
during inference scales with `batch x seq^2`: the tokenizer pads each batch to
its longest member and truncates at the model's 512 positions, so a batch of
256 (fastembed's default, which the runtime does **not** use) materializes a
`256 x 12 heads x 512 x 512` f32 attention tensor of 3 GiB — and ONNX
Runtime's arena keeps whatever peak it reached for the life of the session.
`EMBED_BATCH_SIZE` in `src/embed.rs` caps that at 16, or 192 MiB, and the cap
lives in the runtime so no caller can raise it. Chunking holds up the other
end: `MAX_EMBEDDING_CHUNK_CHARS` bounds a single chunk, because one unbroken
run of text — a table, a code fence, pasted JSON — would otherwise pad its
whole batch to the 512-token ceiling.

`unloaded` is deliberately **not** `uninitialized`. An uninitialized runtime may
still owe the ~90MB first download, which only the explicit opt-in may start; an
unloaded one is available and one cache read away. Every consumer that gates on
"semantic search is available" must treat the two differently.

## Indexing

Bulk index passes accumulate whole projections — note text, asset text,
previews, every projection row — before applying them in one transaction. A
count alone is a poor bound on that (256 long notes is nothing like 256 daily
notes), so the batch flushes on **either** a count cap or a byte budget
(`INDEX_APPLY_BATCH_SIZE` / `INDEX_APPLY_BATCH_BYTES`). Path-only batches —
removals and mtime re-stamps — carry no note content and keep a larger
transaction size (`INDEX_PATH_BATCH_SIZE`).

## Chat

A restored conversation lives whole in memory: every turn's parts, tool results,
model messages, and inlined image attachments. `loadChatMessages` therefore
restores the most recent `CHAT_HISTORY_TURN_LIMIT` turns rather than all of
them. It costs no context — what the model sees is already trimmed to its
budget by `fitToContextWindow`, from the newest turn backwards — and nothing is
lost, because the full conversation stays in the database.

**Still open:** image attachments are persisted and held as base64 `data:` URLs
(`ChatAttachment.dataUrl`), which is both the `<img src>` and the provider
payload. Moving the bytes to disk and handing the UI a file URL would take them
off the heap entirely; it needs a storage location, a migration for existing
rows, and an async read on the send path, so it has not been done.

## Budgets

Targets, not guarantees — a change that pushes past one deserves a look before
it ships:

| State | Budget |
|---|---|
| Cold idle | < 400 MB |
| Normal vault, idle | < 700 MB |
| Editing / search | < 1 GB |
| Chat, normal use | < 1.2 GB |
| Indexing peak | < 1.5 GB |
| Agent running | < 2 GB app-owned |
| Growth over a 24h session | < 200 MB |

The last row is the one that catches leaks: a footprint that does not come back
down after an agent run finishes is a teardown that did not happen.
