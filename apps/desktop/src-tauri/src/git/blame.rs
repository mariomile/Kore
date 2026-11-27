//! Who last changed each line of a note (Plan 33, A3): `git blame` over the
//! graph's backup repository, run against the text the caller is showing so
//! line numbers match it exactly. A read-only primitive; naming authors
//! (agents, the host, the owner) and drawing the shading is `@kore/core`'s
//! and the editor's policy.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use git2::{Delta, DiffFindOptions, DiffOptions, ErrorCode, Oid, Patch};
use serde::Serialize;

use crate::error::AppResult;

use super::activity::{trailers, Trailer};
use super::history::{blob_in_chain, folder_chain, parent_chain, FolderChain, MAX_WALKED_COMMITS};

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
    let Ok(head) = repo.head().and_then(|head| head.peel_to_commit()) else {
        return Ok(uncommitted(content)); // Unborn branch: no commits yet.
    };
    let blob = match head.tree()?.get_path(Path::new(rel_path)) {
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
                    let committed = Arc::new(walk(&repo, head, rel_path)?);
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
/// Classic blame over the note's own versions. Lines start at `HEAD` and
/// travel back through the commit graph, newest commit first. A commit that
/// left the note as one of its parents had it passes every line to that
/// parent (git's TREESAME rule, so a merge that took one side's version
/// follows that side). Otherwise each parent that held the note, or a file
/// the commit renamed into it, takes the lines that survive unchanged from
/// its version, and the lines no parent explains belong to the commit.
/// libgit2's `blame_file` reaches the same answer by examining every commit
/// in the history; on a vault with thousands of autosave commits that took
/// seconds for a short note and most of a minute (and over a gigabyte) for a
/// long one. Here a commit that leaves the note alone costs a root tree and
/// an entry lookup per folder, and only the note's own versions are diffed.
fn walk(repo: &git2::Repository, head: git2::Commit<'_>, rel_path: &str) -> AppResult<Committed> {
    let mut walk = GraphWalk::new(repo);
    let components = path_components(rel_path);
    let chain = folder_chain(repo, head.tree()?, &components);
    let Some(blob) = blob_in_chain(&chain, &components) else {
        return Ok(walk.finish());
    };
    let count = line_count(repo.find_blob(blob)?.content());
    walk.owners = vec![None; count];
    walk.queue(Origin {
        commit: head,
        path: rel_path.to_owned(),
        chain,
        blob,
        lines: (0..count).map(|line| (line, line)).collect(),
    });
    let mut walked = 0;
    while let Some(origin) = walk.next() {
        walked += 1;
        if walked > MAX_WALKED_COMMITS {
            // Lines older than the ceiling keep the oldest commit that still
            // held them, as `git blame` does past a cut-off.
            walk.claim(&origin.commit, &origin.lines);
            while let Some(origin) = walk.next() {
                walk.claim(&origin.commit, &origin.lines);
            }
            break;
        }
        walk.step(origin)?;
    }
    Ok(walk.finish())
}

fn path_components(rel_path: &str) -> Vec<&str> {
    rel_path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect()
}

/// Lines of the note at `HEAD` still looking for their author, as they stood
/// in one commit.
struct Origin<'repo> {
    commit: git2::Commit<'repo>,
    /// The note's path in `commit` (it differs from `HEAD`'s past a rename).
    path: String,
    chain: FolderChain<'repo>,
    blob: Oid,
    /// (line at `HEAD`, line in `blob`), both 0-based.
    lines: Vec<(usize, usize)>,
}

/// Queue order: newest commit first, so lines reaching a commit along
/// several branches arrive together before it is examined.
type OriginKey = (i64, Oid, String);

struct GraphWalk<'repo> {
    repo: &'repo git2::Repository,
    pending: BTreeMap<OriginKey, Origin<'repo>>,
    /// Index into `commits` for each line at `HEAD`, once claimed.
    owners: Vec<Option<usize>>,
    commits: Vec<(String, BlameCommit)>,
    described: HashMap<Oid, usize>,
}

impl<'repo> GraphWalk<'repo> {
    fn new(repo: &'repo git2::Repository) -> Self {
        Self {
            repo,
            pending: BTreeMap::new(),
            owners: Vec::new(),
            commits: Vec::new(),
            described: HashMap::new(),
        }
    }

    fn queue(&mut self, origin: Origin<'repo>) {
        if origin.lines.is_empty() {
            return;
        }
        let key = (
            origin.commit.time().seconds(),
            origin.commit.id(),
            origin.path.clone(),
        );
        match self.pending.get_mut(&key) {
            Some(queued) => queued.lines.extend(origin.lines),
            None => {
                self.pending.insert(key, origin);
            }
        }
    }

    fn next(&mut self) -> Option<Origin<'repo>> {
        self.pending.pop_last().map(|(_, origin)| origin)
    }

    /// `commit` last changed these lines.
    fn claim(&mut self, commit: &git2::Commit<'_>, lines: &[(usize, usize)]) {
        if lines.is_empty() {
            return;
        }
        let index = match self.described.get(&commit.id()) {
            Some(&index) => index,
            None => {
                let index = self.commits.len();
                self.commits
                    .push((commit.id().to_string(), describe(commit)));
                self.described.insert(commit.id(), index);
                index
            }
        };
        for &(head_line, _) in lines {
            self.owners[head_line].get_or_insert(index);
        }
    }

    /// Hand `origin`'s lines to the parents they survive into, and claim the
    /// rest for its commit.
    fn step(&mut self, origin: Origin<'repo>) -> AppResult<()> {
        let repo = self.repo;
        let components = path_components(&origin.path);
        let mut parents = Vec::new();
        for parent in origin.commit.parents() {
            let chain = parent_chain(repo, &origin.chain, parent.tree()?, &components);
            let found = match blob_in_chain(&chain, &components) {
                Some(blob) => Some((origin.path.clone(), chain, blob)),
                None => renamed_from(repo, &parent, &origin.commit, &origin.path)?,
            };
            if let Some((path, chain, blob)) = found {
                parents.push(Origin {
                    commit: parent,
                    path,
                    chain,
                    blob,
                    lines: Vec::new(),
                });
            }
        }
        // TREESAME: a parent with this very version explains every line.
        if let Some(same) = parents.iter().position(|parent| parent.blob == origin.blob) {
            let mut parent = parents.swap_remove(same);
            parent.lines = origin.lines;
            self.queue(parent);
            return Ok(());
        }
        let own = repo.find_blob(origin.blob)?;
        let mut left = origin.lines;
        for mut parent in parents {
            if left.is_empty() {
                break;
            }
            let survived = map_lines(repo.find_blob(parent.blob)?.content(), own.content())?;
            left.retain(
                |&(head_line, line)| match survived.get(line).copied().flatten() {
                    Some(older) => {
                        parent.lines.push((head_line, older));
                        false
                    }
                    None => true,
                },
            );
            self.queue(parent);
        }
        self.claim(&origin.commit, &left);
        Ok(())
    }

    fn finish(self) -> Committed {
        Committed {
            // Every walk ends with each line claimed; an empty note has none.
            lines: self
                .owners
                .into_iter()
                .map(|owner| owner.unwrap_or_default())
                .collect(),
            commits: self.commits,
        }
    }
}

/// When `commit` brought `path` in by renaming a file of `parent`, that
/// file's path, folder chain, and blob in `parent`.
fn renamed_from<'repo>(
    repo: &'repo git2::Repository,
    parent: &git2::Commit<'repo>,
    commit: &git2::Commit<'repo>,
    path: &str,
) -> AppResult<Option<(String, FolderChain<'repo>, Oid)>> {
    let parent_tree = parent.tree()?;
    let mut diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit.tree()?), None)?;
    let mut options = DiffFindOptions::new();
    options.renames(true);
    diff.find_similar(Some(&mut options))?;
    let old = diff.deltas().find_map(|delta| {
        let renamed =
            delta.status() == Delta::Renamed && delta.new_file().path() == Some(Path::new(path));
        renamed
            .then(|| delta.old_file().path()?.to_str().map(str::to_owned))
            .flatten()
    });
    let Some(old) = old else {
        return Ok(None);
    };
    let components = path_components(&old);
    let chain = folder_chain(repo, parent_tree, &components);
    Ok(blob_in_chain(&chain, &components).map(|blob| (old.clone(), chain, blob)))
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

fn describe(commit: &git2::Commit<'_>) -> BlameCommit {
    let author = commit.author();
    let message = commit.message().ok().unwrap_or_default();
    BlameCommit {
        time_ms: author.when().seconds() * 1000,
        author_name: author.name().ok().unwrap_or_default().to_string(),
        author_email: author.email().ok().unwrap_or_default().to_string(),
        trailers: trailers(message),
    }
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

    /// Commit `files` (`None` removes one) over the first parent's tree,
    /// with exactly `parents`; moves `HEAD` only when `head` is set.
    fn commit_tree(
        repo: &Repository,
        parents: &[Oid],
        files: &[(&str, Option<&str>)],
        who: (&str, &str),
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
                    let mut entry = git2::IndexEntry {
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
                        path: Vec::new(),
                    };
                    entry.path = path.as_bytes().to_vec();
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
            "Update",
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
        let base = commit_tree(&repo, &[], &[("notes/a.md", Some("a\nb\nc\n"))], me, true);
        let edit = commit_tree(
            &repo,
            &[base],
            &[("notes/a.md", Some("a\nB\nc\n"))],
            agent,
            false,
        );
        let other = commit_tree(&repo, &[base], &[("notes/b.md", Some("x\n"))], me, true);
        let merge = commit_tree(
            &repo,
            &[other, edit],
            &[("notes/a.md", Some("a\nB\nc\n"))],
            me,
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
            true,
        );
        let ours = commit_tree(
            &repo,
            &[base],
            &[("notes/a.md", Some("a\nb\nc\nD\ne\n"))],
            me,
            true,
        );
        let theirs = commit_tree(
            &repo,
            &[base],
            &[("notes/a.md", Some("a\nB\nc\nd\ne\n"))],
            agent,
            false,
        );
        let merged = "a\nB\nc\nD\nboth\ne\n";
        commit_tree(
            &repo,
            &[ours, theirs],
            &[("notes/a.md", Some(merged))],
            host,
            true,
        );
        commit_tree(
            &repo,
            &[repo.head().unwrap().target().unwrap()],
            &[("notes/z.md", Some("z\n"))],
            me,
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
        let first = commit_tree(&repo, &[], &[("inbox/old.md", Some(text))], me, true);
        let edited = "one\ntwo\nTHREE\nfour\nfive\nsix\n";
        let second = commit_tree(
            &repo,
            &[first],
            &[("inbox/old.md", Some(edited))],
            agent,
            true,
        );
        let moved = "one\ntwo\nTHREE\nfour\nfive\nsix\nseven\n";
        let third = commit_tree(
            &repo,
            &[second],
            &[("inbox/old.md", None), ("notes/deep/new.md", Some(moved))],
            me,
            true,
        );
        commit_tree(&repo, &[third], &[("notes/z.md", Some("z\n"))], me, true);

        let blame = assert_matches_libgit2(dir.path(), "notes/deep/new.md", moved);
        assert_eq!(author_of(&blame, 1).unwrap().author_name, "Mario");
        assert_eq!(author_of(&blame, 3).unwrap().author_name, "Grok");
        assert_eq!(blame.hunks.last().unwrap().commit, Some(third.to_string()));
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
