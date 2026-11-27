//! Line authors: the history walk names the commit `git blame` would, through
//! edits, merges between devices and moved notes.

use std::path::Path;

use git2::{Oid, Repository, Signature};
use tempfile::tempdir;

use super::super::activity::Trailer;
use super::super::blame::{blame, Blame, BlameCommit, BlameHunk};

/// Commit `text` at `rel` on top of `HEAD`.
fn commit(repo: &Repository, rel: &str, text: &str, who: (&str, &str), message: &str) {
    let parent: Vec<Oid> = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .into_iter()
        .collect();
    commit_tree(repo, &parent, &[(rel, Some(text))], who, message, true);
}

fn author_of(blame: &Blame, line: usize) -> Option<&BlameCommit> {
    let hunk = blame
        .hunks
        .iter()
        .find(|hunk| (hunk.start_line..hunk.start_line + hunk.lines).contains(&line))
        .unwrap();
    hunk.commit.as_ref().map(|id| &blame.commits[id])
}

#[test]
fn each_line_names_its_last_commit_and_unsaved_lines_name_none() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    commit(
        &repo,
        "notes/a.md",
        "one\ntwo\n",
        ("Mario", "mario@example.com"),
        "Update a",
    );
    commit(
        &repo,
        "notes/a.md",
        "one\ntwo\nthree\n",
        ("Grok", "grok@agents.kore"),
        "Update a\n\nKore-Agent: Grok\n",
    );

    let blame = blame(dir.path(), "notes/a.md", "one\ntwo\nthree\nfour\n").unwrap();

    assert_eq!(author_of(&blame, 1).unwrap().author_name, "Mario");
    assert_eq!(author_of(&blame, 2).unwrap().author_name, "Mario");
    let agent = author_of(&blame, 3).unwrap();
    assert_eq!(agent.author_email, "grok@agents.kore");
    assert_eq!(
        agent.trailers,
        vec![Trailer {
            key: "Kore-Agent".into(),
            value: "Grok".into()
        }]
    );
    assert!(author_of(&blame, 4).is_none());
    assert_eq!(blame.commits.len(), 2);
}

#[test]
fn a_note_no_commit_holds_is_all_uncommitted() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    // Unborn branch.
    let blame_unborn = blame(dir.path(), "notes/new.md", "a\nb\n").unwrap();
    assert_eq!(
        blame_unborn.hunks,
        vec![BlameHunk {
            start_line: 1,
            lines: 2,
            commit: None
        }]
    );
    // A history that never held the note.
    commit(
        &repo,
        "notes/old.md",
        "x\n",
        ("Mario", "m@e.com"),
        "Add old",
    );
    let blame_new = blame(dir.path(), "notes/new.md", "a\n").unwrap();
    assert_eq!(blame_new.hunks.len(), 1);
    assert!(blame_new.hunks[0].commit.is_none());
    assert!(blame(dir.path(), "notes/new.md", "")
        .unwrap()
        .hunks
        .is_empty());
}

/// libgit2's own `blame_file` + `blame_buffer`, the walk this module
/// replaced: the answer every line must still get.
fn libgit2_owners(root: &Path, rel: &str, content: &str) -> Vec<Option<String>> {
    let repo = Repository::open(root).unwrap();
    let committed = repo.blame_file(Path::new(rel), None).unwrap();
    let blame = committed.blame_buffer(content.as_bytes()).unwrap();
    let mut owners = Vec::new();
    for hunk in blame.iter() {
        let id = hunk.final_commit_id();
        let owner = (id != Oid::ZERO_SHA1).then(|| id.to_string());
        owners.extend(std::iter::repeat_n(owner, hunk.lines_in_hunk()));
    }
    owners
}

fn owners(blame: &Blame) -> Vec<Option<String>> {
    blame
        .hunks
        .iter()
        .flat_map(|hunk| std::iter::repeat_n(hunk.commit.clone(), hunk.lines))
        .collect()
}

#[test]
fn matches_libgit2_blame_across_edits_moves_and_unrelated_commits() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    let me = ("Mario", "mario@example.com");
    let agent = ("Grok", "grok@agents.kore");
    let versions = [
        ("a\nb\nc\nd\ne\n", me),
        ("a\nb2\nc\nd\ne\nf\n", agent),
        ("x\na\nb2\nd\ne\nf\n", me),
        ("x\na\nb2\nd\nnew\ne\nf\ng\n", agent),
        ("x\nb2\nd\nnew\ne\nf\ng\nh\n", me),
    ];
    for (index, (text, who)) in versions.iter().enumerate() {
        // Autosaves of other notes between each version of this one.
        for other in 0..3 {
            commit(
                &repo,
                &format!("other/{index}-{other}.md"),
                "noise\n",
                me,
                "Update other",
            );
        }
        commit(&repo, "notes/a.md", text, *who, "Update a");
    }
    for shown in [
        "x\nb2\nd\nnew\ne\nf\ng\nh\n",
        "x\nb2\ntyped\nd\nnew\ne\nf\ng\nh\n",
        "b2\nd\nnew\n",
    ] {
        let blame = blame(dir.path(), "notes/a.md", shown).unwrap();
        assert_eq!(
            owners(&blame),
            libgit2_owners(dir.path(), "notes/a.md", shown),
            "shown: {shown:?}"
        );
    }
    // libgit2 refuses an empty buffer; an emptied note simply has no lines.
    assert!(blame(dir.path(), "notes/a.md", "")
        .unwrap()
        .hunks
        .is_empty());
}

/// Commit `files` (`None` removes one) over the first parent's tree,
/// with exactly `parents`; moves `HEAD` only when `head` is set.
fn commit_tree(
    repo: &Repository,
    parents: &[Oid],
    files: &[(&str, Option<&str>)],
    who: (&str, &str),
    message: &str,
    head: bool,
) -> Oid {
    let parents: Vec<git2::Commit<'_>> = parents
        .iter()
        .map(|id| repo.find_commit(*id).unwrap())
        .collect();
    let mut index = git2::Index::new().unwrap();
    if let Some(first) = parents.first() {
        index.read_tree(&first.tree().unwrap()).unwrap();
    }
    for (path, text) in files {
        match text {
            Some(text) => {
                let blob = repo.blob(text.as_bytes()).unwrap();
                let entry = git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: 0o100_644,
                    uid: 0,
                    gid: 0,
                    file_size: text.len() as u32,
                    id: blob,
                    flags: 0,
                    flags_extended: 0,
                    path: path.as_bytes().to_vec(),
                };
                index.add(&entry).unwrap();
            }
            None => index.remove_path(Path::new(path)).unwrap(),
        }
    }
    let tree = repo.find_tree(index.write_tree_to(repo).unwrap()).unwrap();
    let signature = Signature::now(who.0, who.1).unwrap();
    let parents: Vec<&git2::Commit<'_>> = parents.iter().collect();
    repo.commit(
        head.then_some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    )
    .unwrap()
}

fn assert_matches_libgit2(root: &Path, rel: &str, shown: &str) -> Blame {
    let blame = blame(root, rel, shown).unwrap();
    assert_eq!(
        owners(&blame),
        libgit2_owners(root, rel, shown),
        "shown: {shown:?}"
    );
    blame
}

#[test]
fn a_merge_that_took_one_side_follows_that_side() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    let me = ("Mario", "mario@example.com");
    let agent = ("Grok", "grok@agents.kore");
    let base = commit_tree(
        &repo,
        &[],
        &[("notes/a.md", Some("a\nb\nc\n"))],
        me,
        "Update",
        true,
    );
    let edit = commit_tree(
        &repo,
        &[base],
        &[("notes/a.md", Some("a\nB\nc\n"))],
        agent,
        "Update",
        false,
    );
    let other = commit_tree(
        &repo,
        &[base],
        &[("notes/b.md", Some("x\n"))],
        me,
        "Update",
        true,
    );
    let merge = commit_tree(
        &repo,
        &[other, edit],
        &[("notes/a.md", Some("a\nB\nc\n"))],
        me,
        "Update",
        true,
    );

    let blame = assert_matches_libgit2(dir.path(), "notes/a.md", "a\nB\nc\n");
    assert_eq!(author_of(&blame, 2).unwrap().author_name, "Grok");
    assert!(!blame.commits.contains_key(&merge.to_string()));
}

#[test]
fn a_merge_of_two_edits_names_each_side_and_its_own_lines() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    let me = ("Mario", "mario@example.com");
    let agent = ("Grok", "grok@agents.kore");
    let host = ("Host", "host@example.com");
    let base = commit_tree(
        &repo,
        &[],
        &[("notes/a.md", Some("a\nb\nc\nd\ne\n"))],
        me,
        "Update",
        true,
    );
    let ours = commit_tree(
        &repo,
        &[base],
        &[("notes/a.md", Some("a\nb\nc\nD\ne\n"))],
        me,
        "Update",
        true,
    );
    let theirs = commit_tree(
        &repo,
        &[base],
        &[("notes/a.md", Some("a\nB\nc\nd\ne\n"))],
        agent,
        "Update",
        false,
    );
    let merged = "a\nB\nc\nD\nboth\ne\n";
    commit_tree(
        &repo,
        &[ours, theirs],
        &[("notes/a.md", Some(merged))],
        host,
        "Update",
        true,
    );
    commit_tree(
        &repo,
        &[repo.head().unwrap().target().unwrap()],
        &[("notes/z.md", Some("z\n"))],
        me,
        "Update",
        true,
    );

    let blame = assert_matches_libgit2(dir.path(), "notes/a.md", merged);
    assert_eq!(author_of(&blame, 1).unwrap().author_name, "Mario");
    assert_eq!(author_of(&blame, 2).unwrap().author_name, "Grok");
    assert_eq!(author_of(&blame, 4).unwrap().author_name, "Mario");
    assert_eq!(author_of(&blame, 5).unwrap().author_name, "Host");
    assert_matches_libgit2(dir.path(), "notes/a.md", "a\nB\ntyped\nD\n");
}

#[test]
fn a_renamed_note_keeps_the_authors_of_its_old_path() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    let me = ("Mario", "mario@example.com");
    let agent = ("Grok", "grok@agents.kore");
    let text = "one\ntwo\nthree\nfour\nfive\nsix\n";
    let first = commit_tree(
        &repo,
        &[],
        &[("inbox/old.md", Some(text))],
        me,
        "Update",
        true,
    );
    let edited = "one\ntwo\nTHREE\nfour\nfive\nsix\n";
    let second = commit_tree(
        &repo,
        &[first],
        &[("inbox/old.md", Some(edited))],
        agent,
        "Update",
        true,
    );
    let moved = "one\ntwo\nTHREE\nfour\nfive\nsix\nseven\n";
    let third = commit_tree(
        &repo,
        &[second],
        &[("inbox/old.md", None), ("notes/deep/new.md", Some(moved))],
        me,
        "Update",
        true,
    );
    commit_tree(
        &repo,
        &[third],
        &[("notes/z.md", Some("z\n"))],
        me,
        "Update",
        true,
    );

    let blame = assert_matches_libgit2(dir.path(), "notes/deep/new.md", moved);
    assert_eq!(author_of(&blame, 1).unwrap().author_name, "Mario");
    assert_eq!(author_of(&blame, 3).unwrap().author_name, "Grok");
    assert_eq!(blame.hunks.last().unwrap().commit, Some(third.to_string()));
}

#[test]
fn a_note_born_on_a_merged_branch_keeps_each_branch_edit() {
    // The vault sync's shape: the remote comes in as the second parent,
    // so the note is created and edited only off the first-parent line.
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    let me = ("Mario", "mario@example.com");
    let agent = ("Grok", "grok@agents.kore");
    let note = "daily/today.md";
    let main = commit_tree(&repo, &[], &[("other.md", Some("o\n"))], me, "Update", true);
    let created = commit_tree(
        &repo,
        &[main],
        &[(note, Some("a\nb\n"))],
        agent,
        "Update",
        false,
    );
    let edited = commit_tree(
        &repo,
        &[created],
        &[(note, Some("a\nb\nc\n"))],
        agent,
        "Update",
        false,
    );
    let main2 = commit_tree(
        &repo,
        &[main],
        &[("other.md", Some("o2\n"))],
        me,
        "Update",
        false,
    );
    // First parent has no note at all; second parent's version wins.
    let merge1 = commit_tree(
        &repo,
        &[main2, edited],
        &[(note, Some("a\nb\nc\n"))],
        me,
        "Update",
        false,
    );
    let side = commit_tree(
        &repo,
        &[merge1],
        &[(note, Some("a\nb\nc\nd\n"))],
        agent,
        "Update",
        false,
    );
    let merge2 = commit_tree(
        &repo,
        &[merge1, side],
        &[(note, Some("a\nb\nc\nd\n"))],
        me,
        "Update",
        false,
    );
    let edit2 = commit_tree(
        &repo,
        &[merge2],
        &[(note, Some("a\nB\nc\nd\n"))],
        me,
        "Update",
        false,
    );
    let merge3 = commit_tree(
        &repo,
        &[main2, edit2],
        &[(note, Some("a\nB\nc\nd\n"))],
        me,
        "Update",
        false,
    );
    // Each device merging the other (criss-cross), the note untouched.
    let cross_a = commit_tree(
        &repo,
        &[merge3, main2],
        &[("x.md", Some("1\n"))],
        me,
        "Update",
        false,
    );
    let cross_b = commit_tree(
        &repo,
        &[main2, merge3],
        &[("y.md", Some("2\n"))],
        me,
        "Update",
        false,
    );
    let top = commit_tree(
        &repo,
        &[cross_a, cross_b],
        &[("y.md", Some("2\n"))],
        me,
        "Update",
        false,
    );
    repo.set_head_detached(top).unwrap();

    let shown = "a\nB\nc\nd\ne\n";
    let blame = assert_matches_libgit2(dir.path(), note, shown);
    let expected = [created, edit2, edited, side];
    for (line, commit) in expected.iter().enumerate() {
        assert_eq!(blame_line(&blame, line + 1), Some(commit.to_string()));
    }
    assert_eq!(blame_line(&blame, 5), None);
}

fn blame_line(blame: &Blame, line: usize) -> Option<String> {
    owners(blame)[line - 1].clone()
}

#[test]
fn a_note_recreated_after_a_delete_starts_its_history_again() {
    let dir = tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    commit(
        &repo,
        "notes/a.md",
        "old\nline\n",
        ("Mario", "m@e.com"),
        "Add a",
    );
    let added = repo.head().unwrap().target().unwrap();
    commit_tree(
        &repo,
        &[added],
        &[("notes/a.md", None)],
        ("Mario", "m@e.com"),
        "Delete a",
        true,
    );
    commit(
        &repo,
        "notes/a.md",
        "old\nline\n",
        ("Grok", "grok@agents.kore"),
        "Add a",
    );

    let blame = blame(dir.path(), "notes/a.md", "old\nline\n").unwrap();
    assert_eq!(author_of(&blame, 1).unwrap().author_name, "Grok");
    assert_eq!(author_of(&blame, 2).unwrap().author_name, "Grok");
}

#[test]
fn a_path_outside_the_vault_is_refused() {
    let dir = tempdir().unwrap();
    Repository::init(dir.path()).unwrap();
    assert!(blame(dir.path(), "../secret.md", "x").is_err());
}
