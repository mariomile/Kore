//! Link-capture primitives (Plan 11): the capture-inbox commands the drain
//! action composes, the screenshot promote/downscale step, the bounded
//! meta-scrape fetch, and the native-messaging plumbing (pointer file +
//! browser host manifests) that lets the `kore-capture-host` sidecar spool
//! captures while this app is closed. Policy — what gets written where, the
//! privacy gate, enrichment — lives in `@kore/core` (`actions/capture`);
//! this module only moves bytes.

use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use tauri::{Manager, State};

use crate::error::{AppError, AppResult};
use crate::fs::{current_root, modified_ms, root_for_generation, FileMeta, GraphState};

/// The native-messaging host name browsers route on; must match the name the
/// extension passes to `runtime.sendNativeMessage`.
#[cfg(any(target_os = "macos", test))]
const HOST_NAME: &str = "app.kore.capture";

/// The host name before the Kore rename; its manifest is removed when the new
/// one is written, so browsers list one Kore host.
#[cfg(any(target_os = "macos", test))]
const LEGACY_HOST_NAME: &str = "app.reflect.capture";

/// The sidecar binary, staged beside the app binary by the Tauri bundler (and
/// beside the dev binary by `tauri dev`).
#[cfg(target_os = "macos")]
const HOST_BINARY: &str = "kore-capture-host";

/// Extension IDs allowed to launch the host. The first is the dev/unpacked ID,
/// pinned by the `key` field in `apps/extension/wxt.config.ts`; the second is
/// the published Chrome Web Store listing.
#[cfg(any(target_os = "macos", test))]
const EXTENSION_ORIGINS: [&str; 2] = [
    "chrome-extension://dlbliojklpickgimjdmjjdnbjdiomjik/",
    "chrome-extension://ccabifmooehighoonjeiololjfofkhkd/",
];

/// Graph-relative spool directory the host writes and the drain reads.
pub(crate) const INBOX_DIR: &str = ".kore/inbox";

// ---- pointer file ------------------------------------------------------------

/// Where the host discovers the active graph. Same app-data directory as
/// `settings.rs`/`recents.rs`; the shape is versioned so a future change reads
/// as a typed host error, never a silent mis-spool.
fn pointer_path() -> AppResult<PathBuf> {
    Ok(crate::app_dir::app_config_dir()?.join("capture-pointer.json"))
}

fn pointer_json(root: &Path) -> String {
    serde_json::json!({
        "version": 1,
        "graphRoot": root.to_string_lossy(),
    })
    .to_string()
}

// Also used by `skill.rs` for the agent-skill files under `~/.agents/`.
pub(crate) fn atomic_write_to(path: &Path, contents: &str) -> AppResult<()> {
    atomic_write_bytes_to(path, contents.as_bytes())
}

fn atomic_write_bytes_to(path: &Path, contents: &[u8]) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::io(format!("no parent directory for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents)?;
    // Synced before the rename, or a system crash shortly after can leave the
    // renamed file empty (the rename reaches the disk before the data). The
    // inbox holds captures that exist nowhere else until the drain runs.
    tmp.as_file().sync_all()?;
    tmp.persist(path)
        .map_err(|err| AppError::io(err.to_string()))?;
    Ok(())
}

// ---- browser manifests (macOS) ------------------------------------------------
//
// Everything here is `cfg(target_os = "macos")` (plus `test`, so the rules
// stay unit-tested on every CI platform): the first release registers
// manifests on macOS only — Windows registry keys and Linux paths land with
// Plan 15 packaging.

/// The native-messaging manifest content for a host binary at `host_path`.
#[cfg(any(target_os = "macos", test))]
fn host_manifest_json(host_path: &Path) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": HOST_NAME,
        "description": "Kore link capture",
        "path": host_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": EXTENSION_ORIGINS,
    }))
    .expect("static manifest serializes")
}

/// Chromium-family browser data dirs under `~/Library/Application Support`
/// that may carry a `NativeMessagingHosts/` directory. Arc keeps its own under
/// `User Data`, matching Chrome's profile layout.
#[cfg(any(target_os = "macos", test))]
const MACOS_BROWSER_DIRS: [&str; 10] = [
    "Google/Chrome",
    "Google/Chrome Beta",
    "Google/Chrome Dev",
    "Google/Chrome Canary",
    "Chromium",
    "Microsoft Edge",
    "BraveSoftware/Brave-Browser",
    "Vivaldi",
    "com.operasoftware.Opera",
    "Arc/User Data",
];

/// `NativeMessagingHosts/` dirs for browsers actually present under
/// `app_support` — manifests are only written for detected browsers (spraying
/// them for uninstalled ones is the Claude-Desktop mistake the spike calls
/// out). Pure given the base dir, so the detection rule is unit-testable.
#[cfg(any(target_os = "macos", test))]
fn detected_manifest_dirs(app_support: &Path) -> Vec<PathBuf> {
    MACOS_BROWSER_DIRS
        .iter()
        .map(|dir| app_support.join(dir))
        .filter(|dir| dir.is_dir())
        .map(|dir| dir.join("NativeMessagingHosts"))
        .collect()
}

/// Write (or rewrite) the host manifest for every detected browser. Runs on
/// every launch and graph switch — rewriting self-heals app moves and macOS
/// app translocation, per the bridge spike.
#[cfg(any(target_os = "macos", test))]
fn register_manifests(app_support: &Path, host_path: &Path) -> AppResult<usize> {
    let manifest = host_manifest_json(host_path);
    let mut written = 0;
    for dir in detected_manifest_dirs(app_support) {
        fs::create_dir_all(&dir)?;
        atomic_write_to(&dir.join(format!("{HOST_NAME}.json")), &manifest)?;
        match fs::remove_file(dir.join(format!("{LEGACY_HOST_NAME}.json"))) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                tracing::warn!(%error, "could not remove the legacy capture host manifest");
            }
            _ => {}
        }
        written += 1;
    }
    Ok(written)
}

/// The staged host binary, next to the running executable in both dev
/// (`target/debug/`) and the bundle (`Reflect.app/Contents/MacOS/`).
#[cfg(target_os = "macos")]
fn host_binary_path() -> AppResult<PathBuf> {
    let exe = std::env::current_exe().map_err(|err| AppError::io(err.to_string()))?;
    let dir = exe
        .parent()
        .ok_or_else(|| AppError::io("executable has no parent directory"))?;
    Ok(dir.join(HOST_BINARY))
}

/// Point the capture host at the active graph and register browser manifests.
/// Called by the frontend after every graph open. Manifest registration is
/// macOS-only for now (the first release ships macOS; Windows registry keys
/// and Linux paths land with Plan 15 packaging).
#[tauri::command]
pub async fn capture_host_register<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    crate::blocking::run_blocking(move || capture_host_register_for(&app.state::<GraphState>()))
        .await
}

fn capture_host_register_for(state: &State<'_, GraphState>) -> AppResult<()> {
    let root = current_root(state)?;
    fs::create_dir_all(root.join(INBOX_DIR))?;
    atomic_write_to(&pointer_path()?, &pointer_json(&root))?;

    #[cfg(target_os = "macos")]
    {
        let host_path = host_binary_path()?;
        if !host_path.is_file() {
            // Dev builds before the sidecar is staged: registration would point
            // browsers at a missing binary, so skip loudly instead.
            tracing::warn!(path = %host_path.display(), "capture host binary not staged; skipping manifest registration");
            return Ok(());
        }
        let app_support = dirs::config_dir().ok_or_else(|| AppError::io("no OS config dir"))?;
        let written = register_manifests(&app_support, &host_path)?;
        tracing::info!(written, "registered capture host manifests");
    }
    Ok(())
}

// ---- inbox commands -----------------------------------------------------------

/// Spool filenames are host-written `<uuid>.json` / `<uuid>.jpg`; anything
/// with a path separator (or a stray name another process dropped in) is
/// refused before it can address outside the inbox.
pub(crate) fn inbox_file(root: &Path, name: &str) -> AppResult<PathBuf> {
    if name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(AppError::traversal(format!(
            "not a spool filename: {name:?}"
        )));
    }
    Ok(root.join(INBOX_DIR).join(name))
}

/// List the capture inbox (flat; `.json` envelopes and their screenshot
/// siblings). A missing inbox lists as empty — the host creates it lazily.
#[tauri::command]
pub async fn capture_inbox_list<R: tauri::Runtime>(
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<Vec<FileMeta>> {
    crate::blocking::run_blocking(move || {
        capture_inbox_list_for(&app.state::<GraphState>(), generation)
    })
    .await
}

fn capture_inbox_list_for(
    state: &State<'_, GraphState>,
    generation: u64,
) -> AppResult<Vec<FileMeta>> {
    let root = root_for_generation(state, generation)?;
    let inbox = root.join(INBOX_DIR);
    let mut out = Vec::new();
    let entries = match fs::read_dir(&inbox) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(err) => return Err(err.into()),
    };
    for entry in entries {
        let entry = entry?;
        let meta = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !meta.is_file() || name.starts_with('.') {
            continue; // host tmp files and directories are not spool entries
        }
        out.push(FileMeta {
            path: format!("{INBOX_DIR}/{name}"),
            size: meta.len(),
            modified_ms: modified_ms(&meta).unwrap_or(0),
            placeholder: false, // the inbox lives under `.kore/`, never synced/evicted
        });
    }
    out.sort_by(|first, second| first.path.cmp(&second.path));
    Ok(out)
}

/// Envelopes this app spools itself (deep-link captures) are one short text
/// payload — anything near this cap is not a capture, it's smuggling.
pub(crate) const INBOX_SPOOL_MAX_BYTES: usize = 64 * 1024;

fn ensure_spool_size(json: &str) -> AppResult<()> {
    if json.len() > INBOX_SPOOL_MAX_BYTES {
        return Err(AppError::parse(format!(
            "envelope exceeds the {INBOX_SPOOL_MAX_BYTES}-byte spool cap"
        )));
    }
    Ok(())
}

/// Spool an envelope this app produced (deep-link `append`/`task` URLs) into
/// the same inbox the native-messaging host writes, so it flows through the
/// one drain path. The frontend owns the envelope shape; this only moves
/// bytes — atomically, so a half-written file can never be drained.
#[tauri::command]
pub async fn capture_inbox_spool<R: tauri::Runtime>(
    name: String,
    json: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    // Checked before the hop: an oversized envelope is rejected without
    // spending a thread on it.
    ensure_spool_size(&json)?;
    crate::blocking::run_blocking(move || {
        let root = root_for_generation(&app.state::<GraphState>(), generation)?;
        atomic_write_to(&inbox_file(&root, &name)?, &json)
    })
    .await
}

/// Read one spooled envelope's JSON text by spool filename.
#[tauri::command]
pub async fn capture_inbox_read<R: tauri::Runtime>(
    name: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<String> {
    crate::blocking::run_blocking(move || {
        let root = root_for_generation(&app.state::<GraphState>(), generation)?;
        Ok(fs::read_to_string(inbox_file(&root, &name)?)?)
    })
    .await
}

/// Remove a spool file. Idempotent — a re-drain after a crash may remove a
/// file the crashed pass already removed.
#[tauri::command]
pub async fn capture_inbox_remove<R: tauri::Runtime>(
    name: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let root = root_for_generation(&app.state::<GraphState>(), generation)?;
        match fs::remove_file(inbox_file(&root, &name)?) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    })
    .await
}

/// Copy a spooled file (one the iOS share sheet shared) into the vault's
/// attachment folder as `desired_name` — or the first free `-2` variant —
/// returning its graph-relative path. The spool file stays until the drain
/// removes it, and importing it again returns the copy already made, so a
/// failure between the two only ever costs a retry, never a second copy.
#[tauri::command]
pub async fn capture_inbox_import<R: tauri::Runtime>(
    spool_name: String,
    desired_name: String,
    generation: u64,
    dir: Option<String>,
    app: tauri::AppHandle<R>,
) -> AppResult<String> {
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = root_for_generation(&state, generation)?;
        crate::fs::assets::import_file_once(
            &state,
            generation,
            &inbox_file(&root, &spool_name)?,
            &desired_name,
            dir.as_deref(),
        )
    })
    .await
}

/// Where the drain quarantines spool files it cannot parse. Outside
/// `.kore/inbox/`, so nothing here re-triggers the watcher or a drain.
const INBOX_REJECTED_DIR: &str = ".kore/inbox-rejected";

fn quarantine_spool(root: &Path, name: &str) -> AppResult<()> {
    let source = inbox_file(root, name)?;
    let rejected = root.join(INBOX_REJECTED_DIR);
    fs::create_dir_all(&rejected)?;
    match fs::rename(&source, rejected.join(name)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// Quarantine a spool file the drain cannot parse — moved, never deleted:
/// "the raw link is never lost" must hold even for an envelope written by a
/// newer extension this app version cannot read yet. Idempotent like
/// `capture_inbox_remove`; an existing quarantined file of the same name is
/// replaced (same capture id ⇒ same content).
#[tauri::command]
pub async fn capture_inbox_reject<R: tauri::Runtime>(
    name: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let root = root_for_generation(&app.state::<GraphState>(), generation)?;
        quarantine_spool(&root, &name)
    })
    .await
}

// ---- screenshot promote ---------------------------------------------------------

// Maximum decoded image width or height, in pixels.
const CAPTURE_IMAGE_MAX_DIMENSION: u32 = 8192;
// Maximum memory the image decoder may allocate, in bytes.
const CAPTURE_IMAGE_MAX_ALLOC: u64 = 128 * 1024 * 1024;
// Long-edge target for persisted capture JPEGs, in pixels.
const CAPTURE_IMAGE_LONG_EDGE: u32 = 1600;

/// Decode, downscale to `max_dim` on the long edge, re-encode as JPEG. Pure —
/// the unit tests exercise this without Tauri state.
fn downscale_jpeg(bytes: &[u8], max_dim: u32) -> AppResult<Vec<u8>> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|err| AppError::parse(format!("image format is invalid: {err}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(CAPTURE_IMAGE_MAX_DIMENSION);
    limits.max_image_height = Some(CAPTURE_IMAGE_MAX_DIMENSION);
    limits.max_alloc = Some(CAPTURE_IMAGE_MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|err| AppError::parse(format!("image does not decode: {err}")))?;
    let resized = if decoded.width() > max_dim || decoded.height() > max_dim {
        decoded.resize(max_dim, max_dim, image::imageops::FilterType::CatmullRom)
    } else {
        decoded
    };
    let mut out = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80);
    resized
        .into_rgb8() // JPEG carries no alpha
        .write_with_encoder(encoder)
        .map_err(|err| AppError::io(format!("image re-encode failed: {err}")))?;
    Ok(out)
}

/// Write a promoted asset into the graph.
///
/// Delegates to `atomic_write_bytes` rather than staging beside the target.
/// `assets/` can live inside an iCloud Drive folder, and a temp created there
/// is synced and, after a crash, stranded on every device. That helper stages
/// under `.kore/tmp/`, which is excluded from sync, swept on graph open, and
/// on the same volume so the rename stays atomic.
fn persist_asset(root: &Path, asset_path: &str, bytes: &[u8]) -> AppResult<()> {
    let target = crate::fs::resolve_in_graph(root, asset_path)?;
    crate::fs::atomic_write_bytes(root, &target, bytes)?;
    Ok(())
}

/// Copy a spooled screenshot into the graph as a downscaled JPEG asset. Copy,
/// not move — the drain removes spool files only after the note is written,
/// so a crash mid-drain re-runs cleanly.
///
/// Async because the re-encode is real CPU work on the main thread otherwise:
/// measured 61.7 ms at 2560x1440 and 217.4 ms at 5120x2880. `capture_link_preview`
/// below already calls the same helper off-thread.
#[tauri::command]
pub async fn capture_screenshot_promote<R: tauri::Runtime>(
    spool_name: String,
    asset_path: String,
    max_dim: u32,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = root_for_generation(&state, generation)?;
        let bytes = fs::read(inbox_file(&root, &spool_name)?)?;
        let jpeg = downscale_jpeg(&bytes, max_dim)?;
        persist_asset(&root, &asset_path, &jpeg)
    })
    .await
}

/// Ask the platform link-preview service for one representative image and
/// return a normalized JPEG for the policy layer to persist after its
/// post-request privacy check.
#[tauri::command]
pub async fn capture_link_preview(app: tauri::AppHandle, url: String) -> AppResult<Option<String>> {
    use base64::Engine;

    let Some(bytes) = crate::link_preview::fetch(&app, &url).await? else {
        return Ok(None);
    };
    let jpeg = tauri::async_runtime::spawn_blocking(move || {
        downscale_jpeg(&bytes, CAPTURE_IMAGE_LONG_EDGE)
    })
    .await
    .map_err(|err| AppError::io(format!("link preview task failed: {err}")))??;
    Ok(Some(base64::engine::general_purpose::STANDARD.encode(jpeg)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_pins_name_path_and_origins() {
        let manifest = host_manifest_json(Path::new(
            "/Applications/Reflect.app/Contents/MacOS/kore-capture-host",
        ));
        let parsed: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(parsed["name"], "app.kore.capture");
        assert_eq!(parsed["type"], "stdio");
        assert_eq!(
            parsed["path"],
            "/Applications/Reflect.app/Contents/MacOS/kore-capture-host"
        );
        assert_eq!(
            parsed["allowed_origins"],
            serde_json::json!([
                "chrome-extension://dlbliojklpickgimjdmjjdnbjdiomjik/",
                "chrome-extension://ccabifmooehighoonjeiololjfofkhkd/"
            ])
        );
    }

    #[test]
    fn detects_only_installed_browsers() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Google/Chrome")).unwrap();
        fs::create_dir_all(dir.path().join("Arc/User Data")).unwrap();
        // Vivaldi absent.
        let dirs = detected_manifest_dirs(dir.path());
        assert_eq!(
            dirs,
            vec![
                dir.path().join("Google/Chrome/NativeMessagingHosts"),
                dir.path().join("Arc/User Data/NativeMessagingHosts"),
            ]
        );
    }

    #[test]
    fn register_writes_a_manifest_per_detected_browser() {
        let dir = tempfile::tempdir().unwrap();
        let hosts = dir.path().join("Google/Chrome/NativeMessagingHosts");
        fs::create_dir_all(&hosts).unwrap();
        fs::write(hosts.join("app.reflect.capture.json"), "{}").unwrap();
        let written =
            register_manifests(dir.path(), Path::new("/bundle/kore-capture-host")).unwrap();
        assert_eq!(written, 1);
        let manifest = dir
            .path()
            .join("Google/Chrome/NativeMessagingHosts/app.kore.capture.json");
        assert!(manifest.is_file());
        assert!(!hosts.join("app.reflect.capture.json").exists());
    }

    #[test]
    fn pointer_json_is_versioned() {
        let parsed: serde_json::Value =
            serde_json::from_str(&pointer_json(Path::new("/graphs/personal"))).unwrap();
        assert_eq!(parsed["version"], 1);
        assert_eq!(parsed["graphRoot"], "/graphs/personal");
    }

    #[test]
    fn spool_size_cap_refuses_oversized_envelopes() {
        assert!(ensure_spool_size("{\"small\":true}").is_ok());
        assert!(matches!(
            ensure_spool_size(&"x".repeat(INBOX_SPOOL_MAX_BYTES + 1)),
            Err(AppError::Parse { .. })
        ));
    }

    #[test]
    fn inbox_file_refuses_traversal_shaped_names() {
        let root = Path::new("/g");
        for name in ["../escape.json", "a/b.json", ".hidden", "..\\win.json"] {
            assert!(inbox_file(root, name).is_err(), "{name}");
        }
        assert!(inbox_file(root, "7c9e6679.json").is_ok());
    }

    #[test]
    fn quarantine_moves_the_spool_file_out_of_the_inbox() {
        let dir = tempfile::tempdir().unwrap();
        let inbox = dir.path().join(INBOX_DIR);
        fs::create_dir_all(&inbox).unwrap();
        fs::write(inbox.join("bad.json"), "not an envelope").unwrap();

        quarantine_spool(dir.path(), "bad.json").unwrap();

        assert!(!inbox.join("bad.json").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join(INBOX_REJECTED_DIR).join("bad.json")).unwrap(),
            "not an envelope"
        );
    }

    #[test]
    fn quarantine_is_idempotent_for_a_missing_source() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(INBOX_DIR)).unwrap();
        assert!(quarantine_spool(dir.path(), "gone.json").is_ok());
    }

    #[test]
    fn downscale_caps_the_long_edge_and_reencodes_jpeg() {
        let wide = image::DynamicImage::new_rgb8(3200, 1000);
        let mut png = Vec::new();
        wide.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();

        let jpeg = downscale_jpeg(&png, 1600).unwrap();
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert_eq!(decoded.width(), 1600);
        assert_eq!(decoded.height(), 500);
    }

    #[test]
    fn downscale_leaves_small_images_unscaled() {
        let small = image::DynamicImage::new_rgb8(800, 600);
        let mut png = Vec::new();
        small
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let decoded = image::load_from_memory(&downscale_jpeg(&png, 1600).unwrap()).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (800, 600));
    }

    #[test]
    fn downscale_rejects_non_images() {
        assert!(matches!(
            downscale_jpeg(b"not an image", 1600),
            Err(AppError::Parse { .. })
        ));
    }

    #[test]
    fn downscale_rejects_images_over_the_dimension_limit() {
        let too_wide =
            image::DynamicImage::new_rgb8(CAPTURE_IMAGE_MAX_DIMENSION.saturating_add(1), 1);
        let mut png = Vec::new();
        too_wide
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();

        assert!(matches!(
            downscale_jpeg(&png, CAPTURE_IMAGE_LONG_EDGE),
            Err(AppError::Parse { .. })
        ));
    }
}
