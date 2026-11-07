//! `kore index` — build or refresh the search index without the app: spawn
//! the bundled core indexer under Node and serve its native commands with
//! [`crate::indexer::Host`].

use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use serde_json::json;

use crate::commands::output::print_json;
use crate::commands::warn;
use crate::error::CliError;
use crate::indexer::{serve, Host, INDEXER_SCRIPT};

fn indexer_script() -> Result<PathBuf, CliError> {
    if let Some(path) = std::env::var_os("KORE_INDEXER").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe()?;
    let beside = exe.with_file_name(INDEXER_SCRIPT);
    if beside.is_file() {
        return Ok(beside);
    }
    Err(CliError::runtime(format!(
        "{INDEXER_SCRIPT} not found next to {}; set KORE_INDEXER to its path \
         (build it with `pnpm --filter @reflect/core build:indexer`)",
        exe.display()
    )))
}

/// Spawn the bundled core under Node with `args` and serve it with `host`
/// until it exits; returns the script's exit code.
pub(crate) fn run_script(host: &mut Host, args: &[&str]) -> Result<Option<i32>, CliError> {
    let script = indexer_script()?;
    let node = std::env::var_os("KORE_NODE")
        .filter(|node| !node.is_empty())
        .unwrap_or_else(|| "node".into());
    let mut command = Command::new(&node);
    command
        .arg(&script)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = command.spawn().map_err(|err| {
        CliError::runtime(format!(
            "could not start Node ({}): {err}; install Node 22 or set KORE_NODE",
            Path::new(&node).display()
        ))
    })?;
    let requests = BufReader::new(child.stdout.take().expect("piped stdout"));
    let replies = child.stdin.take().expect("piped stdin");
    let served = serve(host, requests, replies);
    let status = child.wait()?;
    served?;
    Ok(status.code())
}

/// Run one headless index pass over `root` and print what it wrote.
pub fn run(root: &Path, json: bool, rebuild: bool) -> Result<(), CliError> {
    let mut host = Host::open(root)?;
    let started = Instant::now();
    let args: &[&str] = if rebuild { &["--rebuild"] } else { &[] };
    let code = run_script(&mut host, args)?;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let stats = host.stats();
    match code {
        Some(0) => {}
        Some(2) => {
            warn("some notes could not be indexed (named above); the rest of the index is current")
        }
        _ => {
            return Err(CliError::runtime(
                "the indexer failed; the index keeps what it had written",
            ))
        }
    }
    if json {
        return print_json(&json!({
            "notes": stats.notes,
            "written": stats.written,
            "removed": stats.removed,
            "moved": stats.moved,
            "elapsedMs": elapsed_ms,
        }));
    }
    println!(
        "Indexed {} notes in {:.1}s: {} written, {} removed, {} moved.",
        stats.notes,
        elapsed_ms as f64 / 1000.0,
        stats.written,
        stats.removed,
        stats.moved
    );
    Ok(())
}
