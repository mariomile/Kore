//! The local embedding runtime (Plan 09): fastembed (ONNX) in-process, off the
//! UI thread. The model (all-MiniLM-L6-v2, 384-dim) is downloaded on demand
//! into app data — never bundled — and every failure degrades to a reported
//! "unavailable" state (the same recoverable contract as sqlite-vec): semantic
//! search is strictly additive, so nothing here may ever take the app down.
//!
//! The loaded model is not free to keep around — the ONNX session is resident
//! for as long as it is held — so it does not stay loaded forever. After
//! [`IDLE_UNLOAD_AFTER`] without an embed call the runtime releases it and
//! reports `unloaded`; the next semantic query reloads it from the local
//! cache inside `embed_texts`. That state is deliberately distinct from
//! `uninitialized`: a never-loaded runtime may still need the ~90MB download,
//! which only the explicit opt-in is allowed to start, while an unloaded one
//! is a pure cache read.

#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::ffi::{c_int, c_uint};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use hf_hub::api::sync::ApiBuilder;
use hf_hub::api::Progress;
use hf_hub::Cache;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::embed_batch;
use crate::error::{AppError, AppResult};

/// Identifier recorded per vector; changing the model bumps this and triggers
/// an embedding rebuild (`index_meta.embeddingModel` comparison in TS).
pub const MODEL_ID: &str = "all-MiniLM-L6-v2";

/// The hf-hub repo and files fastembed resolves for `AllMiniLML6V2`. Mirrored
/// here so the pre-download (the progress-reporting path) fills the exact
/// cache `try_new` reads. If fastembed ever changes its file set, the only
/// cost is that it downloads the difference itself — without progress.
const MODEL_REPO: &str = "Qdrant/all-MiniLM-L6-v2-onnx";
const MODEL_FILES: [&str; 5] = [
    "model.onnx",
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const ONNX_RUNTIME_DYLIB_RESOURCE: &str = "libonnxruntime.dylib";

/// Byte counts for an active model download. Absent until the download
/// starts (cache probing, or a cached model that skips downloading); after
/// the last byte it stays at 100% through the model-load phase.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteProgress {
    pub downloaded: u64,
    pub total: u64,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "status"
)]
pub enum EmbedStatus {
    /// No model loaded yet; `embed_ensure` will download/load it.
    Uninitialized,
    /// Download/load in progress (first run downloads ~90MB). The runtime
    /// keeps the latest byte counts, so polls and `embed:status` events
    /// report the same progress.
    Loading {
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<ByteProgress>,
    },
    /// `embed_texts` is ready; `model` is recorded per vector (rebuild key).
    Ready { model: String },
    /// Loaded earlier and released after idling. Semantic search is still
    /// available: the next query reloads the model from the local cache.
    Unloaded { model: String },
    /// Load failed; semantic search is unavailable (lexical still works).
    Failed { message: String },
}

#[derive(Default)]
enum Runtime {
    #[default]
    Uninitialized,
    Loading {
        progress: Option<ByteProgress>,
    },
    // fastembed's `embed` takes `&mut self`, so the model sits behind its own
    // Mutex — embed calls serialize, which batching makes irrelevant.
    Ready(Arc<Mutex<TextEmbedding>>),
    /// Released after idling — see the module docs.
    Unloaded,
    Failed(String),
}

/// Idle time after which the loaded model is released.
const IDLE_UNLOAD_AFTER: Duration = Duration::from_secs(15 * 60);

/// How often the idle watchdog re-checks. Coarse on purpose: releasing a
/// minute late costs nothing, and a busy timer would.
const IDLE_CHECK_EVERY: Duration = Duration::from_secs(60);

/// Process-wide embedding runtime state.
#[derive(Default)]
pub struct EmbedState {
    runtime: Mutex<Runtime>,
    requests: embed_batch::RequestQueue,
    loaded: tokio::sync::Notify,
    /// When the model was last loaded or used — the idle clock's zero.
    last_used: Mutex<Option<Instant>>,
    /// Whether the idle watchdog thread is already running.
    idle_watchdog: AtomicBool,
}

impl EmbedState {
    /// Restart the idle clock. Called around every embed and after a load.
    fn touch(&self) {
        if let Ok(mut stamp) = self.last_used.lock() {
            *stamp = Some(Instant::now());
        }
    }
}

fn lock_state<'a>(
    state: &'a State<'a, EmbedState>,
) -> AppResult<std::sync::MutexGuard<'a, Runtime>> {
    state.runtime.lock().map_err(|err| {
        tracing::error!(?err, "embed state lock poisoned by an earlier panic");
        AppError::io("embed state lock poisoned")
    })
}

fn status_of(runtime: &Runtime) -> EmbedStatus {
    match runtime {
        Runtime::Uninitialized => EmbedStatus::Uninitialized,
        Runtime::Loading { progress } => EmbedStatus::Loading {
            progress: *progress,
        },
        Runtime::Ready(_) => EmbedStatus::Ready {
            model: MODEL_ID.to_string(),
        },
        Runtime::Unloaded => EmbedStatus::Unloaded {
            model: MODEL_ID.to_string(),
        },
        Runtime::Failed(message) => EmbedStatus::Failed {
            message: message.clone(),
        },
    }
}

fn emit_status(app: &AppHandle, status: &EmbedStatus) {
    let _ = app.emit("embed:status", status);
}

/// Record download progress on the runtime state, so an `embed_status` poll
/// (e.g. a UI surface mounted mid-download) reports the same bytes as the
/// `embed:status` events. Only an in-flight load is updated — by the time a
/// stale progress callback could land, the state owns a terminal status.
fn store_progress(app: &AppHandle, progress: ByteProgress) {
    let state = app.state::<EmbedState>();
    let Ok(mut runtime) = state.runtime.lock() else {
        return;
    };
    if matches!(*runtime, Runtime::Loading { .. }) {
        *runtime = Runtime::Loading {
            progress: Some(progress),
        };
    }
}

/// How many newly-downloaded bytes accumulate between progress events — about
/// ninety events for the full model, comfortably few for the IPC channel yet
/// smooth enough for a progress bar.
const PROGRESS_EMIT_STEP: u64 = 1024 * 1024;

struct DownloadState {
    app: AppHandle,
    downloaded: u64,
    total: u64,
    emitted: u64,
}

impl DownloadState {
    fn emit(&mut self) {
        self.emitted = self.downloaded;
        let progress = ByteProgress {
            downloaded: self.downloaded,
            total: self.total,
        };
        store_progress(&self.app, progress);
        emit_status(
            &self.app,
            &EmbedStatus::Loading {
                progress: Some(progress),
            },
        );
    }
}

/// Cumulative byte progress across the whole file set, surfaced as
/// `embed:status` events. hf-hub takes the reporter by value per file, so the
/// shared tally lives behind an `Arc` and each download gets a clone.
#[derive(Clone)]
struct DownloadProgress(Arc<Mutex<DownloadState>>);

impl DownloadProgress {
    fn new(app: AppHandle, total: u64) -> Self {
        let mut state = DownloadState {
            app,
            downloaded: 0,
            total,
            emitted: 0,
        };
        // Surface the total before the first chunk lands, so the bar starts
        // at a real 0% instead of indeterminate.
        state.emit();
        Self(Arc::new(Mutex::new(state)))
    }
}

impl Progress for DownloadProgress {
    fn init(&mut self, _size: usize, _filename: &str) {}

    fn update(&mut self, size: usize) {
        let Ok(mut state) = self.0.lock() else {
            return;
        };
        state.downloaded += size as u64;
        if state.downloaded - state.emitted >= PROGRESS_EMIT_STEP || state.downloaded >= state.total
        {
            state.emit();
        }
    }

    fn finish(&mut self) {}
}

/// Fetch whatever model files are missing from the cache, with byte progress.
/// fastembed downloads these itself inside `try_new`, but silently; fetching
/// them first through the same hf-hub cache gives the UI a real progress bar
/// and leaves `try_new` a pure cache hit. Mirrors fastembed's resolution —
/// env overrides included — so both sides agree on location and endpoint.
fn download_model_files(app: &AppHandle, cache_dir: &Path) -> Result<(), String> {
    let cache_dir = std::env::var("HF_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| cache_dir.to_path_buf());
    let endpoint =
        std::env::var("HF_ENDPOINT").unwrap_or_else(|_| "https://huggingface.co".to_string());

    let cached = Cache::new(cache_dir.clone()).model(MODEL_REPO.to_string());
    let missing: Vec<&str> = MODEL_FILES
        .iter()
        .copied()
        .filter(|file| cached.get(file).is_none())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }

    let api = ApiBuilder::new()
        .with_cache_dir(cache_dir)
        .with_endpoint(endpoint)
        .build()
        .map_err(|err| format!("hf-hub api: {err}"))?;
    let repo = api.model(MODEL_REPO.to_string());

    // Size every missing file up front (HEAD-weight requests, ~nothing next
    // to the 90MB body) so the bar tracks one stable total instead of
    // restarting per file.
    let mut total: u64 = 0;
    for file in &missing {
        total += api
            .metadata(&repo.url(file))
            .map_err(|err| format!("sizing {file}: {err}"))?
            .size() as u64;
    }

    let progress = DownloadProgress::new(app.clone(), total);
    for file in missing {
        repo.download_with_progress(file, progress.clone())
            .map_err(|err| format!("downloading {file}: {err}"))?;
    }
    Ok(())
}

/// Ceiling on ONNX Runtime's intra-op threads.
///
/// fastembed asks for `available_parallelism()` per session — every core — so
/// a background backfill used to take the whole machine. Four is enough to
/// keep inference off the critical path while leaving the UI its cores.
const MAX_EMBED_THREADS: usize = 4;

/// Threads to give ONNX Runtime, never every core and never fewer than one.
fn embed_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|cores| cores.get().saturating_sub(1).clamp(1, MAX_EMBED_THREADS))
        .unwrap_or(1)
}

/// The QoS interface from `<pthread/qos.h>` and `<sys/qos.h>`
/// (macOS 10.10 / iOS 8.0), not bound by the `libc` crate yet.
/// `QOS_CLASS_UTILITY` is the class for progress the user is not waiting on,
/// which gives the scheduler a background-work hint, not core affinity.
#[cfg(any(target_os = "macos", target_os = "ios"))]
const QOS_CLASS_UTILITY: c_uint = 0x11;
#[cfg(any(target_os = "macos", target_os = "ios"))]
const QOS_CLASS_UNSPECIFIED: c_uint = 0x00;

#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    fn qos_class_self() -> c_uint;
    fn pthread_set_qos_class_self_np(qos_class: c_uint, relative_priority: c_int) -> c_int;
}

/// The current thread demoted to `utility` QoS until dropped.
///
/// Engaging before model load also gives newly created pool threads the
/// background scheduling context. Core placement remains an OS decision.
///
/// Restoring on drop matters for the same reason it does in `fs::io`: the
/// async runtime's blocking pool reuses threads, and a leaked demotion would
/// slow every later command that happened to land on this one.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) struct BackgroundQos {
    previous: c_uint,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl BackgroundQos {
    /// Demote the current thread; `None` when the kernel refuses (a thread
    /// carrying a QoS override cannot set its own class). Callers proceed
    /// undemoted then — the work still runs, just at the thread's own class.
    pub(crate) fn engage() -> Option<Self> {
        let previous = unsafe { qos_class_self() };
        if previous == QOS_CLASS_UNSPECIFIED {
            return None;
        }
        let set = unsafe { pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0) };
        (set == 0).then_some(Self { previous })
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl Drop for BackgroundQos {
    fn drop(&mut self) {
        unsafe {
            pthread_set_qos_class_self_np(self.previous, 0);
        }
    }
}

/// No thread QoS off Apple platforms; the guard is a no-op.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub(crate) struct BackgroundQos;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
impl BackgroundQos {
    pub(crate) fn engage() -> Option<Self> {
        Some(Self)
    }
}

/// Commit the process-wide ONNX Runtime environment, before any session
/// exists.
///
/// The global thread pool is the point of this: fastembed hard-codes
/// `with_intra_threads(available_parallelism())` on every session it builds
/// and exposes no way to change it, but a session created while the
/// environment owns a global pool uses that pool instead of its own. Bounding
/// it here needs no reach into fastembed's private session builder.
fn configure_onnx_runtime(app: &AppHandle) -> Result<(), String> {
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let environment = {
        let dylib = app
            .path()
            .resource_dir()
            .map_err(|err| format!("locating app resources: {err}"))?
            .join(ONNX_RUNTIME_DYLIB_RESOURCE);
        if !dylib.exists() {
            return Err(format!(
                "ONNX Runtime library is missing from app resources: {}",
                dylib.display()
            ));
        }
        tracing::info!(path = %dylib.display(), "loading bundled ONNX Runtime");
        ort::init_from(&dylib)
            .map_err(|err| format!("loading ONNX Runtime from {}: {err}", dylib.display()))?
    };
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    let environment = {
        let _ = app;
        ort::init()
    };

    commit_environment(environment)
}

/// Configure the same ONNX worker pool in the app and native experiments.
/// The one attempt this process makes at configuring ONNX Runtime, and how it
/// went. Every caller after the first reads the same outcome.
static ENVIRONMENT: OnceLock<Result<(), String>> = OnceLock::new();

/// Install the process-wide ONNX Runtime environment, once.
///
/// ONNX Runtime keeps only the *first* configuration a process offers it —
/// `commit` reports `false` for every later one. That makes the return value
/// load-bearing rather than cosmetic: a lost first commit leaves inference on
/// fastembed's defaults, every core with the workers spinning, which is
/// exactly what this configuration exists to prevent. Reporting `Ok` there
/// would hide the failure behind a runtime that looks configured and is not.
///
/// Later calls are not failures and must not be treated as any: `load_model`
/// runs again after every idle unload, and by then the environment is ours
/// and still installed. They reuse the first outcome instead of re-committing.
pub(crate) fn commit_environment(
    environment: ort::environment::EnvironmentBuilder,
) -> Result<(), String> {
    ENVIRONMENT
        .get_or_init(|| install_environment(environment))
        .clone()
}

fn install_environment(environment: ort::environment::EnvironmentBuilder) -> Result<(), String> {
    let threads = embed_thread_count();
    let pool = ort::environment::GlobalThreadPoolOptions::default()
        .with_intra_threads(threads)
        .map_err(|err| format!("sizing the ONNX Runtime thread pool: {err}"))?
        // Idle workers busy-wait by default, which is right for a server
        // running inference back to back and wrong here: embedding arrives in
        // bursts, and between them the spin keeps every pool thread hot.
        .with_spin_control(false)
        .map_err(|err| format!("disabling ONNX Runtime spin control: {err}"))?;

    if !environment.with_global_thread_pool(pool).commit() {
        return Err(
            "ONNX Runtime was configured before Kore could bound its thread pool".to_string(),
        );
    }
    tracing::info!(threads, "committed the ONNX Runtime environment");
    Ok(())
}

/// Current runtime status (poll on startup; live changes arrive on
/// `embed:status` events).
#[tauri::command]
pub fn embed_status(state: State<EmbedState>) -> AppResult<EmbedStatus> {
    Ok(status_of(&*lock_state(&state)?))
}

/// Ensure the model is loaded, downloading it on first use. Idempotent: a
/// concurrent call while loading returns immediately (the event stream carries
/// the outcome). Runs the load on a blocking thread — model init is seconds
/// even when cached, and the first run downloads.
#[tauri::command]
pub async fn embed_ensure(app: AppHandle, state: State<'_, EmbedState>) -> AppResult<EmbedStatus> {
    load_model(&app, &state).await
}

/// The load itself, shared by the explicit `embed_ensure` and the transparent
/// reload in `embed_texts`. Idempotent, and safe to race: a concurrent call
/// while loading returns the in-flight status.
async fn load_model(app: &AppHandle, state: &State<'_, EmbedState>) -> AppResult<EmbedStatus> {
    // Resolve the cache dir BEFORE flipping to Loading: it's the only step
    // here that may fail without a guaranteed state transition afterwards.
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::io(format!("no app data dir: {err}")))?
        .join("models");

    {
        let mut runtime = lock_state(state)?;
        match &*runtime {
            Runtime::Ready(_) | Runtime::Loading { .. } => return Ok(status_of(&runtime)),
            Runtime::Uninitialized | Runtime::Failed(_) | Runtime::Unloaded => {
                *runtime = Runtime::Loading { progress: None };
            }
        }
    }
    emit_status(app, &EmbedStatus::Loading { progress: None });

    // From here every path — success, load failure, even a panicked blocking
    // task — must land the state in Ready or Failed: an early `?` would wedge
    // the runtime in Loading forever (later ensures return early on Loading).
    let app_for_progress = app.clone();
    let loaded: Result<TextEmbedding, String> =
        match tauri::async_runtime::spawn_blocking(move || {
            // Before the runtime is configured: ONNX Runtime's pool threads
            // are created under this call and inherit the class.
            let _qos = BackgroundQos::engage();
            configure_onnx_runtime(&app_for_progress)?;
            download_model_files(&app_for_progress, &cache_dir)?;
            TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::AllMiniLML6V2).with_cache_dir(cache_dir),
            )
            .map_err(|err| err.to_string())
        })
        .await
        {
            Ok(result) => result,
            Err(err) => Err(format!("embedding load task panicked: {err}")),
        };

    let status = {
        let mut runtime = lock_state(state)?;
        *runtime = match loaded {
            Ok(model) => Runtime::Ready(Arc::new(Mutex::new(model))),
            Err(message) => {
                tracing::error!(message, "embedding model load failed");
                Runtime::Failed(message)
            }
        };
        status_of(&runtime)
    };
    if matches!(status, EmbedStatus::Ready { .. }) {
        // The idle clock starts at the load: a model loaded and never used is
        // exactly the case worth releasing.
        state.touch();
        arm_idle_unload(app);
    }
    emit_status(app, &status);
    state.loaded.notify_waiters();
    Ok(status)
}

/// Start the watchdog that releases an idle model, unless one is running.
///
/// One thread per load, not one for the app's life: it exits as soon as it
/// releases the model (or finds the runtime gone), and the next load arms a
/// fresh one.
fn arm_idle_unload(app: &AppHandle) {
    if app
        .state::<EmbedState>()
        .idle_watchdog
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(IDLE_CHECK_EVERY);
        let state = app.state::<EmbedState>();
        match unload_if_idle(&state, || {
            emit_status(
                &app,
                &EmbedStatus::Unloaded {
                    model: MODEL_ID.to_string(),
                },
            );
        }) {
            IdleCheck::Waiting => continue,
            IdleCheck::Released => {
                tracing::info!("released the idle embedding model");
                return;
            }
            IdleCheck::Gone => return,
        }
    });
}

/// What one watchdog tick concluded.
#[derive(Debug, PartialEq)]
enum IdleCheck {
    /// Still loaded and still in use (or in use recently).
    Waiting,
    /// The model was released; the runtime now reports `unloaded`.
    Released,
    /// Nothing left to watch — the runtime is no longer `Ready`.
    Gone,
}

/// Release the model if nothing has embedded with it for
/// [`IDLE_UNLOAD_AFTER`].
fn unload_if_idle(state: &EmbedState, on_release: impl FnOnce()) -> IdleCheck {
    let Ok(mut runtime) = state.runtime.lock() else {
        state.idle_watchdog.store(false, Ordering::SeqCst);
        return IdleCheck::Gone;
    };
    let Runtime::Ready(model) = &*runtime else {
        state.idle_watchdog.store(false, Ordering::SeqCst);
        return IdleCheck::Gone;
    };
    // An in-flight `embed_texts` holds its own clone of the model. Releasing
    // the state under it would be harmless (the Arc keeps the session alive
    // until that call returns) but it would report `unloaded` for a runtime
    // that is very much in use.
    if Arc::strong_count(model) > 1 {
        return IdleCheck::Waiting;
    }
    let idle_for = state
        .last_used
        .lock()
        .ok()
        .and_then(|stamp| *stamp)
        .map(|stamp| stamp.elapsed());
    match idle_for {
        Some(elapsed) if elapsed >= IDLE_UNLOAD_AFTER => {
            *runtime = Runtime::Unloaded;
            // Publish and disarm before another request can start reloading.
            // Otherwise the old watchdog can overwrite the new one's flag
            // or emit an obsolete Unloaded event after Loading/Ready.
            state.idle_watchdog.store(false, Ordering::SeqCst);
            on_release();
            IdleCheck::Released
        }
        _ => IdleCheck::Waiting,
    }
}

/// Await a concurrent load or reload a model released after idling.
///
/// Errors for a runtime that was never loaded: an embed call must not be able
/// to start the ~90MB first download, which belongs to the explicit opt-in
/// (callers gate on `embed_status`/`embed_ensure`).
async fn ready_model(
    app: &AppHandle,
    state: &State<'_, EmbedState>,
) -> AppResult<Arc<Mutex<TextEmbedding>>> {
    loop {
        let notification = state.loaded.notified();
        tokio::pin!(notification);
        notification.as_mut().enable(); // register before checking for a concurrent completion
        let reload = {
            let runtime = lock_state(state)?;
            match &*runtime {
                Runtime::Ready(model) => return Ok(Arc::clone(model)),
                Runtime::Unloaded => true,
                Runtime::Loading { .. } => false,
                Runtime::Failed(message) => return Err(AppError::io(message.clone())),
                Runtime::Uninitialized => {
                    return Err(AppError::io("embedding model is not loaded"))
                }
            }
        };
        if reload {
            load_model(app, state).await?;
        } else {
            notification.await;
        }
    }
}

/// Embed a batch of texts → 384-dim vectors, off the UI thread.
///
/// A model released after idling reloads here first — a pure read of the
/// local cache, so the only cost is the load itself.
#[tauri::command]
pub async fn embed_texts(
    app: AppHandle,
    texts: Vec<String>,
    state: State<'_, EmbedState>,
) -> AppResult<Vec<Vec<f32>>> {
    embed_batch::validate(&texts)?;
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let lease = state.requests.acquire().await?;
    let model = ready_model(&app, &state).await?;
    state.touch();
    let vectors = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let _qos = BackgroundQos::engage();
        let mut model = model
            .lock()
            .map_err(|_| AppError::io("embedding model lock poisoned"))?;
        embed_batch::embed(&mut model, &texts)
    })
    .await
    .map_err(|err| AppError::io(format!("embedding task panicked: {err}")))?;
    // Stamped again on the way out: a long backfill batch must not look idle
    // just because it started fifteen minutes ago.
    state.touch();
    vectors
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires an existing model cache; exercises real unload/reload cycles"]
    fn repeated_idle_release_preserves_active_requests() {
        let _qos = BackgroundQos::engage();
        let state = EmbedState::default();
        let texts = vec!["Project planning and memory. ".repeat(100); embed_batch::BATCH_SIZE];
        let cycles = crate::embed_bench::parameter("KORE_EMBED_BENCH_CYCLES", 20, 50);
        for cycle in 0..cycles {
            let model = Arc::new(Mutex::new(crate::embed_bench::cached_model()));
            *state.runtime.lock().unwrap() = Runtime::Ready(Arc::clone(&model));
            state.idle_watchdog.store(true, Ordering::SeqCst);
            state.touch();
            assert_eq!(
                unload_if_idle(&state, || panic!("recent model")),
                IdleCheck::Waiting
            );
            embed_batch::embed(&mut model.lock().unwrap(), &texts).unwrap();
            *state.last_used.lock().unwrap() = Some(Instant::now() - IDLE_UNLOAD_AFTER);
            assert_eq!(
                unload_if_idle(&state, || panic!("active request")),
                IdleCheck::Waiting
            );
            drop(model);
            let mut published = false;
            assert_eq!(
                unload_if_idle(&state, || {
                    assert!(!state.idle_watchdog.load(Ordering::SeqCst));
                    published = true;
                }),
                IdleCheck::Released
            );
            assert!(published);
            assert!(matches!(*state.runtime.lock().unwrap(), Runtime::Unloaded));
            crate::embed_bench::record("idle-released", "bounded", texts.len(), cycle, 0.0);
        }
    }
}
