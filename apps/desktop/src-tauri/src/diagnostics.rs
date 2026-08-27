//! Memory diagnostics: what Kore itself is holding, and what the processes
//! it started are holding on its behalf.
//!
//! The app's own resident set is only part of the footprint a user reads in
//! Activity Monitor. An agent CLI run brings a Node process and one MCP
//! server per configured server; the in-app terminal brings a shell and
//! whatever runs inside it. Those are separate processes with separate
//! resident sets, and until they are listed there is no way to tell an app
//! that leaks from an app that is merely hosting several hungry helpers —
//! which is the first question to answer before optimizing anything.
//!
//! One caveat this report cannot fix: on macOS the WebKit content and GPU
//! processes backing the webview are XPC services launched by `launchd`, not
//! children of the app, so they are outside the tree reported here. What the
//! *webview* holds is measured from the frontend (`performance.memory` and
//! the like), not from this side.

use serde::Serialize;

use crate::error::AppResult;
use crate::process_tree;

/// One process Kore started, directly or indirectly.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperProcess {
    pub pid: u32,
    pub parent_pid: u32,
    /// Resident set size in kilobytes, as the OS reports it.
    pub rss_kb: u64,
    /// The executable, e.g. `node` or `/bin/zsh`.
    pub command: String,
}

/// Kore's footprint and that of every helper it owns.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReport {
    pub pid: u32,
    /// The app process's own resident set, in kilobytes.
    pub rss_kb: u64,
    /// Helpers, heaviest first.
    pub helpers: Vec<HelperProcess>,
    /// The helpers' resident sets summed, in kilobytes.
    pub helpers_rss_kb: u64,
}

/// Report the app's memory footprint and its helper processes.
///
/// An empty `helpers` list is the healthy steady state: no agent run, no open
/// terminal. Helpers that outlive the work that started them are the leak
/// `process_tree` exists to prevent, and this command is how that is checked.
#[tauri::command]
pub async fn memory_report() -> AppResult<MemoryReport> {
    crate::blocking::run_blocking(|| Ok(collect_memory_report(std::process::id()))).await
}

fn collect_memory_report(pid: u32) -> MemoryReport {
    let table = process_tree::process_table();
    let rss_kb = table
        .iter()
        .find(|row| row.pid == pid)
        .map_or(0, |row| row.rss_kb);
    let mut helpers: Vec<HelperProcess> = process_tree::tree_pids(&table, pid)
        .into_iter()
        .filter(|helper| *helper != pid)
        .filter_map(|helper| table.iter().find(|row| row.pid == helper))
        .map(|row| HelperProcess {
            pid: row.pid,
            parent_pid: row.ppid,
            rss_kb: row.rss_kb,
            command: row.command.clone(),
        })
        .collect();
    helpers.sort_by(|left, right| {
        right
            .rss_kb
            .cmp(&left.rss_kb)
            .then_with(|| left.pid.cmp(&right.pid))
    });
    let helpers_rss_kb = helpers.iter().map(|helper| helper.rss_kb).sum();
    MemoryReport {
        pid,
        rss_kb,
        helpers,
        helpers_rss_kb,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn reports_this_process_and_the_children_it_started() {
        let mut child = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .unwrap();
        let report = collect_memory_report(std::process::id());
        assert_eq!(report.pid, std::process::id());
        assert!(report.rss_kb > 0, "the test process has a resident set");
        assert!(
            report.helpers.iter().any(|helper| helper.pid == child.id()),
            "the spawned child is missing from {:?}",
            report.helpers
        );
        assert_eq!(
            report.helpers_rss_kb,
            report
                .helpers
                .iter()
                .map(|helper| helper.rss_kb)
                .sum::<u64>()
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn heaviest_helpers_come_first() {
        let report = collect_memory_report(std::process::id());
        let sorted = report
            .helpers
            .windows(2)
            .all(|pair| pair[0].rss_kb >= pair[1].rss_kb);
        assert!(sorted, "helpers are not ordered by footprint");
    }
}
