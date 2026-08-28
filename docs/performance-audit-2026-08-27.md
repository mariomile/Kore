# Kore memory and performance audit

Incident captured: 2026-08-27, Europe/Rome. Remediation follow-up: 2026-08-28. Sections 1–8 preserve the original investigation; section 9 records the subsequent implementation and native experiments. The installed app has not been replaced.

## Executive conclusion

The dominant memory retained in the running app was traced to the native ONNX embedding runtime. Two allocations of **4,294,983,680 bytes each** were referenced by the **same `onnxruntime::BFCArena` and `InferenceSession`**. The native process reported **8.3G physical footprint**, with a **15.3G lifetime peak**. Its approximately 35 MiB RSS hid most of that footprint: `vmmap` reported 8.2G of writable memory swapped out.

This establishes the main owner of the observed retention. It does not establish which note or inference expanded the arena, how much arena capacity was internally reusable, or whether every other subsystem is free of leaks.

**The measured application was the installed Memento 0.28.9, not the current Kore source/build.** It predates the session-memory improvements in PR #57. Those changes must be tested on a current native build before making a before/after claim. Source inspection nevertheless identifies an unresolved peak-memory path: whole-note embedding requests, a default inference batch of 256, and intermediate outputs retained across batches within one library call.

Recommended order: measure native footprint correctly, reproduce with a controlled workload, bound embedding work at both request and inference boundaries, then tune arena behavior and idle synchronization. A frontend rewrite is not supported by this incident's evidence.

## 1. Scope and provenance

| Surface | Audited state |
|---|---|
| Source baseline | `7c1113c2`, the inspected `origin/master` snapshot: PR #58, desktop rename to Kore |
| Earlier performance change | `3588dbf45bb64b6298e122780bce07576f084050`, PR #57, session process and memory cleanup |
| Local documentation commit | `d72533f1 docs(planning): define the Kore personal OS architecture and roadmap` |
| Working branch | `docs/personal-os-planning`, documentation commit rebased onto the source baseline |
| Observed executable | `/Applications/Memento.app/Contents/MacOS/reflect-open` |
| Observed version and PID | `0.28.9`, PID `11878`, identifier `app.lore.desktop` |
| Host | ARM64, macOS 26.5.2 (`25F84`) |
| Process launch | 2026-08-27 20:05:53.269 +0200 |
| Observation window | Approximately 23:31–23:40 +0200 on the same day |

The original documentation changes were committed locally. Nothing was pushed. The initial read-only investigation did not modify application code, install dependencies, restart or upgrade the app, unload its model, rebuild its index, edit notes, or send note content to an external service. The later isolated implementation and tooling setup are documented in section 9.

The open graph was identified from the process's file handles. It was a **backup vault**, not the canonical Marioverse vault. SQLite inspection used read-only mode and `query_only`; only aggregates are recorded here. Note text, titles, and private graph paths are omitted.

Evidence labels used below:

- **Observed:** captured from the running process or its open database.
- **Source verified:** traced in the inspected source or the checksum-verified dependency source.
- **Hypothesis:** plausible mechanism or regression requiring an experiment.

## 2. What was measured

### Native process and WebKit

| Measurement | Result | Interpretation |
|---|---|---|
| Native physical footprint | `8.3G` | Memory charged to the native process, not just currently resident pages |
| Native lifetime footprint peak | `15.3G` | Historical peak; its triggering operation was not recorded |
| Native RSS from `ps` | `35,792 KiB`, approximately 35 MiB | A low resident set does not clear the process of substantial memory retention |
| Writable swapped-out memory | `8.2G` | Explains why RSS was misleading in this snapshot |
| Largest two live heap allocations | `4,294,983,680` bytes each | Each is 4 GiB + 16 KiB; allocated extents are not equivalent to resident bytes |
| WebContent PID `11882` footprint | `250.6M`, peak `601.6M` | Examined WebContent process; not an authoritative total for all app-owned WebKit processes |

`G` and `M` above preserve Apple's tool output; exact byte counts are provided where available. Do not add RSS, footprint, swapped bytes, and allocation sizes together: they describe overlapping aspects of memory.

WebContent PID `11882` launched at 20:05:53.558, within 0.3 seconds of the app. Association is inferred from timing. WebKit XPC services have `launchd` as their parent, so a process-tree walk does not prove ownership. Other apps' WebKit processes were present and were not attributed to Kore.

### Retention trace

The following sanitized excerpts preserve the decisive evidence independently of temporary diagnostic files:

```text
heap, PID 11878, 2026-08-27 23:34:18.585 +0200
Version:                   0.28.9 (0.28.9)
Physical footprint:        8.3G
Physical footprint (peak): 15.3G

0xc04000000: non-object (4294983680 bytes)
0xd04400000: non-object (4294983680 bytes)
```

Both blocks were inspected separately with `leaks --noContent --traceTree`. Reading the reverse-reference trees from allocation toward retaining objects gives:

```text
0xc04000000 [4294983680] -> container 0x9030ed7c0 [320], offset +160
0xd04400000 [4294983680] -> container 0x9030ed7c0 [320], offset +200

Both paths continue through:
onnxruntime::BFCArena                    0x905a9f700 [1280]
  -> intermediate allocation            0x90411d220 [160]
  -> onnxruntime::Graph                  0x905bacc00 [1536]
  -> shared ownership of ONNX Model      0x903f74380 [448]
  -> onnxruntime::InferenceSession       0x903e08000 [3584]
```

These are reference paths, not allocation-time stack traces. The tool uses conservative reference discovery; its many reported roots are not independent owners. `MallocStackLogging` was not enabled, so this capture cannot identify the allocating operation. The matching arena and session across both traces are strong evidence of the dominant retained allocation owner.

A short native stack sample found 11 ONNX worker threads waiting, alongside Rayon threads. This does not show a busy loop or prove the optimal thread count.

### Open graph aggregates

The following receipt was captured at 23:38:02 +0200 from the database held open by PID `11878`:

| Aggregate | Value |
|---|---:|
| Notes | 4,310 |
| Stored embedding chunks | 36,869 |
| Notes represented in embedding chunks | 1,384 |
| Maximum chunks in one note | 769 |
| Notes with at least 256 chunks | 30 |
| Maximum chunk length | 29,149 characters |
| Stored chat messages in this graph | 0 |
| Database file size, excluding WAL | 182,808,576 bytes |

These counts make large per-note embedding requests a realistic workload, but do not prove those notes caused this process's peak. The difference between total and embedded note counts is not a measured embedding failure rate: eligibility, empty content, and other states were not classified. An empty chat table in this graph says nothing about other graphs or earlier sessions. Database size on disk is not a RAM estimate.

## 3. What the previous improvement covers

PR #57 and [the existing memory budget](memory-budget.md) address several distinct problems:

| Existing measure | Remaining limit relevant to this audit |
|---|---|
| Process-group and descendant teardown for agent CLIs, terminal sessions, and routine scripts | Does not cap allocations inside the native embedding session |
| Unload the model after 15 idle minutes, checked every minute | Limits session lifetime, not inference peak; repeated activity can keep the arena alive |
| Index apply batches of 64 notes or an estimated 8 MiB | A separate indexing path; the byte estimate is a soft batching threshold, not a hard process-memory ceiling |
| Restore the latest 50 chat turns | A turn-count limit, not a byte limit or a cap on new turns accumulated during a live conversation |
| Settings memory diagnostics | Reports RSS and child-process RSS; misses the native footprint visible in this incident and cannot identify WebKit XPC ownership |

Source: [embedding lifecycle](../apps/desktop/src-tauri/src/embed.rs), [index batching](../packages/core/src/indexing/apply-batch.ts), [chat storage](../packages/core/src/ai/chat/store.ts), and [native diagnostics](../apps/desktop/src-tauri/src/diagnostics.rs).

The previous work remains useful. Its effect on this workload has not been measured because the running binary predates it. In particular, no current-build idle-unload or process-teardown experiment was performed.

## 4. Prioritized findings

### P0: Embedding work has no application-level memory bound

**Observed:** the dominant allocations belong to an ONNX arena/session in the installed process.

**Source verified:** [the embedding pipeline](../packages/core/src/embeddings/pipeline.ts), line 104, passes every changed chunk of a note to one `embedTexts` call. [The native command](../apps/desktop/src-tauri/src/embed.rs), lines 492–519, accepts a `Vec<String>` without count or byte admission limits, then calls `.embed(texts, None)` at line 511. A mutex serializes model execution; it does not bound the inputs held by waiting callers.

The exact locked dependency is `fastembed 5.13.2`, with `ort 2.0.0-rc.11`. The downloaded fastembed source archive matched the checksum in `Cargo.lock`:

```text
1f54fc1188b7f7eac8f47be2ab7b3a79ffd842cc8ff2e38316dd59ba4858890e
```

Its non-quantized model path defaults to **256 texts per inference batch** and a maximum sequence length of **512 tokens**. Tokenization pads to the longest sequence in each batch. `transform` collects all `SingleBatchOutput` values before `embed` pools and normalizes them. Relevant dependency locations are `src/text_embedding/mod.rs`, `src/text_embedding/impl.rs` lines 322–445, and `src/common.rs` lines 87–109 in the [verified crate archive](https://static.crates.io/crates/fastembed/fastembed-5.13.2.crate).

**Implication:** changing only `None` to `Some(16)` would reduce the size of an inference batch but still retain raw outputs from all batches in that call until export. A complete bound needs bounded outer calls, prompt output reduction/release, and input admission limits. It must also account for the whole-note text and final persistence payload.

**Hypothesis:** large requests expanded the arena to a high-water mark that remained retained after inference. ONNX Runtime documents that its CPU arena normally retains allocations for reuse; explicit arena configuration and optional shrinking change that behavior. This fits the trace but is not a controlled reconstruction of the peak. See [ONNX Runtime arena configuration](https://onnxruntime.ai/docs/get-started/with-c.html#features).

### P1: Chunk size is a target, not a hard limit

**Source verified:** [chunking](../packages/core/src/embeddings/chunk.ts), lines 23–87, targets 1,000 characters but flushes only after a complete sentence span. Long segments without recognized breaks remain oversized; tail merging can also increase a chunk's size.

**Observed:** one stored chunk is 29,149 characters long. Character length is not token length, but the code permits inputs that can exceed the tokenizer's 512-token truncation limit. Such inputs can also increase padding for neighboring texts in a batch.

The fix should preserve all source content through bounded chunks, valid offsets, and stable indexing semantics. Lowering the tokenizer limit alone could reduce memory while worsening retrieval by discarding more text. Search quality and long-tail content coverage must be acceptance gates.

### P1: Idle unload and synchronization need a joint lifecycle

**Source verified:** [embeddings synchronization](../apps/desktop/src/components/embeddings-sync.tsx) subscribes to index changes only while the model reports `ready` (lines 58–59 and 82–92). Cleanup clears pending changes and unsubscribes (lines 165–169). Returning to `ready` schedules another backfill (line 140).

The backfill reads and processes every non-template note. Hash matching skips unchanged inference, but does not skip note parsing, chunk hashing, and metadata application. Therefore, a rescan is **not** the same as re-embedding every note, but it still performs work.

**Hypothesis requiring a current-build test:** edits while unloaded can leave stored vectors stale until another consumer wakes the model and a rescan catches up. Repeated unload/reload cycles can then repeat graph-wide processing. Existing sync tests mock the model as ready and do not establish behavior across unload.

A durable-in-session, coalesced dirty-path queue should be independent of model residency, respect graph/index generations, and wake inference only when useful. This proposal needs lifecycle tests before implementation is accepted.

### P1: Diagnostics can report a reassuring number while memory pressure is severe

**Source verified:** [native diagnostics](../apps/desktop/src-tauri/src/diagnostics.rs), lines 29–85, reports RSS for the process and discovered descendants. [The settings field](../apps/desktop/src/components/settings/memory-field.tsx) displays these values; it does not supply WebKit heap measurements.

The incident is a direct counterexample to treating low app RSS as evidence that helpers must be responsible. A future diagnostics change should expose native physical footprint and peak, keep RSS separately labeled, and report unavailable measurements explicitly rather than as zero. WebKit ownership must be established separately or remain clearly unassigned. Apple's [`task_vm_info_data_t`](https://developer.apple.com/documentation/kernel/task_vm_info_data_t?language=occ) documents native memory fields; [WebKit's memory inspection guidance](https://docs.webkit.org/Infrastructure/MemoryInspection.html) covers its separate processes.

The explanatory shortcuts in `docs/memory-budget.md` should be corrected with that change. This audit intentionally does not rewrite them before the diagnostics contract is agreed.

### P2: Secondary paths deserve workload-specific tests

| Path inspected | Source-verified behavior | What remains unproven |
|---|---|---|
| [Asset protocol](../apps/desktop/src-tauri/src/fs/asset_protocol.rs), line 117 | Reads a requested asset into memory as a whole; this path has no explicit range or concurrent-byte budget | Contribution during large media use; not the owner of the traced 4 GiB blocks |
| [Archive import](../apps/desktop/src-tauri/src/fs/import.rs), lines 695–716 | Collects accepted archive entries and their bytes before returning | Peak with a large import; no import was replayed |
| [Live chat delivery](../apps/desktop/src/providers/chat-provider-deliver.ts), line 194 | Appends live turns; attachments can remain as base64 strings | Long-session growth; the measured graph contained no stored chat messages |

The inspected tabs hold route metadata rather than one retained editor per tab. Daily notes and the all-notes view use virtualization, and document bindings have disposal paths. No measurement currently justifies replacing those mechanisms. Meowdown internals were not comprehensively audited; the expected local checkout was absent. Editor latency, GPU usage, and large-media rendering remain outside the measured incident.

## 5. Implementation sequence to validate

This is a proposed sequence, not implemented work. No native API changes, dependency additions, migrations, or release are authorized by this document.

### Step 1: Establish a trustworthy current-build baseline

- Run a native build from the inspected source baseline against an isolated synthetic graph, with a cached model and external providers disabled.
- Capture native footprint, peak, RSS, model state, request count, input bytes, token-length distribution, inference duration, and queue depth. Exclude note content and credentials from logs.
- Measure the current build before applying a candidate change. Keep the 0.28.9 incident as evidence, not as an interchangeable benchmark baseline.
- Resolve WebKit ownership where supported; otherwise publish native, helper, and unassigned WebKit measurements separately. Do not manufacture an exact app-total figure.

### Step 2: Bound embedding input, intermediate tensors, and queued work

- Compare outer call sizes of 8, 16, and 32 texts. Keep library inference batches no larger than the outer call and release intermediate outputs between calls.
- Add explicit input count/byte limits and bounded native scheduling. Prioritize interactive queries over backfill at batch boundaries without starving indexing.
- Preserve ordered vectors and atomic note application. Check cancellation and graph generation between batches; never persist a partial or stale replacement chunk set.
- Add a hard chunking policy informed by the actual tokenizer limit, including oversized unbroken text, Unicode, and tail merging. Measure retrieval quality before changing established chunk semantics.
- Keep model identity, privacy gates, opt-in behavior, and evicted-file handling intact. `private: true` content must never be sent to an external service.

The simplest acceptable implementation should use the existing embedding stack. Do not introduce a separate service or runtime before a bounded in-process design has been measured.

### Step 3: Choose an arena and thread policy from measurements

Compare the existing arena against supported bounded, disabled, or shrink-enabled configurations, recording peak footprint, retained footprint, throughput, and query latency. An allocator limit is not automatically a process-memory limit; verify failure behavior as well as the happy path.

The locked fastembed wrapper does not expose every ONNX session option, and its thread count defaults to available parallelism. Do not assume a current upstream API is accessible through the locked version. Verify the exact integration surface before proposing a dependency or adapter change; dependency additions require approval. Retain idle unload as a lifecycle tool, not as the only defense against excessive peaks.

### Step 4: Make background work incremental across idle periods

Keep dirty-path tracking active independently of model residency, coalesce repeated edits, and avoid a full backfill on every ordinary reload. Explicit initial enable and repair may still need a full scan. Test disable, graph switch, deletion, errors, and cancellation while inference is in progress. Include a quiet period long enough to exercise the real 15-minute unload threshold and its one-minute watchdog cadence.

### Step 5: Address secondary costs only with corresponding evidence

If dedicated media/import/chat workloads exceed budgets, evaluate ranged or streamed asset reads, bounded archive processing, and bounded live-chat retention. These should be separate changes with their own correctness tests, not bundled into the embedding fix.

## 6. Experiment matrix and acceptance gates

All experiments below are **planned**, not completed. Use deterministic synthetic text, the same local model, the same hardware, and an isolated graph; never mutate the user's active vault to generate load.

| Scenario | Workload | Measurements and correctness gate |
|---|---|---|
| Cold and warm baseline | Empty graph, then a representative graph; first and repeated search | Startup, model-load time, native peak/steady footprint, search p50/p95 |
| Large-note inference | Notes producing 32, 256, and at least 769 chunks | Peak and retained footprint, chunks/second, complete ordered vector output |
| Long-tail inputs | Mixed short text and approximately 29k-character unbroken segments | Token distribution, padding, content coverage, valid source offsets |
| Interactive contention | Search while backfill is active | Search p95, queue depth, backfill progress, bounded pending inputs |
| Idle lifecycle | Complete work, idle beyond the unload window, edit, then search | Footprint after unload, fresh vectors, no unnecessary full-graph scan |
| Cancellation and graph switch | Cancel or switch during a large request | No writes to an obsolete generation, no partial replacement, bounded residual work |
| Repeated cycles | 20–50 identical load/search/backfill/idle cycles | Recovered footprint and absence of a continuing upward trend after warm-up |
| Soak | 24-hour scripted session after short experiments pass | Retained growth, helper cleanup, latency drift, background-work volume |

Record sample counts and variability; do not compare one cold run with one warm run. Track raw native peaks as well as post-work recovery. Set the acceptable throughput/latency tradeoff after obtaining a baseline, rather than claiming a batch size is optimal in advance.

The existing budget targets are: cold idle below 400 MB; normal-graph idle below 700 MB; editing/search below 1 GB; normal chat below 1.2 GB; indexing peak below 1.5 GB; agent-running app-owned memory below 2 GB; growth below 200 MB over 24 hours. These remain **targets, not verified achievements**. Before enforcing them, define decimal MB/GB, scenario boundaries, included processes, and treatment of shared memory. A native-only result must not be presented as an app-wide pass.

For the first remediation, require both a bounded peak on the large-note fixture and stable recovery over repeated cycles. Existing TypeScript tests alone cannot prove native allocator behavior.

## 7. Validation performed during this audit

These results belong to the inspected checkout during the original investigation; saving this report does not imply they were rerun against a remediation patch.

| Check | Result |
|---|---|
| `pnpm --config.verifyDepsBeforeRun=warn check` | Passed: TypeScript, formatting, lint. Existing max-lines warning in `note-editor.tsx` |
| `pnpm --config.verifyDepsBeforeRun=warn build` | Passed: desktop frontend and extension. Existing config/chunk warnings; missing Sentry token prevented release/source-map upload |
| Targeted core-node tests | Passed: 4 files, 40 tests covering embedding chunking/pipeline, index batching, and chat storage |
| Targeted WebKit browser tests | Did not run: installed Playwright WebKit executable was missing after retrying the initial sandbox bind failure |
| Rust build/tests | Not run: `cargo` was unavailable on PATH; no native toolchain installation attempted |
| Native controlled before/after benchmark | Not run |
| Live diagnostics | `ps`, `vmmap`, heap summary, two reference traces, short stack sample, and read-only database aggregates collected |

The initial plain `pnpm check` and `pnpm build` attempts stopped at `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` while pnpm tried to reconcile dependency metadata. The per-command `verifyDepsBeforeRun=warn` override allowed the checks to use installed dependencies without changing persistent configuration. This is an environment qualification on the successful checks, not proof of a fresh lockfile installation.

Targeted core command:

```sh
pnpm --config.verifyDepsBeforeRun=warn test --run \
  packages/core/src/embeddings/chunk.test.ts \
  packages/core/src/embeddings/pipeline.test.ts \
  packages/core/src/indexing/apply-batch.test.ts \
  packages/core/src/ai/chat/store.test.ts --project core-node
```

Blocked browser command:

```sh
REFLECT_TEST_BROWSER=webkit pnpm --config.verifyDepsBeforeRun=warn test --run \
  apps/desktop/src/components/embeddings-sync.test.tsx \
  apps/desktop/src/components/settings/memory-field.test.tsx \
  apps/desktop/src/lib/semantic.test.tsx --project browser
```

## 8. Evidence archive and reproduction notes

The decisive excerpts and aggregates are embedded above. The following originals are temporary local files and may disappear; they are not required to read this report. SHA-256 receipts allow checking surviving artifacts without committing raw process dumps or private graph content.

```text
/tmp/kore-memory-11878.vmmap.txt
b1614e1db845fe5d4579722ed16964335460939e9b1d24d24ae435871e4128c5

/tmp/kore-memory-11882.vmmap.txt
c5dd3c05becba8dc6513663f53df94a8e3aa5415b1cc7b5ba6576111a7b5cd4d

/tmp/kore-memory-11878.heap.txt
8c38cbdd2bd65fe4bc1e708768e0b736135d0cbd42d1e9f9732cb5937feafe2b

/tmp/kore-memory-11878.references.txt
97f080f7cfba165c86018570b8442af10a2562c818b2620fac16fb48b879726e

/tmp/kore-memory-11878.references-second.txt
86592b3e735d420553946d043142a08dc4a9a1396692468b8e09e69369b72230

/tmp/kore-memory-11878.metrics.json
6f65dba6a11ca76bc40380c81957fbcfefaec96232e54d645752f7575ce87d56
```

The supplementary sample is `/tmp/kore-memory-11878.sample.txt`. Dependency source was inspected under `/tmp/kore-audit-crates/fastembed-5.13.2/`; its archive checksum is recorded in finding P0.

For a future capture, resolve the current executable and PID first; the PIDs and allocation addresses in this report are historical. Record version, source SHA, launch time, workload, and timestamps. Use content-free heap/reference inspection and aggregate-only database queries. Allocation-time tracing or profiling can perturb the workload and needs a controlled run; do not silently relaunch the user's app with debugging settings.

## Initial decision to carry forward

Prioritize a measured, bounded native embedding path and trustworthy footprint diagnostics. Keep idle unload, helper cleanup, and frontend lifecycle work, but do not treat them as evidence that inference peaks are controlled. The first implementation milestone is a current-build baseline plus a reproducible large-note regression case; the incident is not resolved until a candidate passes native peak, recovery, latency, and retrieval-correctness checks.


## 9. Remediation and controlled native experiments, 2026-08-28

### Scope of the implementation

The implementation is isolated in branch `fix/embedding-memory-verified`,
worktree `/private/tmp/kore-memory-verified`, based on
`b7e6b2380713ddd7f3ac9e7f46ba4f4d187d0969` (desktop manifest 0.30.0).
That source still used `.embed(texts, None)`. While this task was interrupted,
another session changed the original checkout, including icons and an ONNX
thread-pool proposal. Those changes were not reverted. The isolated patch
includes bounded chunking/inference and cancellation from that in-progress
work, plus the native admission queue, lifecycle corrections, diagnostics and
regression experiments completed here. It excludes icon changes, the added
direct `ort` dependency, QoS changes and global thread-pool configuration.

No production dependency, model identity, schema, release version or provider
was changed. The installed application and active vault were not modified.
The initial planning commit remains `d72533f1`; no push was performed.

Implemented protections:

- Four texts per native request and library call; 128 KiB total UTF-8 input
  admission limit, eight admitted requests maximum and FIFO execution.
  Cancellation cannot release an active blocking worker's queue lease early.
- Chunking bounds unbroken text at 1,500 UTF-16 units without dropping source
  content or splitting surrogate pairs. Atomic note replacement keeps vector
  order and checks cancellation before writing, including empty-note removal.
- Synchronization continues through unload/loading and does not backfill the
  whole graph again on ordinary reload. Native callers await a concurrent
  load. Idle release protects active model references and publishes/disarms
  before a new load can race the old watchdog.
- Native physical footprint and lifetime peak are shown separately from RSS.
  Failed observations are unavailable, and failed helper discovery is explicit.
  No WebKit ownership or exact app-wide total is claimed.

See [memory budgets and reproduction](memory-budget.md) for the boundary
contracts, source locations, commands and opt-in native tests.

### Measurement method and results

The same real cached MiniLM model and locked fastembed 5.13.2 / ort
2.0.0-rc.11 runtime were used in fresh macOS ARM64 processes. The Rust harness
was compiled in the debug test profile with Rust 1.98.0; ONNX is the packaged
native dependency. This is a controlled **native model benchmark**, not an
installed Tauri application or end-to-end graph/search measurement.

Synthetic inputs intentionally reach the tokenizer's 512-position ceiling,
even though the application now emits shorter chunks. `baseline` reproduces
the old source call, while `bounded` uses the same helper as production. Five
passes per 32-text process separate warm-up from repeated work. The 769-text
case repeats three times. No benchmark reads notes, writes an index or calls
an external provider. The model cache is verified before loading.

All MB/GB below are decimal. Footprint is read from native resource accounting;
peak is the process's lifetime maximum, including transients between samples.

| Experiment | Passes | Peak native footprint | Median inference per pass | Warm single-query inference |
|---|---:|---:|---:|---:|
| Baseline, 32 long texts in one call | 5 | 2,848.12 MB | 1,187.00 ms | 2.33–2.79 ms |
| Bounded, the same 32 texts in groups of 4 | 5 | 514.90 MB | 1,090.39 ms | 2.26–2.49 ms |
| Bounded, 769 long texts in groups of 4 | 3 | 524.58 MB | 25,759.37 ms | 2.31–2.60 ms |

The paired 32-text experiment reduced native peak by **81.9%**. Inference
throughput did not regress in this sample: baseline passes ranged from
1,071.08–1,269.27 ms, versus 1,088.01–1,109.26 ms with the candidate. Five
samples are not enough to claim a universal speedup or reliable p95. The
warm-query figures exclude UI, queueing, IPC and database retrieval.

The 769-text run completed every vector with finite 384-dimensional output.
Its peak is only about 10 MB above the 32-text candidate, supporting the
intended bounded inference behavior as note size grows. This is not a
replay of the incident's entire 4,310-note graph or proof of its historical
15.3G peak's exact trigger.

Recovery must be described separately. Thirty seconds after session drop,
the baseline still reported 2,847.85 MB and the 32-text candidate 514.62 MB.
The 769-text candidate reported 471.58 MB at the same 30-second point.
Dropping the model does not immediately return the process to its pre-load
footprint. An earlier eight-text exploratory run had no live allocations of
16 MiB or larger and reported 18.1 MiB footprint during heap inspection roughly
37 seconds after launch; because inspection can perturb allocator behavior,
that observation is not a passive recovery-time guarantee.

### Verification and remaining boundaries

- `pnpm check`: TypeScript, formatting and lint passed. The existing
  `note-editor.tsx` max-lines warning remains.
- `pnpm build`: desktop frontend and extension passed. Existing Vite config
  and large-bundle warnings remain; absent Sentry credentials skipped release
  and sourcemap upload, not local compilation.
- Core regression tests: 47 passed across chunking, embedding pipeline,
  index batching and chat storage. Includes cancellation during the final
  inference and while reading an emptied note.
- WebKit component tests: 21 passed across synchronization, memory diagnostics
  and semantic status behavior.
- Browser-preview bridge tests: six passed, including the public memory-report
  schema and explicit unavailable native measurements (74 JavaScript tests
  across all targeted suites).
- Native queue/input and process-accounting tests: three passed; diagnostic
  process-tree tests: two passed after allowing process inspection outside
  the sandbox. The initial sandbox run could not inspect its own RSS.
- Native vector parity: passed for 33 mixed short/long/multilingual texts;
  all baseline/candidate cosine similarities exceeded 0.99999.
- Native lifecycle: 20 real cached-model load/inference/idle-release cycles
  passed, including protection of an active request and watchdog disarming.
  Peak was 444.24 MB; final post-release footprint 443.97 MB.
- Extended native lifecycle: 50 cycles passed in a fresh process. Peak was
  432.83 MB, final footprint 335.50 MB, and the last 20 post-release samples
  ranged from 332.07–335.50 MB. This bounded short run does not certify a
  24-hour session or the timer's real wall-clock delay.
- `cargo build -p reflect-open --locked --offline`: passed for the native
  desktop executable, after staging sidecars. The executable was not launched
  against the user's graph, installed, signed or published.

The worktree used cloned installed dependencies with a per-command pnpm
`verifyDepsBeforeRun=warn` override, not a fresh lockfile installation. Its
missing extension-generated types were restored by the existing `wxt prepare`
command; no source workaround was added. WebKit was installed for the earlier
verification, and an isolated Rust toolchain and locked Cargo dependencies
were installed under `/tmp`. No global Rust installation was required.

Not certified by this change: a 24-hour soak, full GUI session with the real
15-minute watchdog delay, app-wide/native-plus-WebKit memory budgets,
interactive search p95 during contention, representative retrieval relevance,
or Intel/Windows/Linux/iOS runtime behavior. The character bound is not a
512-token guarantee for multilingual text. Heavy media, archive imports and
live-chat attachment retention remain the separately scoped P2 work above.

The local native peak regression has a measured correction. Deployment and
observing the installed app on the real workload remain separate steps; the
0.28.9 incident must not be described as fixed on the user's machine yet.


### Remediation evidence receipts

The result tables above are durable; raw local experiment logs are temporary.
These files contain synthetic workload metadata and process measurements,
not note content. SHA-256 allows checking surviving copies:

```text
/tmp/kore-verified-baseline32.jsonl
be4890c2bc3e2301aa4ae9ef6db82857aeb4950bf535e582eea8e5243113b0e2

/tmp/kore-verified-bounded32.jsonl
c1084e7fd65901b9ca2e00ae9f867840aebcee47e7a178f93cc3bac0b5e77a59

/tmp/kore-verified-bounded769.jsonl
8719759afd25cea2a99892170920aa6820de661a17bb5bdd68f22b3fe86dc0a6

/tmp/kore-verified-lifecycle20.jsonl
afc75ceff9695c7209d1c0e2fec57700bedaa6b4742c9f3e765152c3f2217368

/tmp/kore-verified-lifecycle50.jsonl
9d44380416656db956b9f61ffc444c650445a970ad1e5d9a0b32aab1dbfe3bc7

/tmp/kore-verified-parity33.txt
1906b3de562149c42ffed652d3791f16c5b7646cea3f0eba4bf7d6587a0d748e
```


## 10. Integration with released Kore 0.30.1

The integration merges `38ccd9f0` (Kore 0.30.1, including PR #61) into
`fix/embedding-memory-verified`. It retains the released global ONNX pool
of at most four workers, disabled idle spinning and background QoS. No
version, release assets, icons or dependencies change relative to 0.30.1.
The earlier section 9 measurements used a different thread policy and remain
historical evidence, not measurements of this integrated tree.

The native harness now shares the production environment setup. `release`
reproduces 0.30.1's outer and internal batches of 16; `bounded` uses the
integrated production helper with batches of four. Both use the same CPU
policy, model, synthetic texts, hardware and fresh-process isolation.
Vector parity compares 0.30.1-style batches of 16 against batches of four.

Integrated verification results are recorded below. The
release check confirmed that 0.30.1's installed executable matched its GitHub
asset, but the running graph had only four notes; that idle observation was
not a representative indexing benchmark. These experiments do not mutate
the user's graph or certify an app-wide/24-hour memory budget.


| Integrated experiment | Passes | Peak footprint (decimal MB) | Median inference (ms) |
|---|---:|---:|---:|
| release32 | 5 | 1455.72 | 1151.12 |
| bounded32 | 5 | 509.15 | 1215.03 |
| bounded769 | 3 | 525.93 | 26718.76 |

The paired 32-text case lowers peak footprint by 65.0%, with a 5.6% higher
median inference time in this five-pass sample. It is a memory/throughput
tradeoff, not a claim that all operations became faster. At 30 seconds after
model drop, release32 reported 20.66 MB, bounded32 22.95 MB, and bounded769
388.56 MB; recovery varies with allocator and OS behavior.

Vector parity passed for 33 mixed texts. Fifty real load/inference/release
cycles passed, peaking at 440.44 MB; the last 20 post-release
samples ranged from 352.91 to 417.55 MB.
The macOS/iOS resource-accounting capability from 0.30.1 is preserved.

Local checks passed: 53 node/core tests, 21 WebKit tests, five native
queue/accounting/diagnostics tests, native parity and lifecycle experiments,
`pnpm check`, `pnpm build`, `cargo fmt --all -- --check` and the desktop
native build. Existing note-editor length, Vite and missing-Sentry-token
warnings remain. JavaScript checks used the previously documented pnpm
metadata override; no dependency versions were changed.

Temporary integrated experiment receipts (SHA-256):

```text
/tmp/kore-integrated-release32.log
84070f37d77224e20b08f979c8c760b649c8a8f832f8b5cb6ae4c1c0a3c09663

/tmp/kore-integrated-bounded32.log
852269bdcde559fc7cd29c235be957f2a6923fd1325907535edb14e7ebca6400

/tmp/kore-integrated-bounded769.log
e4b6f4b68bdaa23662974348e6e24563795326520ab12a3eea2cf4b575a73e22

/tmp/kore-integrated-parity33.log
aa210a92f0e33a753242b37cd37ec6160361ba52d8ee9641b5fcb4127c57842c

/tmp/kore-integrated-lifecycle50.log
100bca323b9fb023fe9d36465149580dbd46f1e4f33a03d2c31a8ee87e172768
```
