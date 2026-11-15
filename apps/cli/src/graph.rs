//! Graph resolution: `--graph` flag → `KORE_GRAPH` env → git-style walk-up
//! from the current directory to the nearest ancestor containing `.kore/`
//! (or the pre-rename `.reflect/`, which is moved to `.kore/` on resolve).
//! Deliberately no desktop recents-config fallback (Plan 14) — the CLI must be
//! deterministic for scripts and agents. The one exception is `kore mcp`
//! ([`resolve_for_mcp`]): an MCP client's config is pasted once and outlives
//! any one folder, so a server started without a path serves the vault the
//! app opened last, and moving or renaming the vault does not break it.

use std::path::{Path, PathBuf};

use kore_index_schema::KORE_DIR;

use crate::error::CliError;

/// The resolved graph; `root` is canonicalized and absolute.
#[derive(Debug)]
pub struct Graph {
    pub root: PathBuf,
}

const NO_GRAPH_HELP: &str = "no graph found — run inside a graph (a directory containing .kore/), \
     pass --graph <path>, or set KORE_GRAPH";

fn is_graph(path: &Path) -> bool {
    kore_index_schema::has_runtime_dir(path)
}

fn canonical_graph(path: &Path) -> Result<Graph, CliError> {
    let root = path
        .canonicalize()
        .map_err(|err| CliError::Runtime(format!("cannot resolve {}: {err}", path.display())))?;
    kore_index_schema::migrate_legacy_dir(&root).map_err(|err| {
        CliError::Runtime(format!(
            "cannot move {}/.reflect to {KORE_DIR}: {err}",
            root.display()
        ))
    })?;
    crate::paths::configure_for_graph(&root);
    Ok(Graph { root })
}

/// The graph named explicitly, by flag then env var, with the name of its
/// source for error messages.
fn explicit_source(flag: Option<&Path>) -> Option<(PathBuf, &'static str)> {
    flag.map(|path| (path.to_path_buf(), "--graph"))
        .or_else(|| {
            std::env::var_os("KORE_GRAPH")
                .filter(|env| !env.is_empty())
                .map(|env| (PathBuf::from(env), "KORE_GRAPH"))
        })
}

fn require_dir(path: &Path, source: &str) -> Result<(), CliError> {
    if path.is_dir() {
        return Ok(());
    }
    Err(CliError::Runtime(format!(
        "{source}: no such directory: {}",
        path.display()
    )))
}

/// Validate an explicitly-named graph (flag or env var); a non-graph path is
/// an error with the hint, never a silent fall-through.
fn explicit_graph(path: &Path, source: &str) -> Result<Graph, CliError> {
    require_dir(path, source)?;
    if !is_graph(path) {
        return Err(CliError::Runtime(format!(
            "{source}: not a Kore graph (no {KORE_DIR}/ directory): {}",
            path.display()
        )));
    }
    canonical_graph(path)
}

/// Resolve the graph for `kore index`, which may be the first thing to run
/// on a folder: an explicit `--graph` or `$KORE_GRAPH` directory is adopted
/// even without `.kore/` (indexing creates it). The current-directory
/// fallback still requires `.kore/`, so a stray run never indexes `$HOME`.
pub fn resolve_for_index(flag: Option<&Path>) -> Result<Graph, CliError> {
    let Some((path, source)) = explicit_source(flag) else {
        return resolve(None).map_err(|_| {
            CliError::runtime(
                "no graph found — pass --graph <path> to index a folder for the first time",
            )
        });
    };
    require_dir(&path, source)?;
    canonical_graph(&path)
}

/// The nearest ancestor of `start` (itself included) that is a graph.
fn walk_up(start: &Path) -> Option<&Path> {
    start.ancestors().find(|dir| is_graph(dir))
}

/// Resolve the active graph. First hit wins: flag, env, then the walk-up.
pub fn resolve(flag: Option<&Path>) -> Result<Graph, CliError> {
    if let Some((path, source)) = explicit_source(flag) {
        return explicit_graph(&path, source);
    }
    let cwd = std::env::current_dir()?;
    match walk_up(&cwd) {
        Some(root) => canonical_graph(root),
        None => Err(CliError::runtime(NO_GRAPH_HELP)),
    }
}

/// Resolve the graph `kore mcp` serves: flag, env and the walk-up as
/// [`resolve`], then the vault the Kore app opened last. A pasted config
/// without `--graph` therefore follows the vault when it moves: the app
/// records the new location the first time it opens it there.
pub fn resolve_for_mcp(flag: Option<&Path>) -> Result<Graph, CliError> {
    if let Some((path, source)) = explicit_source(flag) {
        return explicit_graph(&path, source);
    }
    let cwd = std::env::current_dir()?;
    if let Some(root) = walk_up(&cwd) {
        return canonical_graph(root);
    }
    let last = recents_file().and_then(|file| last_opened_in(&file));
    match last {
        Some(root) if is_graph(&root) => canonical_graph(&root),
        // Never fall back to an older entry: that would hand the agent a
        // different vault without a word. Reopening the vault in Kore
        // records where it is now.
        Some(root) => Err(CliError::Runtime(format!(
            "the vault Kore opened last is no longer at {} — open it in Kore once \
             from its new place, or pass --graph <path>",
            root.display()
        ))),
        None => Err(CliError::runtime(
            "no vault found — open a vault in the Kore app, or pass --graph <path>",
        )),
    }
}

/// The app's recent-vaults list: `recent-graphs.json` in `<config dir>/kore`,
/// the same OS config directory the app resolves (`dirs::config_dir`).
fn recents_file() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    let base = if cfg!(target_os = "macos") {
        PathBuf::from(var("HOME")?).join("Library/Application Support")
    } else if cfg!(windows) {
        PathBuf::from(var("APPDATA")?)
    } else {
        var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| var("HOME").map(|home| PathBuf::from(home).join(".config")))?
    };
    Some(base.join("kore").join("recent-graphs.json"))
}

/// The root of the newest entry of a recents list (stored newest first). A
/// missing, unreadable or empty list is no answer, never an error: the
/// caller reports that no vault was found.
fn last_opened_in(file: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(file).ok()?;
    let entries: Vec<serde_json::Value> = serde_json::from_str(&raw).ok()?;
    let root = entries.first()?.get("root")?.as_str()?;
    Some(PathBuf::from(root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn explicit_non_graph_is_an_error_not_a_fallthrough() {
        let dir = tempdir().unwrap();
        let err = explicit_graph(dir.path(), "--graph").unwrap_err();
        assert!(err.to_string().contains("not a Kore graph"));
        assert_eq!(err.exit_code(), 1);
    }

    #[test]
    fn explicit_graph_resolves_when_runtime_dir_exists() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join(KORE_DIR)).unwrap();
        let graph = explicit_graph(dir.path(), "--graph").unwrap();
        assert!(graph.root.join(KORE_DIR).is_dir());
    }

    #[test]
    fn last_opened_is_the_newest_entry_only() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recent-graphs.json");
        let entries = serde_json::json!([
            { "root": "/Vaults/Kore Brain", "name": "Kore Brain", "openedMs": 2 },
            { "root": "/Vaults/Test", "name": "Test", "openedMs": 1 },
        ]);
        std::fs::write(&file, entries.to_string()).unwrap();
        assert_eq!(
            last_opened_in(&file),
            Some(PathBuf::from("/Vaults/Kore Brain"))
        );
        assert_eq!(last_opened_in(&dir.path().join("missing.json")), None);
    }

    #[test]
    fn a_pre_rename_graph_resolves_and_moves_to_kore() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".reflect")).unwrap();
        std::fs::write(dir.path().join(".reflect/sources.json"), "{}").unwrap();
        let graph = explicit_graph(dir.path(), "--graph").unwrap();
        assert!(graph.root.join(KORE_DIR).join("sources.json").is_file());
        assert!(!graph.root.join(".reflect").exists());
    }
}
