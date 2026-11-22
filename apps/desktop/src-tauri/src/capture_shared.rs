//! The iOS share extension's half of capture (Plan 11): the App Group
//! container the extension spools into, the relay that moves its envelopes
//! (and the photos and PDFs riding with them) into the graph's capture
//! inbox, and the note list the share sheet offers. Bytes only, like
//! [`crate::capture`]: what gets written where is decided in `@kore/core`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::State;

use crate::capture::{atomic_write_to, inbox_file, INBOX_SPOOL_MAX_BYTES};
use crate::error::{AppError, AppResult};
use crate::fs::{root_for_generation, GraphState};

/// The App Group the iOS share extension spools into. Must match the
/// `com.apple.security.application-groups` entitlement on the app and the
/// extension targets (`ios.project.yml`) and `groupId` in
/// `CaptureInbox.swift`. Debug builds are the dev flavor and use their own
/// group so a dev install never drains the production app's inbox; the Xcode
/// debug configuration compiles the Rust dev profile, so `debug_assertions`
/// tracks the flavor exactly.
#[cfg(all(target_os = "ios", debug_assertions))]
const SHARED_GROUP_ID: &str = "group.app.kore.dev";
#[cfg(all(target_os = "ios", not(debug_assertions)))]
const SHARED_GROUP_ID: &str = "group.app.kore";

/// The envelope spool directory inside the App Group container. The extension
/// creates it lazily; a missing directory relays as zero.
#[cfg(any(target_os = "ios", test))]
const SHARED_INBOX_DIR: &str = "inbox";

/// Where oversized shared spools are quarantined, beside the shared inbox —
/// moved, never deleted, mirroring the drain's `.kore/inbox-rejected/`.
const SHARED_REJECTED_DIR: &str = "inbox-rejected";

/// A `.tmp` older than this is debris from an extension crash between its
/// write and its commit rename, and a shared file no envelope claims after
/// this long is one whose envelope never committed. Both are swept so the
/// container can't accrete junk (the drain applies the same rule to its
/// own orphans).
const SHARED_TMP_MAX_AGE: Duration = Duration::from_secs(60 * 60);

/// Cap on one shared file (a photo or a PDF riding with an envelope). The
/// extension refuses anything larger; this only keeps a stray giant from
/// being copied into the vault.
const SHARED_FILE_MAX_BYTES: u64 = 128 * 1024 * 1024;

/// The envelope id a spool file belongs to: its name up to the first dot
/// (`<id>.json`, `<id>.1.jpg`). The drain pairs files the same way.
fn spool_stem(name: &str) -> &str {
    name.split_once('.').map_or(name, |(stem, _)| stem)
}

fn older_than(metadata: &fs::Metadata, age: Duration) -> bool {
    metadata
        .modified()
        .ok()
        .and_then(|at| at.elapsed().ok())
        .is_some_and(|elapsed| elapsed > age)
}

/// Copy one file across volumes into `target` atomically: streamed into a
/// synced temp sibling, then renamed, so the drain never sees half a file.
/// Overwrites a crash duplicate of the same spool.
fn atomic_copy_to(source: &Path, target: &Path) -> AppResult<()> {
    let dir = target
        .parent()
        .ok_or_else(|| AppError::io(format!("no parent directory for {}", target.display())))?;
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    std::io::copy(&mut fs::File::open(source)?, tmp.as_file_mut())?;
    tmp.as_file().sync_all()?;
    tmp.persist(target)
        .map_err(|err| AppError::io(err.to_string()))?;
    Ok(())
}

/// Move one spool file into the graph inbox: copy, then delete the source.
fn relay_one(source: &Path, target: &Path) -> AppResult<()> {
    atomic_copy_to(source, target)?;
    fs::remove_file(source)?;
    Ok(())
}

/// Quarantine a shared spool beside the shared inbox — moved, never deleted.
fn quarantine_shared(shared_inbox: &Path, name: &str) -> AppResult<()> {
    let rejected = shared_inbox
        .parent()
        .ok_or_else(|| AppError::io("shared inbox has no parent directory"))?
        .join(SHARED_REJECTED_DIR);
    fs::create_dir_all(&rejected)?;
    fs::rename(shared_inbox.join(name), rejected.join(name))?;
    Ok(())
}

/// Move every spooled `.json` envelope from the shared inbox into the graph's
/// capture inbox, each preceded by the files riding with it (`<id>.<n>.<ext>`,
/// a share's photos and PDFs): the drain can then never see an envelope
/// whose files are still behind. The extension commits the files before the
/// envelope, so a committed envelope's files are all there. Copy + atomic
/// write + delete-source, because the App Group container and the graph root
/// (app sandbox or iCloud container) are different volumes where a rename
/// cannot cross. A crash between the copy and the source delete re-relays
/// the same files later — the drain's deterministic identity makes that
/// idempotent. Bytes only: unparseable envelopes still relay, and the drain
/// quarantines them with the rest.
fn relay_shared_spools(shared_inbox: &Path, root: &Path) -> AppResult<u32> {
    let entries = match fs::read_dir(shared_inbox) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(err.into()),
    };
    let mut envelopes = Vec::new();
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = entry.metadata()?;
        if !metadata.is_file() || name.starts_with('.') {
            continue;
        }
        // Extension tmp files are not spool entries; old ones are crash
        // debris (write happened, commit rename didn't) — swept; the age
        // guard covers an extension writing right now.
        if name.ends_with(".tmp") {
            if older_than(&metadata, SHARED_TMP_MAX_AGE) {
                fs::remove_file(entry.path())?;
            }
            continue;
        }
        if name.ends_with(".json") {
            envelopes.push((name, metadata));
        } else {
            files.push((name, metadata));
        }
    }
    envelopes.sort_by(|first, second| first.0.cmp(&second.0));

    let mut relayed = 0;
    for (name, metadata) in &envelopes {
        let Ok(target) = inbox_file(root, name) else {
            continue; // not a spool filename this app would ever address
        };
        let stem = spool_stem(name);
        if metadata.len() > INBOX_SPOOL_MAX_BYTES as u64 {
            // Anything near the cap is not a capture. Quarantined beside the
            // shared inbox, its files with it, so it can't wedge the relay.
            quarantine_shared(shared_inbox, name)?;
            for (file, _) in files.iter().filter(|(file, _)| spool_stem(file) == stem) {
                quarantine_shared(shared_inbox, file)?;
            }
            continue;
        }
        for (file, file_metadata) in files.iter().filter(|(file, _)| spool_stem(file) == stem) {
            if file_metadata.len() > SHARED_FILE_MAX_BYTES {
                quarantine_shared(shared_inbox, file)?;
                continue;
            }
            relay_one(&shared_inbox.join(file), &inbox_file(root, file)?)?;
        }
        relay_one(&shared_inbox.join(name), &target)?;
        relayed += 1;
    }

    // Files whose envelope never committed (the extension died between the
    // two writes) are swept once no extension can still be writing it.
    for (file, metadata) in &files {
        let claimed = envelopes
            .iter()
            .any(|(name, _)| spool_stem(name) == spool_stem(file));
        if !claimed && older_than(metadata, SHARED_TMP_MAX_AGE) {
            fs::remove_file(shared_inbox.join(file))?;
        }
    }
    Ok(relayed)
}

/// The App Group container the iOS share extension shares with the app.
/// `None` when it is unavailable (non-iOS platforms; a build without the App
/// Group entitlement).
#[cfg(target_os = "ios")]
fn shared_container_dir() -> Option<PathBuf> {
    use objc2_foundation::{NSFileManager, NSString};
    let manager = NSFileManager::defaultManager();
    let group = NSString::from_str(SHARED_GROUP_ID);
    let container = manager.containerURLForSecurityApplicationGroupIdentifier(&group)?;
    let path = container.path()?.to_string();
    Some(PathBuf::from(path))
}

/// Only iOS has a share extension; every other platform's capture producers
/// write the graph inbox directly.
#[cfg(not(target_os = "ios"))]
fn shared_container_dir() -> Option<PathBuf> {
    None
}

/// The shared inbox the iOS share extension writes: `<App Group>/inbox`.
fn shared_inbox_dir() -> Option<PathBuf> {
    #[cfg(target_os = "ios")]
    {
        shared_container_dir().map(|dir| dir.join(SHARED_INBOX_DIR))
    }
    #[cfg(not(target_os = "ios"))]
    {
        shared_container_dir()
    }
}

/// Relay envelopes the iOS share extension spooled into the App Group inbox
/// into the open graph's capture inbox, where the normal drain materializes
/// them. Returns how many envelopes moved; zero without a shared container.
/// Called by the mobile capture controller on launch and every foreground.
#[tauri::command]
pub async fn capture_shared_inbox_relay(
    generation: u64,
    state: State<'_, GraphState>,
) -> AppResult<u32> {
    let root = root_for_generation(&state, generation)?;
    match shared_inbox_dir() {
        // App Group directory IO belongs on the blocking pool: this fires on
        // every launch and foreground, on what is the touch-delivery thread
        // for sync commands on iOS.
        Some(shared) => {
            crate::blocking::run_blocking(move || relay_shared_spools(&shared, &root)).await
        }
        None => Ok(0),
    }
}

/// The share sheet's note list inside the App Group container; the extension
/// reads the same name (`ShareTargets.fileName`).
const SHARE_TARGETS_FILE: &str = "share-targets.json";

/// Cap on the share sheet's note list. Thousands of titles and paths fit in
/// well under this; anything larger is not the list.
const SHARE_TARGETS_MAX_BYTES: usize = 4 * 1024 * 1024;

fn write_share_targets(container: &Path, json: &str) -> AppResult<()> {
    if json.len() > SHARE_TARGETS_MAX_BYTES {
        return Err(AppError::io("share targets exceed the size cap"));
    }
    atomic_write_to(&container.join(SHARE_TARGETS_FILE), json)
}

/// Write the share sheet's note list (`share-targets.json`) into the App
/// Group container, atomically. Bytes only: what the list holds is decided
/// in core (`actions/share-targets`). A no-op without a shared container.
#[tauri::command]
pub async fn share_targets_write(json: String) -> AppResult<()> {
    match shared_container_dir() {
        Some(container) => {
            crate::blocking::run_blocking(move || write_share_targets(&container, &json)).await
        }
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::INBOX_DIR;

    #[test]
    fn relay_moves_committed_envelopes_into_the_graph_inbox() {
        let shared = tempfile::tempdir().unwrap();
        let graph = tempfile::tempdir().unwrap();
        let shared_inbox = shared.path().join(SHARED_INBOX_DIR);
        fs::create_dir_all(&shared_inbox).unwrap();
        fs::write(shared_inbox.join("7c9e6679.json"), r#"{"version":1}"#).unwrap();
        fs::write(shared_inbox.join("aabbccdd.json"), r#"{"version":1}"#).unwrap();
        // Not spool entries: a fresh mid-write tmp file and a hidden file.
        fs::write(shared_inbox.join("eeff0011.json.tmp"), "partial").unwrap();
        fs::write(shared_inbox.join(".DS_Store"), "junk").unwrap();

        let relayed = relay_shared_spools(&shared_inbox, graph.path()).unwrap();

        assert_eq!(relayed, 2);
        let inbox = graph.path().join(INBOX_DIR);
        assert_eq!(
            fs::read_to_string(inbox.join("7c9e6679.json")).unwrap(),
            r#"{"version":1}"#
        );
        assert!(inbox.join("aabbccdd.json").is_file());
        assert!(!shared_inbox.join("7c9e6679.json").exists());
        assert!(!shared_inbox.join("aabbccdd.json").exists());
        assert!(shared_inbox.join("eeff0011.json.tmp").exists());
        assert!(shared_inbox.join(".DS_Store").exists());
    }

    fn age(path: &Path, by: Duration) {
        let file = fs::File::options().write(true).open(path).unwrap();
        let then = std::time::SystemTime::now() - by;
        file.set_times(fs::FileTimes::new().set_modified(then))
            .unwrap();
    }

    #[test]
    fn relay_moves_shared_files_with_their_envelope() {
        let shared = tempfile::tempdir().unwrap();
        let graph = tempfile::tempdir().unwrap();
        let shared_inbox = shared.path().join(SHARED_INBOX_DIR);
        fs::create_dir_all(&shared_inbox).unwrap();
        fs::write(shared_inbox.join("7c9e6679.json"), r#"{"kind":"file"}"#).unwrap();
        fs::write(shared_inbox.join("7c9e6679.1.jpg"), "photo").unwrap();
        fs::write(shared_inbox.join("7c9e6679.2.pdf"), "pdf").unwrap();
        // Still being written: its envelope has not committed yet.
        fs::write(shared_inbox.join("aabbccdd.1.png"), "young").unwrap();
        fs::write(shared_inbox.join("aabbccdd.2.png.tmp"), "partial").unwrap();

        let relayed = relay_shared_spools(&shared_inbox, graph.path()).unwrap();

        assert_eq!(relayed, 1);
        let inbox = graph.path().join(INBOX_DIR);
        assert_eq!(
            fs::read_to_string(inbox.join("7c9e6679.1.jpg")).unwrap(),
            "photo"
        );
        assert_eq!(
            fs::read_to_string(inbox.join("7c9e6679.2.pdf")).unwrap(),
            "pdf"
        );
        assert!(inbox.join("7c9e6679.json").is_file());
        assert!(!shared_inbox.join("7c9e6679.1.jpg").exists());
        assert!(shared_inbox.join("aabbccdd.1.png").exists());
        assert!(shared_inbox.join("aabbccdd.2.png.tmp").exists());
        assert!(!inbox.join("aabbccdd.1.png").exists());
    }

    #[test]
    fn relay_sweeps_old_unclaimed_files_and_quarantines_oversized_ones() {
        let shared = tempfile::tempdir().unwrap();
        let graph = tempfile::tempdir().unwrap();
        let shared_inbox = shared.path().join(SHARED_INBOX_DIR);
        fs::create_dir_all(&shared_inbox).unwrap();
        let orphan = shared_inbox.join("deadbeef.1.jpg");
        fs::write(&orphan, "debris").unwrap();
        age(&orphan, SHARED_TMP_MAX_AGE + Duration::from_secs(60));
        fs::write(shared_inbox.join("7c9e6679.json"), r#"{"kind":"file"}"#).unwrap();
        let giant = fs::File::create(shared_inbox.join("7c9e6679.1.pdf")).unwrap();
        giant.set_len(SHARED_FILE_MAX_BYTES + 1).unwrap();

        let relayed = relay_shared_spools(&shared_inbox, graph.path()).unwrap();

        assert_eq!(relayed, 1);
        assert!(!orphan.exists());
        assert!(shared
            .path()
            .join(SHARED_REJECTED_DIR)
            .join("7c9e6679.1.pdf")
            .is_file());
        assert!(!graph.path().join(INBOX_DIR).join("7c9e6679.1.pdf").exists());
        assert!(graph.path().join(INBOX_DIR).join("7c9e6679.json").is_file());
    }

    #[test]
    fn relay_sweeps_old_tmp_debris_but_never_young_tmp_files() {
        let shared = tempfile::tempdir().unwrap();
        let graph = tempfile::tempdir().unwrap();
        let shared_inbox = shared.path().join(SHARED_INBOX_DIR);
        fs::create_dir_all(&shared_inbox).unwrap();
        let old = shared_inbox.join("dead.json.tmp");
        let young = shared_inbox.join("live.json.tmp");
        fs::write(&old, "crash debris").unwrap();
        fs::write(&young, "being written").unwrap();
        age(&old, SHARED_TMP_MAX_AGE + Duration::from_secs(60));

        let relayed = relay_shared_spools(&shared_inbox, graph.path()).unwrap();

        assert_eq!(relayed, 0);
        assert!(!old.exists());
        assert!(young.exists());
    }

    #[test]
    fn share_targets_write_lands_atomically_and_refuses_oversized_lists() {
        let container = tempfile::tempdir().unwrap();
        write_share_targets(container.path(), r#"{"version":1}"#).unwrap();
        let written = fs::read_to_string(container.path().join(SHARE_TARGETS_FILE)).unwrap();
        assert_eq!(written, r#"{"version":1}"#);
        let oversized = "x".repeat(SHARE_TARGETS_MAX_BYTES + 1);
        assert!(write_share_targets(container.path(), &oversized).is_err());
    }

    #[test]
    fn relay_of_a_missing_shared_inbox_is_zero() {
        let graph = tempfile::tempdir().unwrap();
        let relayed =
            relay_shared_spools(Path::new("/nonexistent/shared/inbox"), graph.path()).unwrap();
        assert_eq!(relayed, 0);
    }

    #[test]
    fn relay_overwrites_a_crash_duplicate_instead_of_failing() {
        let shared = tempfile::tempdir().unwrap();
        let graph = tempfile::tempdir().unwrap();
        let shared_inbox = shared.path().join(SHARED_INBOX_DIR);
        fs::create_dir_all(&shared_inbox).unwrap();
        let inbox = graph.path().join(INBOX_DIR);
        fs::create_dir_all(&inbox).unwrap();
        // A crash between the copy and the source delete leaves both sides.
        fs::write(shared_inbox.join("7c9e6679.json"), r#"{"version":1}"#).unwrap();
        fs::write(inbox.join("7c9e6679.json"), r#"{"version":1}"#).unwrap();

        let relayed = relay_shared_spools(&shared_inbox, graph.path()).unwrap();

        assert_eq!(relayed, 1);
        assert!(!shared_inbox.join("7c9e6679.json").exists());
        assert!(inbox.join("7c9e6679.json").is_file());
    }

    #[test]
    fn relay_quarantines_oversized_spools_beside_the_shared_inbox() {
        let shared = tempfile::tempdir().unwrap();
        let graph = tempfile::tempdir().unwrap();
        let shared_inbox = shared.path().join(SHARED_INBOX_DIR);
        fs::create_dir_all(&shared_inbox).unwrap();
        fs::write(
            shared_inbox.join("big.json"),
            "x".repeat(INBOX_SPOOL_MAX_BYTES + 1),
        )
        .unwrap();

        let relayed = relay_shared_spools(&shared_inbox, graph.path()).unwrap();

        assert_eq!(relayed, 0);
        assert!(!shared_inbox.join("big.json").exists());
        assert!(shared
            .path()
            .join(SHARED_REJECTED_DIR)
            .join("big.json")
            .is_file());
        assert!(!graph.path().join(INBOX_DIR).join("big.json").exists());
    }
}
