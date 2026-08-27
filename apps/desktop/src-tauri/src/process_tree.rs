//! Terminating a spawned process *tree*, not just the process we spawned.
//!
//! Kore starts long-lived helpers that immediately start helpers of their
//! own: an agent CLI (`claude`, `codex`, `cursor-agent`) spawns MCP servers
//! and Node workers, and the in-app terminal's login shell runs whatever the
//! user types into it. Signalling only the root leaves that whole subtree
//! alive — reparented to `launchd`, invisible from the app, and holding its
//! memory for the rest of the session. A handful of abandoned agent runs is
//! enough to account for gigabytes of resident memory the user reads as
//! "Kore is using 10GB".
//!
//! So every stop path goes through [`terminate_tree`]:
//!
//! 1. snapshot the tree **before** signalling — once the root dies the
//!    kernel rewrites its children's `ppid` to `launchd` and the rest of the
//!    tree becomes unfindable;
//! 2. `SIGTERM` the whole set (plus the root's process group, which catches
//!    anything forked between the snapshot and the signal);
//! 3. give it a short grace period so children can flush and exit cleanly;
//! 4. `SIGKILL` whatever is still alive;
//! 5. reap the root, so it does not linger as a zombie.
//!
//! A descendant that deliberately detaches itself (double-fork plus
//! `setsid`, the classic daemon recipe) leaves the tree the moment it does
//! so and is out of reach here by construction; nothing the agent CLIs run
//! does that today.

use std::process::Command;
use std::time::{Duration, Instant};

/// How long the tree gets between `SIGTERM` and `SIGKILL`. Long enough for a
/// Node process to run its exit handlers, short enough that the UI's stop
/// button still feels instant.
pub const TERMINATE_GRACE: Duration = Duration::from_millis(750);

/// How often the grace period re-checks for survivors.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// One row of the process table. `command` is the executable, which is the
/// only field diagnostics needs beyond the tree links and the footprint.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessRow {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    /// Resident set size in kilobytes, as the OS reports it.
    pub rss_kb: u64,
    pub command: String,
}

/// A spawned child this process is responsible for reaping.
///
/// Implemented for [`std::process::Child`] here and for the in-app
/// terminal's `portable_pty` child in `pty.rs`, so both kill paths share one
/// termination sequence.
pub trait ReapableChild {
    /// The child's pid, or `None` once it has been reaped.
    fn pid(&self) -> Option<u32>;
    /// Reap without blocking; `true` once the child has exited.
    fn try_reap(&mut self) -> bool;
    /// Block until the child has exited and been reaped.
    fn reap(&mut self);
}

impl ReapableChild for std::process::Child {
    fn pid(&self) -> Option<u32> {
        Some(self.id())
    }

    fn try_reap(&mut self) -> bool {
        matches!(self.try_wait(), Ok(Some(_)) | Err(_))
    }

    fn reap(&mut self) {
        let _ = self.wait();
    }
}

/// Put `command`'s child in its own process group, so a later signal can
/// address the group and reach the children it forks. Without it a spawned
/// CLI shares Kore's group, and signalling that group would take the app
/// down with it.
pub fn own_process_group(command: &mut Command) -> &mut Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Terminate `child` and everything it started. Idempotent: a child that has
/// already exited is only reaped.
pub fn terminate_tree(child: &mut impl ReapableChild) {
    let Some(root) = child.pid() else {
        return;
    };
    // The root is polled through `try_reap`, not through the process table:
    // an exited-but-unreaped child is still a live pid to `kill(pid, 0)`.
    let descendants: Vec<u32> = tree_pids(&process_table(), root)
        .into_iter()
        .filter(|pid| *pid != root)
        .collect();

    signal_group(root, TERM_SIGNAL);
    signal_each(&descendants, TERM_SIGNAL);
    signal_pid(root, TERM_SIGNAL);

    let deadline = Instant::now() + TERMINATE_GRACE;
    loop {
        let root_done = child.try_reap();
        let survivors: Vec<u32> = descendants
            .iter()
            .copied()
            .filter(|pid| is_alive(*pid))
            .collect();
        if root_done && survivors.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            signal_group(root, KILL_SIGNAL);
            signal_each(&survivors, KILL_SIGNAL);
            if !root_done {
                signal_pid(root, KILL_SIGNAL);
            }
            break;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    child.reap();
}

/// Snapshot `root`'s tree so it can be swept after `root` exits on its own.
///
/// The normal end of an agent run is the CLI exiting by itself, and a CLI
/// that crashed (or simply forgot) leaves its MCP servers behind. Taking the
/// snapshot while the root is still alive is what makes those findable
/// afterwards — see [`terminate_leftovers`].
pub fn tree_snapshot(root: u32) -> Vec<u32> {
    tree_pids(&process_table(), root)
}

/// Terminate whatever is still alive from a [`tree_snapshot`] taken before
/// `root` exited and was reaped.
///
/// Every candidate is re-checked against the live process table and must
/// still carry `root`'s process group, so a recycled pid can never be
/// mistaken for a leftover.
pub fn terminate_leftovers(root: u32, snapshot: &[u32]) {
    let table = process_table();
    let leftovers: Vec<u32> = snapshot
        .iter()
        .copied()
        .filter(|pid| *pid != root && table.iter().any(|row| row.pid == *pid && row.pgid == root))
        .collect();
    if leftovers.is_empty() {
        return;
    }
    tracing::info!(
        root,
        count = leftovers.len(),
        "sweeping leftover child processes"
    );
    signal_each(&leftovers, TERM_SIGNAL);
    let deadline = Instant::now() + TERMINATE_GRACE;
    loop {
        let survivors: Vec<u32> = leftovers
            .iter()
            .copied()
            .filter(|pid| is_alive(*pid))
            .collect();
        if survivors.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            signal_each(&survivors, KILL_SIGNAL);
            return;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Every pid belonging to `root`'s tree, `root` included: its process group,
/// its descendants, and their descendants. Pure, so the walk is testable
/// against a synthetic table.
pub fn tree_pids(table: &[ProcessRow], root: u32) -> Vec<u32> {
    let mut collected = vec![root];
    for row in table {
        // Group members that are not descendants — an agent CLI's child that
        // re-parented itself before the snapshot, say — still belong to the
        // run and must die with it.
        if row.pgid == root && row.pid != root {
            collected.push(row.pid);
        }
    }
    let mut cursor = 0;
    while cursor < collected.len() {
        let parent = collected[cursor];
        cursor += 1;
        for row in table {
            if row.ppid == parent && !collected.contains(&row.pid) {
                collected.push(row.pid);
            }
        }
    }
    collected
}

/// The live process table. An empty result (an OS without `ps`, or a
/// sandbox that refuses it) degrades to signalling the root and its process
/// group only — the pre-existing behavior, never worse.
pub fn process_table() -> Vec<ProcessRow> {
    #[cfg(unix)]
    {
        let Ok(output) = Command::new("/bin/ps")
            .args(["-A", "-o", "pid=,ppid=,pgid=,rss=,comm="])
            .output()
        else {
            return Vec::new();
        };
        parse_process_table(&String::from_utf8_lossy(&output.stdout))
    }
    #[cfg(not(unix))]
    {
        Vec::new()
    }
}

/// Parse `ps -o pid=,ppid=,pgid=,rss=,comm=` output. `comm` is last because
/// an executable path may contain spaces; everything after the fourth column
/// is the command.
fn parse_process_table(output: &str) -> Vec<ProcessRow> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let ppid = fields.next()?.parse().ok()?;
            let pgid = fields.next()?.parse().ok()?;
            let rss_kb = fields.next()?.parse().unwrap_or(0);
            let command = fields.collect::<Vec<_>>().join(" ");
            Some(ProcessRow {
                pid,
                ppid,
                pgid,
                rss_kb,
                command,
            })
        })
        .collect()
}

#[cfg(unix)]
const TERM_SIGNAL: i32 = libc::SIGTERM;
#[cfg(unix)]
const KILL_SIGNAL: i32 = libc::SIGKILL;
#[cfg(not(unix))]
const TERM_SIGNAL: i32 = 15;
#[cfg(not(unix))]
const KILL_SIGNAL: i32 = 9;

/// Signal one pid. A stale pid is at worst a no-op error return.
fn signal_pid(pid: u32, signal: i32) {
    #[cfg(unix)]
    {
        // SAFETY: a plain syscall on a pid this process spawned or read from
        // the process table; failure is reported, never undefined.
        unsafe {
            libc::kill(pid as i32, signal);
        }
    }
    #[cfg(not(unix))]
    {
        // Windows has no signals: `taskkill /T` walks the tree itself, and
        // `/F` is the escalation the grace period would otherwise make.
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T"]);
        if signal == KILL_SIGNAL {
            command.arg("/F");
        }
        let _ = command.output();
    }
}

fn signal_each(pids: &[u32], signal: i32) {
    for pid in pids {
        signal_pid(*pid, signal);
    }
}

/// Signal the process group `root` leads. Kore spawns every helper into its
/// own group, so this reaches children forked after the snapshot. A root
/// that never became a group leader has no group of that id — the call then
/// fails harmlessly, because a live pid can never be another group's id.
fn signal_group(root: u32, signal: i32) {
    #[cfg(unix)]
    {
        // SAFETY: as `signal_pid`; a negative pid addresses the group.
        unsafe {
            libc::kill(-(root as i32), signal);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (root, signal);
    }
}

/// Whether `pid` still exists. A zombie counts as alive, which is why the
/// root is polled through [`ReapableChild::try_reap`] instead.
fn is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: signal 0 performs the permission and existence checks
        // without delivering anything.
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        process_table().iter().any(|row| row.pid == pid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pid: u32, ppid: u32, pgid: u32) -> ProcessRow {
        ProcessRow {
            pid,
            ppid,
            pgid,
            rss_kb: 0,
            command: String::new(),
        }
    }

    #[test]
    fn parses_a_process_table_with_spaces_in_the_command() {
        let rows = parse_process_table(
            "  501     1   501  12480 /Applications/My App.app/Contents/MacOS/My App\n\
             \x20 502   501   501   2048 node\n\
             garbage\n",
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].pid, 501);
        assert_eq!(rows[0].rss_kb, 12480);
        assert_eq!(
            rows[0].command,
            "/Applications/My App.app/Contents/MacOS/My App"
        );
        assert_eq!(rows[1].ppid, 501);
    }

    #[test]
    fn collects_grandchildren() {
        let table = [
            row(10, 1, 10),
            row(11, 10, 10),
            row(12, 11, 12),
            row(99, 1, 99),
        ];
        let mut pids = tree_pids(&table, 10);
        pids.sort_unstable();
        assert_eq!(pids, vec![10, 11, 12]);
    }

    #[test]
    fn collects_group_members_that_are_not_descendants() {
        // A grandchild whose parent already exited: `launchd` owns it now,
        // but it still carries the run's process group.
        let table = [row(10, 1, 10), row(42, 1, 10)];
        let mut pids = tree_pids(&table, 10);
        pids.sort_unstable();
        assert_eq!(pids, vec![10, 42]);
    }

    #[test]
    fn ignores_unrelated_processes() {
        let table = [row(10, 1, 10), row(20, 1, 20), row(21, 20, 20)];
        assert_eq!(tree_pids(&table, 10), vec![10]);
    }

    #[test]
    fn a_parent_cycle_cannot_loop_forever() {
        let table = [row(10, 11, 10), row(11, 10, 10)];
        let mut pids = tree_pids(&table, 10);
        pids.sort_unstable();
        assert_eq!(pids, vec![10, 11]);
    }

    /// Wait for `pid` to disappear. An orphaned descendant is reaped by
    /// `launchd`/`init`, not by this process, so the death is observable a
    /// beat after the signal.
    #[cfg(unix)]
    fn wait_until_gone(pid: u32) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if !is_alive(pid) {
                return true;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
        false
    }

    #[cfg(unix)]
    fn spawn_sleeper(script: &str) -> (std::process::Child, u32) {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;

        let mut child = own_process_group(&mut Command::new("/bin/sh"))
            .arg("-c")
            .arg(script)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        let stdout = child.stdout.take().unwrap();
        BufReader::new(stdout).read_line(&mut line).unwrap();
        let sleeper = line.trim().parse().unwrap();
        assert!(is_alive(sleeper));
        (child, sleeper)
    }

    #[cfg(unix)]
    #[test]
    fn kills_a_descendant_the_root_is_still_waiting_on() {
        let (mut child, sleeper) = spawn_sleeper("sleep 30 & echo $!; wait");
        terminate_tree(&mut child);
        assert!(wait_until_gone(sleeper), "the descendant outlived its tree");
    }

    #[cfg(unix)]
    #[test]
    fn kills_a_sleeper_the_root_already_orphaned() {
        // `sh` backgrounds the sleeper and exits: the sleeper re-parents to
        // pid 1 before the kill and is unreachable through `ppid` links —
        // exactly the shape a plain `child.kill()` leaves running. It still
        // carries the run's process group, which is how the tree finds it.
        let (mut child, sleeper) = spawn_sleeper("sleep 30 & echo $!");
        std::thread::sleep(Duration::from_millis(100));
        terminate_tree(&mut child);
        assert!(
            wait_until_gone(sleeper),
            "the orphaned sleeper outlived its tree"
        );
    }

    #[cfg(unix)]
    #[test]
    fn sweeps_leftovers_after_the_root_exits_on_its_own() {
        let (mut child, sleeper) = spawn_sleeper("sleep 30 & echo $!");
        let snapshot = tree_snapshot(child.id());
        assert!(snapshot.contains(&sleeper));
        let root = child.id();
        child.wait().unwrap();
        terminate_leftovers(root, &snapshot);
        assert!(wait_until_gone(sleeper), "the leftover outlived the run");
    }

    #[cfg(unix)]
    #[test]
    fn an_already_dead_child_is_only_reaped() {
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg("exit 0")
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        terminate_tree(&mut child);
        assert!(started.elapsed() < TERMINATE_GRACE);
    }
}
