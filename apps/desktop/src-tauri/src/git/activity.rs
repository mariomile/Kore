//! The graph's commit log as raw activity: who committed what, when, and
//! which files changed. A read-only primitive over the local backup
//! repository; grouping commits into sittings and naming authors (agents,
//! the host, the owner) is `@reflect/core`'s policy.

use std::path::Path;

use git2::{Delta, DiffOptions};
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Most commits one page may hold.
const MAX_PAGE: usize = 200;

/// One file a commit changed, against its first parent.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFile {
    /// Graph-relative, forward-slashed.
    pub path: String,
    pub kind: ActivityFileKind,
    /// The previous path of a rename.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum ActivityFileKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

/// A `Key: value` line from the message's final paragraph.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Trailer {
    pub key: String,
    pub value: String,
}

/// One commit, newest first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityCommit {
    pub commit: String,
    /// Author time, epoch milliseconds.
    pub time_ms: i64,
    pub author_name: String,
    pub author_email: String,
    /// First line of the message.
    pub summary: String,
    pub trailers: Vec<Trailer>,
    pub files: Vec<ActivityFile>,
}

/// A page of the log. `next` is the cursor for the following (older) page,
/// `None` at the first commit.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub commits: Vec<ActivityCommit>,
    pub next: Option<String>,
}

/// Up to `limit` commits following first parents, starting at `HEAD` or,
/// with `after`, at the first parent of that commit (a previous page's
/// `next`).
pub(super) fn activity(root: &Path, after: Option<&str>, limit: usize) -> AppResult<ActivityPage> {
    let repo = super::repo::open_existing(root)?;
    let limit = limit.clamp(1, MAX_PAGE);
    let mut current = match after {
        Some(cursor) => {
            let oid = git2::Oid::from_str(cursor)
                .map_err(|_| AppError::not_found(format!("unknown commit {cursor}")))?;
            let commit = repo
                .find_commit(oid)
                .map_err(|_| AppError::not_found(format!("unknown commit {cursor}")))?;
            commit.parent(0).ok()
        }
        None => match repo.head() {
            Ok(head) => Some(head.peel_to_commit()?),
            Err(_) => None, // Unborn branch: no commits yet.
        },
    };
    let mut commits = Vec::new();
    while let Some(commit) = current {
        if commits.len() == limit {
            return Ok(ActivityPage {
                next: commits
                    .last()
                    .map(|last: &ActivityCommit| last.commit.clone()),
                commits,
            });
        }
        let parent = commit.parent(0).ok();
        commits.push(describe(&repo, &commit, parent.as_ref())?);
        current = parent;
    }
    Ok(ActivityPage {
        commits,
        next: None,
    })
}

fn describe(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    parent: Option<&git2::Commit<'_>>,
) -> AppResult<ActivityCommit> {
    let author = commit.author();
    let message = commit.message().ok().unwrap_or_default().to_string();
    Ok(ActivityCommit {
        commit: commit.id().to_string(),
        time_ms: author.when().seconds() * 1000,
        author_name: author.name().ok().unwrap_or_default().to_string(),
        author_email: author.email().ok().unwrap_or_default().to_string(),
        summary: message.lines().next().unwrap_or_default().to_string(),
        trailers: trailers(&message),
        files: changed_files(repo, commit, parent)?,
    })
}

/// `Key: value` lines of the final paragraph, when every line there has
/// that shape and the message has more than one paragraph.
pub(super) fn trailers(message: &str) -> Vec<Trailer> {
    let paragraphs: Vec<&str> = message
        .trim()
        .split("\n\n")
        .filter(|paragraph| !paragraph.trim().is_empty())
        .collect();
    let [_, .., last] = paragraphs.as_slice() else {
        return Vec::new();
    };
    let parsed: Option<Vec<Trailer>> = last
        .lines()
        .map(|line| {
            let (key, value) = line.split_once(": ")?;
            let valid_key = !key.is_empty()
                && key
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-');
            valid_key.then(|| Trailer {
                key: key.to_string(),
                value: value.trim().to_string(),
            })
        })
        .collect();
    parsed.unwrap_or_default()
}

fn changed_files(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    parent: Option<&git2::Commit<'_>>,
) -> AppResult<Vec<ActivityFile>> {
    let tree = commit.tree()?;
    let parent_tree = match parent {
        Some(parent) => Some(parent.tree()?),
        None => None,
    };
    let mut options = DiffOptions::new();
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))?;
    diff.find_similar(None)?;
    let path_of = |file: git2::DiffFile<'_>| {
        file.path()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
    };
    let mut files = Vec::new();
    for delta in diff.deltas() {
        let kind = match delta.status() {
            Delta::Added | Delta::Copied => ActivityFileKind::Added,
            Delta::Deleted => ActivityFileKind::Deleted,
            Delta::Renamed => ActivityFileKind::Renamed,
            Delta::Modified | Delta::Typechange => ActivityFileKind::Modified,
            _ => continue,
        };
        let path = match kind {
            ActivityFileKind::Deleted => path_of(delta.old_file()),
            _ => path_of(delta.new_file()),
        };
        let Some(path) = path else { continue };
        let old_path = (kind == ActivityFileKind::Renamed)
            .then(|| path_of(delta.old_file()))
            .flatten();
        files.push(ActivityFile {
            path,
            kind,
            old_path,
        });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailers_come_only_from_a_final_key_value_paragraph() {
        assert_eq!(
            trailers("Update A\n\nKore-Agent: Grok bot\n"),
            vec![Trailer {
                key: "Kore-Agent".into(),
                value: "Grok bot".into()
            }]
        );
        assert!(trailers("Kore-Agent: Grok").is_empty());
        assert!(trailers("Update A\n\nSome prose: with a colon\nand more").is_empty());
    }
}
