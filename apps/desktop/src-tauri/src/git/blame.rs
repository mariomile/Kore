//! Who last changed each line of a note (Plan 33, A3): `git blame` over the
//! graph's backup repository, run against the text the caller is showing so
//! line numbers match it exactly. A read-only primitive; naming authors
//! (agents, the host, the owner) and drawing the shading is `@kore/core`'s
//! and the editor's policy.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use git2::{DiffOptions, ErrorCode, Oid, Patch};
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
#[derive(Debug, Clone, Serialize)]
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

/// The history walk for one committed version of a note: which commit last
/// changed each of its lines. It depends only on that blob's history, so it
/// is computed once per blob and reused for every text shown against it.
struct Committed {
    /// Index into `commits` for each line of the blob, line 1 first.
    lines: Vec<usize>,
    /// Full commit id and description, in first-seen order.
    commits: Vec<(String, BlameCommit)>,
}

struct CacheEntry {
    root: PathBuf,
    path: String,
    blob: Oid,
    committed: Arc<Committed>,
}

/// Recent walks, newest last. A handful covers the notes a person moves
/// between; each holds a line index and a few commit descriptions.
const CACHE_ENTRIES: usize = 16;
static CACHE: Mutex<Vec<CacheEntry>> = Mutex::new(Vec::new());

/// One history walk at a time. A walk over a long backup history inflates
/// thousands of blobs; run side by side (a note opened while the last one's
/// walk is still going, the editor's periodic refresh) they took every core
/// and gigabytes of memory. Queued requests for the same blob find the
/// result in the cache once the walk ahead of them finishes.
static WALK: Mutex<()> = Mutex::new(());

fn cached(root: &Path, path: &str, blob: Oid) -> Option<Arc<Committed>> {
    let cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
    cache
        .iter()
        .find(|entry| entry.blob == blob && entry.path == path && entry.root == root)
        .map(|entry| Arc::clone(&entry.committed))
}

fn remember(root: &Path, path: &str, blob: Oid, committed: Arc<Committed>) {
    let mut cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
    // A note keeps one entry: its older blobs are superseded by this one.
    cache.retain(|entry| !(entry.path == path && entry.root == root));
    if cache.len() >= CACHE_ENTRIES {
        cache.remove(0);
    }
    cache.push(CacheEntry {
        root: root.to_path_buf(),
        path: path.to_owned(),
        blob,
        committed,
    });
}

/// Blame `rel_path` as `HEAD` holds it, then `content` against that, so a
/// line the caller has but no commit does comes back with no commit. A note
/// `HEAD` doesn't have (new, or an unborn branch) is all uncommitted.
pub(super) fn blame(root: &Path, rel_path: &str, content: &str) -> AppResult<Blame> {
    crate::fs::ensure_relative(rel_path)?;
    let repo = super::repo::open_existing(root)?;
    let Ok(head) = repo.head().and_then(|head| head.peel_to_tree()) else {
        return Ok(uncommitted(content)); // Unborn branch: no commits yet.
    };
    let blob = match head.get_path(Path::new(rel_path)) {
        Ok(entry) => entry.id(),
        Err(error) if error.code() == ErrorCode::NotFound => return Ok(uncommitted(content)),
        Err(error) => return Err(error.into()),
    };
    let committed = match cached(root, rel_path, blob) {
        Some(committed) => committed,
        None => {
            let _walk = WALK.lock().unwrap_or_else(PoisonError::into_inner);
            match cached(root, rel_path, blob) {
                Some(committed) => committed,
                None => {
                    let committed = Arc::new(walk(&repo, rel_path)?);
                    remember(root, rel_path, blob, Arc::clone(&committed));
                    committed
                }
            }
        }
    };
    let text = repo.find_blob(blob)?;
    let shown = map_lines(text.content(), content.as_bytes())?;
    Ok(assemble(&committed, &shown))
}

fn uncommitted(content: &str) -> Blame {
    let total_lines = content.lines().count();
    Blame {
        hunks: (total_lines > 0)
            .then_some(BlameHunk {
                start_line: 1,
                lines: total_lines,
                commit: None,
            })
            .into_iter()
            .collect(),
        commits: BTreeMap::new(),
    }
}

/// The history walk: who last changed each line of the note at `HEAD`.
///
/// Classic blame over the note's own versions: walking back through the
/// commits that changed it (first parents, as the backup history is linear),
/// each version's lines that survive unchanged from the version before pass
/// back to it, and the rest belong to the commit that wrote that version. A
/// note created in a commit leaves all its remaining lines to that commit.
/// libgit2's `blame_file` reaches the same answer by examining every commit
/// in the history; on a vault with thousands of autosave commits that took
/// seconds for a short note and most of a minute (and over a gigabyte) for a
/// long one. Here the cost is one tree lookup per commit plus a line diff per
/// version of the note.
fn walk(repo: &git2::Repository, rel_path: &str) -> AppResult<Committed> {
    let mut walk = VersionWalk::default();
    super::history::walk_note_changes(repo, rel_path, |commit, own, before| {
        walk.step(repo, commit, own, before)
    })?;
    Ok(walk.finish())
}

/// The state of [`walk`] between two versions of the note.
#[derive(Default)]
struct VersionWalk {
    /// Index into `commits` for each line at `HEAD`, once claimed.
    owners: Vec<Option<usize>>,
    /// Lines still looking for their author: (line at `HEAD`, line in the
    /// version being examined), both 0-based.
    pending: Vec<(usize, usize)>,
    commits: Vec<(String, BlameCommit)>,
}

impl VersionWalk {
    /// `commit` wrote blob `own` over `before` (`None`: it created the note).
    /// Returns whether any line is still unclaimed.
    fn step(
        &mut self,
        repo: &git2::Repository,
        commit: &git2::Commit<'_>,
        own: Oid,
        before: Option<Oid>,
    ) -> AppResult<bool> {
        let own = repo.find_blob(own)?;
        if self.commits.is_empty() {
            let count = line_count(own.content());
            self.owners = vec![None; count];
            self.pending = (0..count).map(|line| (line, line)).collect();
        }
        let index = self.commits.len();
        self.commits
            .push((commit.id().to_string(), describe(repo, commit.id())?));
        let survived = match before {
            Some(before) => map_lines(repo.find_blob(before)?.content(), own.content())?,
            None => Vec::new(),
        };
        let owners = &mut self.owners;
        self.pending.retain_mut(
            |(head_line, line)| match survived.get(*line).copied().flatten() {
                Some(older) => {
                    *line = older;
                    true
                }
                None => {
                    owners[*head_line] = Some(index);
                    false
                }
            },
        );
        Ok(!self.pending.is_empty())
    }

    fn finish(self) -> Committed {
        // A walk cut short by its ceiling leaves lines that date from before
        // it: the oldest commit examined is the best name left for them.
        let oldest = self.commits.len().saturating_sub(1);
        let lines = self
            .owners
            .into_iter()
            .map(|owner| owner.unwrap_or(oldest))
            .collect();
        Committed {
            lines,
            commits: self.commits,
        }
    }
}

fn line_count(text: &[u8]) -> usize {
    String::from_utf8_lossy(text).lines().count()
}

/// For each line of `shown`, the line of `committed` it is unchanged from
/// (0-based), or `None` for a line added or edited since. The same line diff
/// `git blame` runs against a buffer.
fn map_lines(committed: &[u8], shown: &[u8]) -> AppResult<Vec<Option<usize>>> {
    let shown_lines = line_count(shown);
    let mut map = vec![None; shown_lines];
    let mut options = DiffOptions::new();
    options.context_lines(0);
    let patch = Patch::from_buffers(committed, None, shown, None, Some(&mut options))?;
    // Lines between hunks are unchanged and pair up one to one.
    let (mut old, mut new) = (0usize, 0usize);
    let mut copy_until = |old_end: usize, old: &mut usize, new: &mut usize| {
        while *old < old_end && *new < shown_lines {
            map[*new] = Some(*old);
            *old += 1;
            *new += 1;
        }
    };
    for index in 0..patch.num_hunks() {
        let (hunk, _) = patch.hunk(index)?;
        let old_lines = hunk.old_lines() as usize;
        // With no context, a pure insertion names the line it follows.
        let old_start = hunk.old_start() as usize;
        let old_begin = if old_lines == 0 {
            old_start
        } else {
            old_start - 1
        };
        copy_until(old_begin, &mut old, &mut new);
        old += old_lines;
        new += hunk.new_lines() as usize;
    }
    copy_until(usize::MAX, &mut old, &mut new);
    Ok(map)
}

fn assemble(committed: &Committed, shown: &[Option<usize>]) -> Blame {
    let mut hunks: Vec<BlameHunk> = Vec::new();
    let mut commits = BTreeMap::new();
    for (index, line) in shown.iter().enumerate() {
        let commit = line
            .and_then(|line| committed.lines.get(line))
            .map(|&commit| &committed.commits[commit]);
        let id = commit.map(|(id, _)| id.clone());
        if let Some((id, description)) = commit {
            commits
                .entry(id.clone())
                .or_insert_with(|| description.clone());
        }
        match hunks.last_mut() {
            Some(last) if last.commit == id => last.lines += 1,
            _ => hunks.push(BlameHunk {
                start_line: index + 1,
                lines: 1,
                commit: id,
            }),
        }
    }
    Blame { hunks, commits }
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
        let mut index = repo.index().unwrap();
        index.remove_path(Path::new("notes/a.md")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = Signature::now("Mario", "m@e.com").unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Delete a",
            &tree,
            &[&parent],
        )
        .unwrap();
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
}
