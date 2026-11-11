//! Who last changed each line of a note (Plan 33, A3): `git blame` over the
//! graph's backup repository, run against the text the caller is showing so
//! line numbers match it exactly. A read-only primitive; naming authors
//! (agents, the host, the owner) and drawing the shading is `@kore/core`'s
//! and the editor's policy.

use std::collections::BTreeMap;
use std::path::Path;

use git2::{BlameOptions, ErrorCode, Oid};
use serde::Serialize;

use crate::error::AppResult;

use super::activity::{trailers, Trailer};

/// A run of consecutive lines last changed by the same commit.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    /// 1-based line in the blamed text.
    pub start_line: usize,
    pub lines: usize,
    /// `None` for lines no commit holds yet (typed since the last backup
    /// commit).
    pub commit: Option<String>,
}

/// A commit some hunk points at.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    /// Author time, epoch milliseconds.
    pub time_ms: i64,
    pub author_name: String,
    pub author_email: String,
    pub trailers: Vec<Trailer>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub hunks: Vec<BlameHunk>,
    /// Keyed by full commit id.
    pub commits: BTreeMap<String, BlameCommit>,
}

/// Blame `rel_path` as `HEAD` holds it, then `content` against that, so a
/// line the caller has but no commit does comes back with no commit. A note
/// `HEAD` doesn't have (new, or an unborn branch) is all uncommitted.
pub(super) fn blame(root: &Path, rel_path: &str, content: &str) -> AppResult<Blame> {
    crate::fs::ensure_relative(rel_path)?;
    let repo = super::repo::open_existing(root)?;
    let total_lines = content.lines().count();
    let uncommitted = || Blame {
        hunks: (total_lines > 0)
            .then_some(BlameHunk {
                start_line: 1,
                lines: total_lines,
                commit: None,
            })
            .into_iter()
            .collect(),
        commits: BTreeMap::new(),
    };
    if repo.head().is_err() {
        return Ok(uncommitted()); // Unborn branch: no commits yet.
    }
    let mut options = BlameOptions::new();
    let committed = match repo.blame_file(Path::new(rel_path), Some(&mut options)) {
        Ok(blame) => blame,
        Err(error) if error.code() == ErrorCode::NotFound => {
            return Ok(uncommitted());
        }
        Err(error) => return Err(error.into()),
    };
    let blame = committed.blame_buffer(content.as_bytes())?;
    let mut hunks = Vec::new();
    let mut commits = BTreeMap::new();
    for hunk in blame.iter() {
        let lines = hunk.lines_in_hunk();
        if lines == 0 {
            continue;
        }
        let id = hunk.final_commit_id();
        let commit = if id == Oid::ZERO_SHA1 {
            None
        } else {
            let key = id.to_string();
            if !commits.contains_key(&key) {
                commits.insert(key.clone(), describe(&repo, id)?);
            }
            Some(key)
        };
        hunks.push(BlameHunk {
            start_line: hunk.final_start_line(),
            lines,
            commit,
        });
    }
    Ok(Blame { hunks, commits })
}

fn describe(repo: &git2::Repository, id: Oid) -> AppResult<BlameCommit> {
    let commit = repo.find_commit(id)?;
    let author = commit.author();
    let message = commit.message().ok().unwrap_or_default();
    Ok(BlameCommit {
        time_ms: author.when().seconds() * 1000,
        author_name: author.name().ok().unwrap_or_default().to_string(),
        author_email: author.email().ok().unwrap_or_default().to_string(),
        trailers: trailers(message),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use git2::{Repository, Signature};
    use tempfile::tempdir;

    use super::*;

    fn commit(repo: &Repository, rel: &str, text: &str, who: (&str, &str), message: &str) {
        let root = repo.workdir().unwrap();
        fs::create_dir_all(root.join(rel).parent().unwrap()).unwrap();
        fs::write(root.join(rel), text).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(rel)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = Signature::now(who.0, who.1).unwrap();
        let parent = repo.head().ok().map(|head| head.peel_to_commit().unwrap());
        let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .unwrap();
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

    #[test]
    fn a_path_outside_the_vault_is_refused() {
        let dir = tempdir().unwrap();
        Repository::init(dir.path()).unwrap();
        assert!(blame(dir.path(), "../secret.md", "x").is_err());
    }
}
