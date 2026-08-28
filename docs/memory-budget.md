# Memory: where it goes, and what holds it down

Kore uses a native Tauri process, WebKit services, and optional helper
processes. Account for them separately. RSS measures resident pages; on macOS
physical footprint also accounts for charged nonresident memory. A process
with little RSS can still retain gigabytes. See the
[incident and remediation report](performance-audit-2026-08-27.md).

## Measure first

**Settings → About → Memory** reports native physical footprint, lifetime peak,
native RSS, and helper RSS (`memory_report`, `src/diagnostics.rs`).

- High native footprint identifies native retention even when RSS is small.
- Heavy helper RSS identifies subprocess memory, not allocations in Kore.
- Missing observations show `Unavailable`; failed process discovery is not
  reported as a healthy empty helper list.

On macOS, footprint and peak come from `proc_pid_rusage(RUSAGE_INFO_V4)`.
Other platforms return unavailable for these fields. Do not add footprint,
RSS, and peak: they overlap, and peak is historical.

WebKit content and GPU processes are XPC services launched by `launchd`, not
children of Kore. The report cannot establish their ownership or an app-wide
total. Use a separately attributed native WebKit capture; JavaScript heap
measurements are neither universally available nor a complete webview footprint.

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

The native runtime uses `all-MiniLM-L6-v2` through fastembed/ONNX Runtime.
The session owns the ONNX arena, which can retain its inference high-water
allocation. Limiting only the library's internal batch size is insufficient:
fastembed 5.13.2 collects raw batch outputs until the entire call is pooled.

The production bounds are:

| Boundary | Limit and behavior |
|---|---|
| TypeScript inference request | At most 4 texts (`EMBEDDING_BATCH_SIZE`) |
| Native inference request | At most 4 texts and 128 KiB total UTF-8 input; reject before model work |
| Native library call | One request per call, `Some(4)`; raw outputs cannot accumulate across an entire note |
| Native queue | At most 8 admitted requests, FIFO execution; overload is an explicit error |
| Blocking worker | One inference at a time; its admission lease survives caller cancellation until work finishes |
| Chunk length | At most 1,500 UTF-16 code units, including long unbroken spans and tail merging |
| Persistence | Ordered vectors accumulated per note, followed by one generation-pinned atomic replacement |
| Cancellation | Checked before work, between inference requests, and before replacement/removal |

The chunk limit preserves source offsets and surrogate pairs, but is **not a
token limit**. Dense multilingual text may still reach the tokenizer's
512-position truncation ceiling. The inference batch bound protects memory
at that maximum sequence length. Token-aware chunking and retrieval quality
for such text remain a separate correctness evaluation.

After fifteen idle minutes (checked once per minute), the runtime drops its
session and reports `unloaded`. An active request's model reference prevents
release. The watchdog disarms and publishes `unloaded` under the state lock,
so a concurrent reload cannot be followed by an obsolete unload event.

`unloaded` is distinct from `uninitialized`: only explicit opt-in can start
the initial model download. An embedding request can reload an already used
model and waits for a concurrent load to finish. Synchronization keeps following
note changes while the model is unloaded/loading; normal unload/reload no
longer starts another whole-graph backfill. Disabling semantic search or
switching graphs cancels pending work at request boundaries.

Dropping the session does not guarantee an immediate footprint decrease:
allocator and OS accounting can recover later. Measure release over time and
across repeated cycles instead of calling one high post-drop sample a leak.
Thread-pool, QoS and arena configuration remain unchanged in this patch; no
production dependencies are added.

### Reproduce the native experiments

These ignored tests require macOS and an **already cached** model. They use
synthetic text, never open a graph or send note content to a provider. The
cache check fails if model files are missing. Run each experiment alone in a
fresh process; concurrent builds distort latency comparisons.

Stage the existing sidecars once per checkout, then build the test binary:

```sh
pnpm --filter @reflect/desktop sidecar
cargo test -p reflect-open --lib --locked --no-run
```

Set `KORE_EMBED_BENCH_CACHE` to the populated `models` directory under the
app's data directory. Use the test executable path printed by Cargo (named
`target/debug/deps/reflect_open_lib-<hash>`):

```sh
export KORE_EMBED_BENCH_CACHE='/path/to/existing/model/cache'
export KORE_EMBED_BENCH_BINARY='target/debug/deps/reflect_open_lib-<hash>'
KORE_EMBED_BENCH_MODE=baseline KORE_EMBED_BENCH_TEXTS=32 KORE_EMBED_BENCH_CYCLES=5 \
  "$KORE_EMBED_BENCH_BINARY" embed_bench::native_embedding_memory --ignored --exact --nocapture --test-threads=1
KORE_EMBED_BENCH_MODE=bounded KORE_EMBED_BENCH_TEXTS=32 KORE_EMBED_BENCH_CYCLES=5 \
  "$KORE_EMBED_BENCH_BINARY" embed_bench::native_embedding_memory --ignored --exact --nocapture --test-threads=1
KORE_EMBED_BENCH_MODE=bounded KORE_EMBED_BENCH_TEXTS=769 KORE_EMBED_BENCH_CYCLES=3 \
  "$KORE_EMBED_BENCH_BINARY" embed_bench::native_embedding_memory --ignored --exact --nocapture --test-threads=1
"$KORE_EMBED_BENCH_BINARY" embed_bench::bounded_batches_preserve_vectors --ignored --exact --nocapture --test-threads=1
KORE_EMBED_BENCH_CYCLES=50 "$KORE_EMBED_BENCH_BINARY" embed::tests::repeated_idle_release_preserves_active_requests --ignored --exact --nocapture --test-threads=1
```

`baseline` reproduces the source's previous `embed(texts, None)` call; for
machine safety it refuses more than 64 texts. `inference16` is an optional
intermediate experiment, not the checked-in baseline. `bounded` exercises
the production request helper. The synthetic texts deliberately reach the
maximum token sequence length. Every inference checks vector count,
dimension and finite values. The parity test compares 33 mixed texts against
the baseline with cosine similarity above 0.99999. The lifecycle test forces
the idle timestamp, checks active-reference protection and repeats 20 releases by default (50 with the command above);
it does not wait 15 minutes or exercise a full GUI session.

JSON records include PID, workload size, timing, footprint, peak and RSS;
post-drop samples occur at 1, 5, 15 and 30 seconds. Keep records and a source
revision with any result. These are native model experiments, not app-wide
memory or end-to-end search latency measurements.

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

Use decimal MB/GB for these targets and name the included processes. The
incident remediation experiments measure only the native test process, so
they cannot certify these app-wide targets or the 24-hour row. Persistent
growth is a signal to inspect retained owners, not proof of a specific leak
or failed teardown.
