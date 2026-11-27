//! The mass-deletion preflight the sync engine checks before merging and
//! before pushing.

use std::fs;

use git2::Repository;

use super::super::deletions::{sync_deletions, SyncDeletions};
use super::{
    commit_all, fetch, fixture, head_tree_paths, push, second_device, write, MAX_FILE_BYTES,
};

#[test]
fn counts_a_wipe_on_both_sides_and_not_a_moved_folder() {
    let fixture = fixture();
    let root_a = &fixture.graph_a;
    for index in 0..10 {
        write(
            root_a,
            &format!("notes/n{index}.md"),
            &format!("# N{index}\n"),
        );
    }
    commit_all(root_a, "base", MAX_FILE_BYTES).unwrap();
    push(root_a, None).unwrap();
    // Nothing deleted yet: nothing to compare, so the vault is not walked.
    assert_eq!(sync_deletions(root_a).unwrap(), SyncDeletions::default());
    let tracked = head_tree_paths(root_a).len();
    let root_b = second_device(&fixture);
    let root_c = fixture._dir.path().join("graph-c");
    Repository::clone(&fixture.remote_url, &root_c).unwrap();

    // Device B keeps two notes and removes the rest, like an agent
    // committing from an empty index; before its push it is outgoing.
    for index in 2..10 {
        fs::remove_file(root_b.join(format!("notes/n{index}.md"))).unwrap();
    }
    fs::remove_file(root_b.join(".gitignore")).unwrap();
    commit_all(&root_b, "wipe", MAX_FILE_BYTES).unwrap();
    assert_eq!(
        sync_deletions(&root_b).unwrap(),
        SyncDeletions {
            incoming: 0,
            outgoing: 9,
            tracked
        }
    );
    push(&root_b, None).unwrap();

    // Device A sees the same wipe as incoming once it fetches.
    fetch(root_a, None).unwrap();
    assert_eq!(
        sync_deletions(root_a).unwrap(),
        SyncDeletions {
            incoming: 9,
            outgoing: 0,
            tracked
        }
    );

    // A folder moved unchanged is renames, not deletions.
    fs::rename(root_c.join("notes"), root_c.join("archive")).unwrap();
    commit_all(&root_c, "move", MAX_FILE_BYTES).unwrap();
    assert_eq!(sync_deletions(&root_c).unwrap().outgoing, 0);
}
