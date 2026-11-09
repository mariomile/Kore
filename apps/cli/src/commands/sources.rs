//! `kore sources` — pull Readwise highlights and Granola meetings into the
//! graph with no app running, through the same connector engine the app
//! uses (`packages/core/src/connectors`), hosted under Node like `kore index`.
//!
//! The core owns the policy (`packages/core/src/headless/sync-sources.ts`):
//! which sources exist, the `KORE_<SOURCE>_TOKEN` / `_FOLDER` / `_PATTERN` /
//! `_TAGS` variables it reads from the environment this process passes on,
//! and the defaults. This side owns what only it can: the flags, and each
//! source's window in `.kore/sources.json` (per machine, never
//! committed), which it serves to the core and saves from its reports.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::commands::index::run_script;
use crate::commands::output::print_json;
use crate::commands::warn;
use crate::error::CliError;
use crate::indexer::Host;

/// One source's window, as `.kore/sources.json` keeps it.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceState {
    /// Never import items older than this (the first run's start).
    floor: Option<String>,
    /// The last successful run: the next run's window start.
    last_synced_at: Option<String>,
}

type State = BTreeMap<String, SourceState>;

fn state_path(root: &Path) -> PathBuf {
    root.join(".kore").join("sources.json")
}

fn load_state(root: &Path) -> Result<State, CliError> {
    match fs::read_to_string(state_path(root)) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|err| CliError::runtime(format!("unreadable .kore/sources.json: {err}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(State::new()),
        Err(err) => Err(err.into()),
    }
}

fn save_state(root: &Path, state: &State) -> Result<(), CliError> {
    let text =
        serde_json::to_string_pretty(state).map_err(|err| CliError::runtime(err.to_string()))?;
    crate::write::atomic_write(&state_path(root), &format!("{text}\n"))
}

/// `YYYY-MM-DD` (local midnight) or an RFC 3339 instant, as RFC 3339 UTC.
fn parse_since(value: &str) -> Result<String, CliError> {
    let bad = || {
        CliError::Usage(format!(
            "--since takes YYYY-MM-DD or an RFC 3339 time, not {value:?}"
        ))
    };
    if let Ok(timestamp) = value.parse::<jiff::Timestamp>() {
        return Ok(timestamp.to_string());
    }
    let date: jiff::civil::Date = value.parse().map_err(|_| bad())?;
    let zoned = date
        .to_zoned(jiff::tz::TimeZone::system())
        .map_err(|_| bad())?;
    Ok(zoned.timestamp().to_string())
}

/// The window `kore sync --sources` replays with: the earliest saved run, so
/// a run re-applied after a reset fetches the same items again.
pub fn replay_args(root: &Path) -> Vec<String> {
    let earliest = load_state(root).ok().and_then(|state| {
        state
            .values()
            .filter_map(|source| source.last_synced_at.clone().or(source.floor.clone()))
            .min()
    });
    let mut args = vec!["sources".to_string()];
    if let Some(since) = earliest {
        args.extend(["--since".to_string(), since]);
    }
    args
}

/// Pull every source that has a token (or just `only`) and print what landed.
pub fn run(
    root: &Path,
    json: bool,
    only: Option<&str>,
    since: Option<&str>,
) -> Result<(), CliError> {
    let since = since.map(parse_since).transpose()?;
    let mut state = load_state(root)?;
    let request = json!({ "only": only, "since": since, "state": state });
    let mut host = Host::open(root)?.with_sources(request);
    let code = run_script(&mut host, &["--sources"])?;
    let outcome: Outcome = host
        .take_report()
        .and_then(|report| serde_json::from_value(report).ok())
        .unwrap_or_default();
    if let Some(usage) = outcome.usage {
        return Err(CliError::Usage(usage));
    }
    let reports = outcome.reports;
    for report in &reports {
        let saved = state.entry(report.id.clone()).or_default();
        saved.floor = report.floor.clone().or(saved.floor.take());
        if let Some(synced) = &report.synced_at {
            saved.last_synced_at = Some(synced.clone());
        }
    }
    save_state(root, &state)?;
    if reports.is_empty() || !matches!(code, Some(0) | Some(2)) {
        return Err(CliError::runtime("the source sync failed before reporting"));
    }

    if json {
        print_json(&json!({ "sources": reports }))?;
    } else {
        for report in &reports {
            match &report.error {
                Some(error) => eprintln!("kore: {}: {error}", report.id),
                None => println!(
                    "{}: {} new, {} updated.",
                    report.id, report.created, report.updated
                ),
            }
        }
    }
    if code == Some(2) {
        warn("some notes could not be indexed (named above)");
    }
    let failed: Vec<&str> = reports
        .iter()
        .filter(|report| report.error.is_some())
        .map(|report| report.id.as_str())
        .collect();
    if !failed.is_empty() {
        return Err(CliError::runtime(format!(
            "could not pull {}",
            failed.join(", ")
        )));
    }
    Ok(())
}

/// What the core sent back: one report per source that ran, or the usage
/// problem that stopped any from running.
#[derive(Debug, Default, Deserialize)]
struct Outcome {
    #[serde(default)]
    reports: Vec<Report>,
    usage: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    id: String,
    created: u64,
    updated: u64,
    synced_at: Option<String>,
    /// The window floor to keep; never printed.
    #[serde(default, skip_serializing)]
    floor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replays_from_the_earliest_saved_window() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(replay_args(dir.path()), vec!["sources"]);
        let mut state = State::new();
        state.insert(
            "readwise".into(),
            SourceState {
                floor: Some("2026-11-01T00:00:00Z".into()),
                last_synced_at: Some("2026-11-07T10:00:00Z".into()),
            },
        );
        state.insert(
            "granola".into(),
            SourceState {
                floor: Some("2026-11-07T09:00:00Z".into()),
                last_synced_at: None,
            },
        );
        save_state(dir.path(), &state).unwrap();
        assert_eq!(
            replay_args(dir.path()),
            vec!["sources", "--since", "2026-11-07T09:00:00Z"]
        );
    }

    #[test]
    fn reads_a_date_or_an_instant() {
        assert_eq!(
            parse_since("2026-11-07T10:00:00Z").unwrap(),
            "2026-11-07T10:00:00Z"
        );
        assert!(parse_since("2026-11-07").unwrap().starts_with("2026-11-0"));
        assert!(parse_since("yesterday").is_err());
    }
}
