//! Pulled and cloned notes keep the time they were edited, not the sync time.

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use git2::{Repository, Signature, Time};

use super::super::merge::{merge_remote, MergeKind};
use super::super::remote::{clone, fetch, push};
use super::{commit_all, fixture, second_device, write, MAX_FILE_BYTES};

/// Commit everything in `root` as if it was written at `epoch_secs`.
fn commit_at(root: &Path, message: &str, epoch_secs: i64) {
    let repo = Repository::open(root).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = Signature::new("Agent", "agent@example.com", &Time::new(epoch_secs, 0)).unwrap();
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
        .unwrap();
}

fn mtime_secs(root: &Path, rel: &str) -> i64 {
    let modified = root.join(rel).metadata().unwrap().modified().unwrap();
    i64::try_from(modified.duration_since(UNIX_EPOCH).unwrap().as_secs()).unwrap()
}

fn now_secs() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap()
}

#[test]
fn a_fast_forward_pull_stamps_each_note_with_its_last_commit_time() {
    let fixture = fixture();
    let root_a = &fixture.graph_a;
    write(root_a, "notes/base.md", "# Base\n");
    commit_all(root_a, "base", MAX_FILE_BYTES).unwrap();
    push(root_a, None).unwrap();

    // Another device (or an agent) edits two notes hours apart, then pushes.
    let root_b = second_device(&fixture);
    let older = now_secs() - 6 * 3600;
    let newer = now_secs() - 2 * 3600;
    write(&root_b, "notes/older.md", "# Older\n");
    commit_at(&root_b, "older", older);
    write(&root_b, "notes/newer.md", "# Newer\n");
    write(&root_b, "assets/pic.png", "png");
    commit_at(&root_b, "newer", newer);
    push(&root_b, None).unwrap();

    fetch(root_a, None).unwrap();
    let merged = merge_remote(root_a).unwrap();
    assert!(matches!(merged.kind, MergeKind::FastForward), "{merged:?}");

    assert_eq!(mtime_secs(root_a, "notes/older.md"), older);
    assert_eq!(mtime_secs(root_a, "notes/newer.md"), newer);
    // The reindex is told the same edit time the file now carries.
    let reported = merged
        .changed_files
        .iter()
        .find(|change| change.path == "notes/newer.md")
        .and_then(|change| change.modified_ms)
        .unwrap();
    assert_eq!(reported, u64::try_from(newer).unwrap() * 1000);
    // Attachments keep the checkout's time (re-stamping them would make the
    // next commit re-hash every one).
    assert!(mtime_secs(root_a, "assets/pic.png") >= now_secs() - 60);
}

#[test]
fn a_merge_pull_stamps_the_incoming_notes_but_not_conflicted_ones() {
    let fixture = fixture();
    let root_a = &fixture.graph_a;
    write(root_a, "notes/shared.md", "# Shared\n\nbase\n");
    commit_all(root_a, "base", MAX_FILE_BYTES).unwrap();
    push(root_a, None).unwrap();

    let root_b = second_device(&fixture);
    let edited = now_secs() - 3 * 3600;
    write(&root_b, "notes/remote.md", "# Remote\n");
    write(&root_b, "notes/shared.md", "# Shared\n\nfrom b\n");
    commit_at(&root_b, "from b", edited);
    push(&root_b, None).unwrap();

    write(root_a, "notes/shared.md", "# Shared\n\nfrom a\n");
    commit_all(root_a, "from a", MAX_FILE_BYTES).unwrap();
    fetch(root_a, None).unwrap();
    let merged = merge_remote(root_a).unwrap();
    assert!(
        matches!(merged.kind, MergeKind::MergedWithConflicts),
        "{merged:?}"
    );

    assert_eq!(mtime_secs(root_a, "notes/remote.md"), edited);
    // The merge itself just rewrote the conflicted note: that is news.
    assert!(mtime_secs(root_a, "notes/shared.md") >= now_secs() - 60);
}

#[test]
fn a_clone_gives_notes_their_edit_times_and_never_moves_a_time_forward() {
    let fixture = fixture();
    let root_a = &fixture.graph_a;
    write(root_a, "notes/base.md", "# Base\n");
    commit_all(root_a, "base", MAX_FILE_BYTES).unwrap();
    let edited = now_secs() - 24 * 3600;
    write(root_a, "notes/old.md", "# Old\n");
    commit_at(root_a, "old", edited);
    push(root_a, None).unwrap();

    let target = fixture._dir.path().join("restored");
    clone(&fixture.remote_url, &target, None, None).unwrap();
    assert_eq!(mtime_secs(&target, "notes/old.md"), edited);

    // A file whose own time is older than its commit keeps it.
    let earlier = UNIX_EPOCH + Duration::from_secs(u64::try_from(edited - 3600).unwrap());
    std::fs::File::open(root_a.join("notes/old.md"))
        .unwrap()
        .set_modified(earlier)
        .unwrap();
    assert_eq!(
        super::super::edit_times::apply_edit_time(
            root_a,
            "notes/old.md",
            Some(u64::try_from(edited).unwrap() * 1000)
        ),
        Some(u64::try_from(edited - 3600).unwrap() * 1000)
    );
}

#[test]
fn the_one_time_backfill_repairs_an_existing_checkout_once() {
    let fixture = fixture();
    let root_a = &fixture.graph_a;
    write(root_a, "notes/base.md", "# Base\n");
    commit_all(root_a, "base", MAX_FILE_BYTES).unwrap();
    let edited = now_secs() - 5 * 3600;
    write(root_a, "notes/old.md", "# Old\n");
    commit_at(root_a, "old", edited);
    push(root_a, None).unwrap();

    // A checkout made before this fix: plain git stamps the clone time.
    let root_b = second_device(&fixture);
    assert!(mtime_secs(&root_b, "notes/old.md") >= now_secs() - 60);

    // The next sync repairs it, even with nothing to pull.
    fetch(&root_b, None).unwrap();
    merge_remote(&root_b).unwrap();
    assert_eq!(mtime_secs(&root_b, "notes/old.md"), edited);

    // Only once: a later local edit keeps its own time.
    write(&root_b, "notes/old.md", "# Old\n\nedited here\n");
    let touched = mtime_secs(&root_b, "notes/old.md");
    merge_remote(&root_b).unwrap();
    assert_eq!(mtime_secs(&root_b, "notes/old.md"), touched);
}
