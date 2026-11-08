//! `kore mcp --sync` and `kore sync` — keep a git clone of the vault in step
//! with its remote, so `kore mcp --http` can run on an always-on host while
//! the Mac keeps editing the same vault (Plan 32, slice 2).
//!
//! Two writers share one git remote: the Mac (the app's git sync, or any job
//! that commits and pushes) and the host, whose only writer is this module.
//! The host never merges text. Every write an agent makes is a *structural*
//! CLI operation (append a bullet, claim a new file, splice one frontmatter
//! key, one tag line, one task marker), so the host records the operation
//! itself in a journal next to its commit. When the remote has moved:
//!
//! 1. no unpushed host commits: fast-forward;
//! 2. unpushed commits that rebase cleanly: rebase;
//! 3. a rebase that conflicts: abort, reset to the remote, and **replay** the
//!    journal's operations through the CLI on top of the Mac's version.
//!
//! Replay re-runs the same subcommand with the same arguments, so privacy,
//! path and write rules stay the CLI's, and the result is what the agent
//! would have got had it written a moment later. The host therefore never
//! commits conflict markers and never wedges; an operation that no longer
//! applies (its note was deleted on the Mac) is dropped and logged. Conflicts
//! can still happen on the *Mac*, where the app's git sync already commits
//! them as markers (Plan 12).
//!
//! After every pull that changed files, and after every write, the index is
//! refreshed with `kore index` so search sees the new state.
//!
//! The clone must be dedicated to the host: a dirty working tree at start is
//! refused, and `.reflect/` is added to `.git/info/exclude` (never to the
//! vault's own `.gitignore`) so the index is never committed.

use crate::agent_identity::AgentIdentity;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};

use crate::error::CliError;
use crate::mcp::{RunOutput, Runner};

/// Subcommands that only read. Anything else (including subcommands added
/// later) is treated as a write: serialized, committed when it changed the
/// tree, and journaled.
const READS: &[&str] = &[
    "today",
    "search",
    "show",
    "path",
    "open",
    "tasks",
    "backlinks",
    "recent",
    "collection",
    "info",
    "guide",
    "tags",
    "list",
    "properties",
    "links",
    "grep",
    "route",
    "explain",
    "skills",
    "active",
];

/// Who signs the host's commits.
const AUTHOR_NAME: &str = "Kore host";
const AUTHOR_EMAIL: &str = "kore-host@localhost";

/// Attempts at fetch → integrate → push before giving up until the next sync.
const PUSH_ATTEMPTS: usize = 3;

/// One agent write, as the CLI ran it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Operation {
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdin: Option<String>,
    /// The agent that asked for the write; `None` is the owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentIdentity>,
}

impl Operation {
    fn is_read(&self) -> bool {
        is_read(&self.args)
    }
}

fn is_read(args: &[String]) -> bool {
    let Some(subcommand) = args.first() else {
        return true;
    };
    READS.contains(&subcommand.as_str()) && !args.iter().any(|arg| arg == "--init")
}

/// Where the host's clone syncs to.
#[derive(Debug, Clone)]
pub struct SyncOptions {
    /// The git remote (default `origin`).
    pub remote: String,
    /// The branch; `None` means the clone's current branch.
    pub branch: Option<String>,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            remote: "origin".into(),
            branch: None,
        }
    }
}

/// What one sync pass did, for logs and `kore sync --json`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Remote commits taken in.
    pub pulled: usize,
    /// Host commits pushed.
    pub pushed: usize,
    /// Operations re-run on top of the remote after a conflicting rebase.
    pub replayed: usize,
    /// Operations that no longer applied and were dropped, with the reason.
    pub dropped: Vec<String>,
    /// Whether the index was refreshed.
    pub reindexed: bool,
    /// Set when the remote could not be reached; writes stay journaled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline: Option<String>,
}

/// Thin wrapper over the `git` binary, rooted at the clone.
struct Git {
    root: PathBuf,
}

struct GitOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

impl Git {
    fn run(&self, args: &[&str]) -> Result<GitOutput, CliError> {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.root)
            .args(["-c", &format!("user.name={AUTHOR_NAME}")])
            .args(["-c", &format!("user.email={AUTHOR_EMAIL}")])
            .args(["-c", "commit.gpgsign=false"])
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|err| CliError::runtime(format!("could not run git: {err}")))?;
        Ok(GitOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        })
    }

    /// Run and require success.
    fn ok(&self, args: &[&str]) -> Result<String, CliError> {
        let output = self.run(args)?;
        if output.success {
            Ok(output.stdout)
        } else {
            Err(CliError::runtime(format!(
                "git {} failed: {}",
                args.join(" "),
                output.stderr
            )))
        }
    }

    fn count(&self, range: &str) -> Result<usize, CliError> {
        let count = self.ok(&["rev-list", "--count", range])?;
        count
            .parse()
            .map_err(|_| CliError::runtime(format!("git rev-list gave {count:?}")))
    }

    fn dirty(&self) -> Result<bool, CliError> {
        Ok(!self.ok(&["status", "--porcelain"])?.is_empty())
    }
}

/// The host's sync state: the journal of unpushed operations.
struct Journal {
    path: PathBuf,
    operations: Vec<Operation>,
}

impl Journal {
    fn load(path: PathBuf) -> Result<Self, CliError> {
        let operations = match fs::read_to_string(&path) {
            Ok(text) => text
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(serde_json::from_str)
                .collect::<Result<_, _>>()
                .map_err(|err| {
                    CliError::runtime(format!("unreadable sync journal {}: {err}", path.display()))
                })?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(err) => return Err(err.into()),
        };
        Ok(Self { path, operations })
    }

    fn save(&self) -> Result<(), CliError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("jsonl.tmp");
        let mut file = fs::File::create(&temporary)?;
        for operation in &self.operations {
            let line = serde_json::to_string(operation)
                .map_err(|err| CliError::runtime(err.to_string()))?;
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
        fs::rename(&temporary, &self.path)?;
        Ok(())
    }
}

/// A git-synced vault in front of a [`Runner`]. Reads run concurrently;
/// writes and syncs are exclusive, so nothing reads a tree mid-reset.
pub struct VaultSync<R: Runner> {
    inner: R,
    git: Git,
    remote: String,
    branch: String,
    /// Exclusive for writes and syncs, shared for reads.
    tree: RwLock<()>,
    journal: Mutex<Journal>,
    /// Print what each sync did on stderr (the long-running server does).
    pub log: bool,
}

impl<R: Runner> VaultSync<R> {
    /// Prepare `root` (a git clone) for syncing through `inner`, which runs
    /// `kore` subcommands against the same folder.
    pub fn open(root: &Path, inner: R, options: SyncOptions) -> Result<Self, CliError> {
        let git = Git {
            root: root.to_path_buf(),
        };
        let inside = git.run(&["rev-parse", "--is-inside-work-tree"])?;
        if !inside.success || inside.stdout != "true" {
            return Err(CliError::Usage(format!(
                "--sync needs the graph to be a git clone; {} is not one",
                root.display()
            )));
        }
        let branch = match options.branch {
            Some(branch) => branch,
            None => git.ok(&["symbolic-ref", "--short", "HEAD"]).map_err(|_| {
                CliError::Usage("--sync needs a checked-out branch (HEAD is detached)".into())
            })?,
        };
        if !git.run(&["remote", "get-url", &options.remote])?.success {
            return Err(CliError::Usage(format!(
                "the clone has no git remote named {}",
                options.remote
            )));
        }
        let git_dir = PathBuf::from(git.ok(&["rev-parse", "--absolute-git-dir"])?);
        exclude_index(&git, &git_dir)?;
        if git.dirty()? {
            return Err(CliError::Usage(format!(
                "{} has uncommitted changes; the synced clone must only be written by kore \
                 (commit or discard them first)",
                root.display()
            )));
        }
        let journal = Journal::load(git_dir.join("kore-sync").join("journal.jsonl"))?;
        Ok(Self {
            inner,
            git,
            remote: options.remote,
            branch,
            tree: RwLock::new(()),
            journal: Mutex::new(journal),
            log: false,
        })
    }

    fn upstream(&self) -> String {
        format!("{}/{}", self.remote, self.branch)
    }

    /// Fetch, integrate the remote, push what the host wrote, and refresh
    /// the index when anything changed.
    pub fn sync(&self) -> Result<SyncReport, CliError> {
        let _tree = self.tree.write().unwrap_or_else(|err| err.into_inner());
        let mut journal = self.journal.lock().unwrap_or_else(|err| err.into_inner());
        let mut report = SyncReport::default();
        self.sync_locked(&mut journal, &mut report)?;
        if report.pulled > 0 || report.replayed > 0 {
            report.reindexed = self.reindex();
        }
        if self.log {
            log_report(&report);
        }
        Ok(report)
    }

    fn sync_locked(&self, journal: &mut Journal, report: &mut SyncReport) -> Result<(), CliError> {
        let upstream = self.upstream();
        for _ in 0..PUSH_ATTEMPTS {
            let fetch = self
                .git
                .run(&["fetch", "--quiet", &self.remote, &self.branch])?;
            if !fetch.success {
                report.offline = Some(fetch.stderr);
                return Ok(());
            }
            let behind = self.git.count(&format!("HEAD..{upstream}"))?;
            let ahead = self.git.count(&format!("{upstream}..HEAD"))?;
            if behind > 0 {
                report.pulled += behind;
                if ahead == 0 {
                    self.git.ok(&["merge", "--ff-only", "--quiet", &upstream])?;
                } else if !self.git.run(&["rebase", "--quiet", &upstream])?.success {
                    let _ = self.git.run(&["rebase", "--abort"]);
                    self.git.ok(&["reset", "--hard", "--quiet", &upstream])?;
                    self.replay(journal, report)?;
                }
            }
            if self.git.count(&format!("{upstream}..HEAD"))? == 0 {
                journal.operations.clear();
                journal.save()?;
                return Ok(());
            }
            let pushed = self.git.count(&format!("{upstream}..HEAD"))?;
            let refspec = format!("HEAD:refs/heads/{}", self.branch);
            let push = self
                .git
                .run(&["push", "--quiet", "--porcelain", &self.remote, &refspec])?;
            if push.success {
                // Update the remote-tracking ref the push moved.
                let _ = self
                    .git
                    .run(&["fetch", "--quiet", &self.remote, &self.branch]);
                report.pushed += pushed;
                journal.operations.clear();
                journal.save()?;
                return Ok(());
            }
            if !rejected(&push) {
                report.offline = Some(push.stderr);
                return Ok(());
            }
            // Someone pushed in between: fetch and integrate again.
        }
        Err(CliError::runtime(format!(
            "the remote kept moving; {} write(s) stay journaled for the next sync",
            journal.operations.len()
        )))
    }

    /// Re-run every journaled operation on top of the freshly reset tree,
    /// one commit each; drop the ones that no longer apply.
    fn replay(&self, journal: &mut Journal, report: &mut SyncReport) -> Result<(), CliError> {
        let mut kept = Vec::with_capacity(journal.operations.len());
        for operation in journal.operations.drain(..) {
            let output = self.inner.run(&operation.args, operation.stdin.as_deref());
            if output.success && self.commit(&operation)? {
                report.replayed += 1;
                kept.push(operation);
            } else {
                // A failed write leaves the tree as it was; make sure of it.
                self.git.ok(&["reset", "--hard", "--quiet"])?;
                self.git.ok(&["clean", "-fdq"])?;
                let reason = if output.success {
                    "no change".to_string()
                } else {
                    output.text.trim().to_string()
                };
                report
                    .dropped
                    .push(format!("kore {}: {reason}", operation.args.join(" ")));
            }
        }
        journal.operations = kept;
        journal.save()
    }

    /// Commit whatever the last write changed. `false` when it changed nothing.
    fn commit(&self, operation: &Operation) -> Result<bool, CliError> {
        if !self.git.dirty()? {
            return Ok(false);
        }
        self.git.ok(&["add", "--all"])?;
        let message = format!("kore: {} (via MCP)", summary(operation));
        match &operation.agent {
            Some(agent) => {
                let message = format!("{message}\n\n{}", agent.trailer());
                let user = format!("user.name={}", agent.name);
                let email = format!("user.email={}", agent.email);
                self.git.ok(&[
                    "-c",
                    &user,
                    "-c",
                    &email,
                    "commit",
                    "--quiet",
                    "--no-verify",
                    "-m",
                    &message,
                ])?;
            }
            None => {
                self.git
                    .ok(&["commit", "--quiet", "--no-verify", "-m", &message])?;
            }
        }
        Ok(true)
    }

    /// `kore index` over the clone; a failure is logged, never fatal.
    fn reindex(&self) -> bool {
        let output = self.inner.run(&["index".to_string()], None);
        if !output.success && self.log {
            eprintln!("kore sync: index refresh failed: {}", output.text.trim());
        }
        output.success
    }

    fn write(&self, operation: Operation) -> RunOutput {
        let _tree = self.tree.write().unwrap_or_else(|err| err.into_inner());
        let mut journal = self.journal.lock().unwrap_or_else(|err| err.into_inner());
        // Write on the freshest tree, so a later replay is rare.
        let mut before = SyncReport::default();
        if let Err(err) = self.sync_locked(&mut journal, &mut before) {
            if self.log {
                eprintln!("kore sync: {err}");
            }
        }
        // The host signs the commit itself, so its child keeps no journal.
        let output = self.inner.run(&operation.args, operation.stdin.as_deref());
        if !output.success {
            return output;
        }
        let recorded = (|| -> Result<bool, CliError> {
            let changed = self.commit(&operation)?;
            if changed {
                journal.operations.push(operation.clone());
                journal.save()?;
            }
            Ok(changed)
        })();
        match recorded {
            Ok(true) => {
                let mut after = SyncReport::default();
                if let Err(err) = self.sync_locked(&mut journal, &mut after) {
                    if self.log {
                        eprintln!("kore sync: {err}");
                    }
                }
                after.pulled += before.pulled;
                after.reindexed = self.reindex();
                if self.log {
                    log_report(&after);
                }
            }
            Ok(false) => {}
            Err(err) => {
                // The note is written; only its sync bookkeeping failed.
                eprintln!("kore sync: could not record {}: {err}", summary(&operation));
            }
        }
        output
    }
}

impl<R: Runner> Runner for VaultSync<R> {
    fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput {
        self.run_operation(args, stdin, None)
    }

    fn run_as(&self, args: &[String], stdin: Option<&str>, agent: &AgentIdentity) -> RunOutput {
        self.run_operation(args, stdin, Some(agent.clone()))
    }
}

impl<R: Runner> VaultSync<R> {
    fn run_operation(
        &self,
        args: &[String],
        stdin: Option<&str>,
        agent: Option<AgentIdentity>,
    ) -> RunOutput {
        let operation = Operation {
            args: args.to_vec(),
            stdin: stdin.map(str::to_string),
            agent,
        };
        if operation.is_read() {
            let _tree = self.tree.read().unwrap_or_else(|err| err.into_inner());
            return self.inner.run(args, stdin);
        }
        self.write(operation)
    }
}

/// A runner chosen at startup (`kore mcp` with or without `--sync`).
pub type AnyRunner = Box<dyn Runner + Send + Sync>;

impl Runner for AnyRunner {
    fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput {
        self.as_ref().run(args, stdin)
    }

    fn run_as(&self, args: &[String], stdin: Option<&str>, agent: &AgentIdentity) -> RunOutput {
        self.as_ref().run_as(args, stdin, agent)
    }
}

impl<R: Runner> Runner for std::sync::Arc<VaultSync<R>> {
    fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput {
        self.as_ref().run(args, stdin)
    }

    fn run_as(&self, args: &[String], stdin: Option<&str>, agent: &AgentIdentity) -> RunOutput {
        self.as_ref().run_as(args, stdin, agent)
    }
}

/// A push the remote refused because it moved (not a network failure).
fn rejected(push: &GitOutput) -> bool {
    let text = format!("{}\n{}", push.stdout, push.stderr);
    text.contains("[rejected]")
        || text.contains("non-fast-forward")
        || text.contains("fetch first")
        || text.contains("[remote rejected]")
}

/// Keep `.reflect/` out of the vault's history without touching its files.
fn exclude_index(git: &Git, git_dir: &Path) -> Result<(), CliError> {
    let ignored = git.run(&["check-ignore", "-q", ".reflect/index.sqlite"])?;
    if ignored.success {
        return Ok(());
    }
    let exclude = git_dir.join("info").join("exclude");
    fs::create_dir_all(exclude.parent().expect("info dir"))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude)?;
    writeln!(
        file,
        "\n# kore: the search index is rebuilt on each machine\n.reflect/"
    )?;
    Ok(())
}

/// The commit subject for one operation: the subcommand and its first
/// argument, never the stdin body.
fn summary(operation: &Operation) -> String {
    let mut words: Vec<&str> = operation.args.iter().map(String::as_str).collect();
    words.retain(|word| *word != "--");
    let mut text = words.join(" ");
    if text.chars().count() > 72 {
        text = text.chars().take(71).collect::<String>() + "…";
    }
    text.replace('\n', " ")
}

fn log_report(report: &SyncReport) {
    if let Some(offline) = &report.offline {
        eprintln!("kore sync: remote unreachable, writes stay journaled ({offline})");
    }
    if report.pulled + report.pushed + report.replayed > 0 || !report.dropped.is_empty() {
        eprintln!(
            "kore sync: pulled {}, pushed {}, replayed {}{}",
            report.pulled,
            report.pushed,
            report.replayed,
            if report.reindexed {
                ", index refreshed"
            } else {
                ""
            }
        );
    }
    for dropped in &report.dropped {
        eprintln!("kore sync: dropped a write that no longer applies: {dropped}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Plays the CLI: `capture <text> --to <file>` appends a bullet,
    /// `new <file>` claims a file, `index` counts refreshes.
    struct FakeCli {
        root: PathBuf,
        indexed: AtomicUsize,
    }

    impl Runner for FakeCli {
        fn run(&self, args: &[String], _stdin: Option<&str>) -> RunOutput {
            let fail = |text: &str| RunOutput {
                success: false,
                text: text.into(),
            };
            match args[0].as_str() {
                "index" => {
                    self.indexed.fetch_add(1, Ordering::SeqCst);
                }
                "capture" => {
                    let path = self.root.join(&args[3]);
                    let Ok(mut body) = fs::read_to_string(&path) else {
                        return fail("note not found");
                    };
                    body.push_str(&format!("- {}\n", args[1]));
                    fs::write(path, body).unwrap();
                }
                "new" => {
                    let path = self.root.join(&args[1]);
                    if path.exists() {
                        return fail("already exists");
                    }
                    fs::write(path, "# New\n").unwrap();
                }
                "show" => {
                    return RunOutput {
                        success: true,
                        text: fs::read_to_string(self.root.join(&args[1])).unwrap_or_default(),
                    }
                }
                _ => return fail("unknown"),
            }
            RunOutput {
                success: true,
                text: "{}".into(),
            }
        }
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=Mac", "-c", "user.email=mac@example.com"])
            .args([
                "-c",
                "commit.gpgsign=false",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    /// A bare remote, the Mac's clone with one daily note, and the host's clone.
    struct Fixture {
        _dir: tempfile::TempDir,
        remote: PathBuf,
        mac: PathBuf,
        host: PathBuf,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let remote = dir.path().join("remote.git");
        let mac = dir.path().join("mac");
        let host = dir.path().join("host");
        git(dir.path(), &["init", "--quiet", "--bare", "remote.git"]);
        git(
            dir.path(),
            &["clone", "--quiet", remote.to_str().unwrap(), "mac"],
        );
        git(&mac, &["checkout", "--quiet", "-B", "main"]);
        fs::create_dir_all(mac.join("daily")).unwrap();
        fs::write(mac.join("daily/2026-11-04.md"), "# 4 Nov\n- from the mac\n").unwrap();
        git(&mac, &["add", "--all"]);
        git(&mac, &["commit", "--quiet", "-m", "vault sync: start"]);
        git(&mac, &["push", "--quiet", "origin", "main"]);
        git(
            dir.path(),
            &["clone", "--quiet", remote.to_str().unwrap(), "host"],
        );
        Fixture {
            _dir: dir,
            remote,
            mac,
            host,
        }
    }

    fn open(host: &Path) -> VaultSync<FakeCli> {
        let cli = FakeCli {
            root: host.to_path_buf(),
            indexed: AtomicUsize::new(0),
        };
        VaultSync::open(host, cli, SyncOptions::default()).unwrap()
    }

    fn args(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| word.to_string()).collect()
    }

    fn capture(sync: &VaultSync<FakeCli>, text: &str) -> RunOutput {
        sync.run(
            &args(&["capture", text, "--to", "daily/2026-11-04.md"]),
            None,
        )
    }

    fn mac_pull(fixture: &Fixture) -> String {
        git(&fixture.mac, &["pull", "--quiet", "--ff-only"]);
        fs::read_to_string(fixture.mac.join("daily/2026-11-04.md")).unwrap()
    }

    fn mac_capture(fixture: &Fixture, line: &str) {
        let path = fixture.mac.join("daily/2026-11-04.md");
        let body = fs::read_to_string(&path).unwrap() + line + "\n";
        fs::write(path, body).unwrap();
        git(
            &fixture.mac,
            &["commit", "--quiet", "-am", "vault sync: mac"],
        );
        git(&fixture.mac, &["push", "--quiet", "origin", "main"]);
    }

    #[test]
    fn an_agent_write_is_committed_pushed_and_indexed() {
        let fixture = fixture();
        let sync = open(&fixture.host);
        assert!(capture(&sync, "from an agent").success);
        assert_eq!(
            mac_pull(&fixture),
            "# 4 Nov\n- from the mac\n- from an agent\n"
        );
        let subject = git(&fixture.host, &["log", "-1", "--format=%an: %s"]);
        assert_eq!(
            subject,
            "Kore host: kore: capture from an agent --to daily/2026-11-04.md (via MCP)"
        );
        assert_eq!(sync.inner.indexed.load(Ordering::SeqCst), 1);
        assert!(sync.journal.lock().unwrap().operations.is_empty());
    }

    #[test]
    fn a_mac_edit_to_the_same_note_is_replayed_under_not_merged() {
        let fixture = fixture();
        let sync = open(&fixture.host);
        // The host is offline for a moment: its write stays journaled.
        git(&fixture.host, &["remote", "set-url", "origin", "/nowhere"]);
        assert!(capture(&sync, "from an agent").success);
        assert_eq!(sync.journal.lock().unwrap().operations.len(), 1);
        // Meanwhile the Mac appends to the same daily note: a textual conflict.
        mac_capture(&fixture, "- later on the mac");
        git(
            &fixture.host,
            &[
                "remote",
                "set-url",
                "origin",
                fixture.remote.to_str().unwrap(),
            ],
        );

        let report = sync.sync().unwrap();
        assert_eq!(report.pulled, 1);
        assert_eq!(report.replayed, 1);
        assert_eq!(report.pushed, 1);
        assert!(report.reindexed);
        let body = mac_pull(&fixture);
        assert_eq!(
            body,
            "# 4 Nov\n- from the mac\n- later on the mac\n- from an agent\n"
        );
        assert!(!body.contains("<<<<<<<"));
        assert!(sync.journal.lock().unwrap().operations.is_empty());
    }

    #[test]
    fn a_named_agents_write_is_signed_with_its_name_even_after_a_replay() {
        let fixture = fixture();
        let sync = open(&fixture.host);
        git(&fixture.host, &["remote", "set-url", "origin", "/nowhere"]);
        let write = args(&["capture", "from grok", "--to", "daily/2026-11-04.md"]);
        assert!(
            sync.run_as(&write, None, &AgentIdentity::for_caller(Some("Grok <bot>")))
                .success
        );
        mac_capture(&fixture, "- later on the mac");
        git(
            &fixture.host,
            &[
                "remote",
                "set-url",
                "origin",
                fixture.remote.to_str().unwrap(),
            ],
        );

        let report = sync.sync().unwrap();
        assert_eq!(report.replayed, 1);
        mac_pull(&fixture);
        let signed = git(&fixture.mac, &["log", "-1", "--format=%an <%ae>|%B"]);
        assert_eq!(
            signed,
            "Grok bot <grok-bot@agents.kore>|kore: capture from grok --to daily/2026-11-04.md (via MCP)\n\nKore-Agent: Grok bot"
        );
    }

    #[test]
    fn an_unrelated_mac_change_rebases_without_replay() {
        let fixture = fixture();
        let sync = open(&fixture.host);
        git(&fixture.host, &["remote", "set-url", "origin", "/nowhere"]);
        assert!(sync.run(&args(&["new", "idea.md"]), None).success);
        fs::write(fixture.mac.join("other.md"), "# Other\n").unwrap();
        git(&fixture.mac, &["add", "--all"]);
        git(
            &fixture.mac,
            &["commit", "--quiet", "-m", "vault sync: other"],
        );
        git(&fixture.mac, &["push", "--quiet", "origin", "main"]);
        git(
            &fixture.host,
            &[
                "remote",
                "set-url",
                "origin",
                fixture.remote.to_str().unwrap(),
            ],
        );

        let report = sync.sync().unwrap();
        assert_eq!((report.pulled, report.replayed, report.pushed), (1, 0, 1));
        mac_pull(&fixture);
        assert!(fixture.mac.join("idea.md").exists());
        assert!(fixture.host.join("other.md").exists());
    }

    #[test]
    fn a_write_that_no_longer_applies_is_dropped_not_forced() {
        let fixture = fixture();
        let sync = open(&fixture.host);
        git(&fixture.host, &["remote", "set-url", "origin", "/nowhere"]);
        assert!(capture(&sync, "from an agent").success);
        // The Mac deletes the note the agent wrote to.
        git(&fixture.mac, &["rm", "--quiet", "daily/2026-11-04.md"]);
        git(
            &fixture.mac,
            &["commit", "--quiet", "-m", "vault sync: delete"],
        );
        git(&fixture.mac, &["push", "--quiet", "origin", "main"]);
        git(
            &fixture.host,
            &[
                "remote",
                "set-url",
                "origin",
                fixture.remote.to_str().unwrap(),
            ],
        );

        let report = sync.sync().unwrap();
        assert_eq!(report.replayed, 0);
        assert_eq!(report.dropped.len(), 1, "{report:?}");
        assert!(report.dropped[0].contains("note not found"));
        assert!(!fixture.host.join("daily/2026-11-04.md").exists());
        assert!(!git(&fixture.host, &["status", "--porcelain"]).contains("2026"));
    }

    #[test]
    fn the_journal_survives_a_restart_while_offline() {
        let fixture = fixture();
        {
            let sync = open(&fixture.host);
            git(&fixture.host, &["remote", "set-url", "origin", "/nowhere"]);
            assert!(capture(&sync, "before the restart").success);
        }
        git(
            &fixture.host,
            &[
                "remote",
                "set-url",
                "origin",
                fixture.remote.to_str().unwrap(),
            ],
        );
        mac_capture(&fixture, "- mac meanwhile");
        let sync = open(&fixture.host);
        assert_eq!(sync.journal.lock().unwrap().operations.len(), 1);
        let report = sync.sync().unwrap();
        assert_eq!(report.replayed, 1);
        assert!(mac_pull(&fixture).ends_with("- mac meanwhile\n- before the restart\n"));
    }

    #[test]
    fn reads_do_not_commit_and_the_index_stays_out_of_history() {
        let fixture = fixture();
        let sync = open(&fixture.host);
        fs::create_dir_all(fixture.host.join(".reflect")).unwrap();
        fs::write(fixture.host.join(".reflect/index.sqlite"), "db").unwrap();
        let shown = sync.run(&args(&["show", "daily/2026-11-04.md"]), None);
        assert!(shown.text.contains("from the mac"));
        assert!(capture(&sync, "x").success);
        let files = git(&fixture.host, &["ls-files"]);
        assert!(!files.contains(".reflect"), "{files}");
        assert_eq!(git(&fixture.host, &["rev-list", "--count", "HEAD"]), "2");
    }

    #[test]
    fn a_dirty_clone_or_a_folder_without_git_is_refused() {
        let fixture = fixture();
        fs::write(fixture.host.join("stray.md"), "edited by hand").unwrap();
        let cli = || FakeCli {
            root: fixture.host.clone(),
            indexed: AtomicUsize::new(0),
        };
        let dirty = VaultSync::open(&fixture.host, cli(), SyncOptions::default());
        assert!(matches!(dirty, Err(CliError::Usage(message)) if message.contains("uncommitted")));
        let plain = tempfile::tempdir().unwrap();
        let none = VaultSync::open(plain.path(), cli(), SyncOptions::default());
        assert!(matches!(none, Err(CliError::Usage(message)) if message.contains("git clone")));
    }

    #[test]
    fn subcommands_are_reads_only_when_listed() {
        assert!(is_read(&args(&["search", "x"])));
        assert!(is_read(&args(&["grep", "x"])));
        assert!(is_read(&args(&["explain", "x"])));
        assert!(!is_read(&args(&["guide", "--init"])));
        assert!(!is_read(&args(&["capture", "x"])));
        assert!(!is_read(&args(&["edit", "x"])));
    }
}
