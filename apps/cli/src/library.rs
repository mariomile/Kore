//! The Library: folders outside the vault that Kore reads but never writes,
//! such as the agents' own homes (`~/.claude`, `~/.codex`, `~/.agents`…),
//! so one place answers "what do my agents know and which skills do they
//! have". Only Markdown is ever listed or read, so the JSON and TOML configs
//! beside it (where agents keep their tokens) stay out of reach.
//!
//! The list of folders is the user's, kept outside any vault:
//! `$KORE_LIBRARIES_FILE`, else `$XDG_CONFIG_HOME/kore/libraries.json`, else
//! `~/.config/kore/libraries.json`. `kore mcp` serves the Library only over
//! stdio, to agents on this machine; the HTTP server never offers it.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::CliError;
use crate::note_file::symlink_free_path;

/// Agent homes `kore library add --known` looks for, relative to `$HOME`.
pub const KNOWN_SOURCES: &[(&str, &str)] = &[
    ("claude", ".claude"),
    ("codex", ".codex"),
    ("agents", ".agents"),
    ("gemini", ".gemini"),
    ("cursor", ".cursor"),
    ("copilot", ".copilot"),
    ("opencode", ".config/opencode"),
];

/// Folders never walked: caches, session logs and dependency trees are
/// large, churn constantly, and hold nothing a person wrote for an agent.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "cache",
    "caches",
    "projects",
    "sessions",
    "shell-snapshots",
    "statsig",
    "todos",
    "logs",
];

/// Larger files are generated, not instructions; they are left out.
const MAX_FILE_BYTES: u64 = 512 * 1024;
/// A walk stops here so a huge folder cannot stall an agent's call.
pub const MAX_FILES: usize = 20_000;

/// One folder in the Library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    /// Short name, the first segment of every Library path (`claude/…`).
    pub name: String,
    /// Absolute folder path.
    pub path: PathBuf,
}

/// A Markdown file in the Library, addressed as `<source>/<relative path>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LibraryFile {
    pub path: String,
    pub bytes: u64,
}

/// Where the list of folders lives, from the environment.
pub fn default_path() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    if let Some(path) = var("KORE_LIBRARIES_FILE") {
        return Some(PathBuf::from(path));
    }
    let config = var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| var("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(config.join("kore").join("libraries.json"))
}

/// The configured folders; a missing or unreadable file is an empty Library.
pub fn load(config: &Path) -> Vec<Source> {
    fs::read(config)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Source>>(&bytes).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|source| valid_name(&source.name) && source.path.is_absolute())
        .collect()
}

fn save(config: &Path, sources: &[Source]) -> Result<(), CliError> {
    if let Some(parent) = config.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(sources)
        .map_err(|err| CliError::runtime(format!("could not write the Library list: {err}")))?;
    let staged = config.with_extension("json.tmp");
    fs::write(&staged, json)?;
    fs::rename(&staged, config)?;
    Ok(())
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 40
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// A source name from a folder: `~/.claude` → `claude`.
fn name_for(path: &Path) -> String {
    let stem = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let cleaned: String = stem
        .trim_start_matches('.')
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "library".to_string()
    } else {
        cleaned.chars().take(40).collect()
    }
}

/// Add a folder. Refuses a name already taken or a folder already listed.
pub fn add(config: &Path, folder: &Path, name: Option<&str>) -> Result<Source, CliError> {
    let path = folder
        .canonicalize()
        .map_err(|err| CliError::Usage(format!("{}: {err}", folder.display())))?;
    if !path.is_dir() {
        return Err(CliError::Usage(format!(
            "not a folder: {}",
            folder.display()
        )));
    }
    let name = name.map_or_else(|| name_for(&path), |name| name.trim().to_lowercase());
    if !valid_name(&name) {
        return Err(CliError::Usage(format!(
            "a Library name is lowercase letters, digits, - or _ (got {name:?})"
        )));
    }
    let mut sources = load(config);
    if let Some(taken) = sources
        .iter()
        .find(|source| source.name == name || source.path == path)
    {
        return Err(CliError::Usage(format!(
            "already in the Library as {:?}: {}",
            taken.name,
            taken.path.display()
        )));
    }
    let source = Source { name, path };
    sources.push(source.clone());
    save(config, &sources)?;
    Ok(source)
}

/// Add every known agent home that exists under `home` and is not listed yet.
pub fn add_known(config: &Path, home: &Path) -> Result<Vec<Source>, CliError> {
    let mut added = Vec::new();
    for (name, relative) in KNOWN_SOURCES {
        let folder = home.join(relative);
        if !folder.is_dir() {
            continue;
        }
        let path = folder.canonicalize()?;
        let listed = load(config);
        if listed
            .iter()
            .any(|source| source.name == *name || source.path == path)
        {
            continue;
        }
        added.push(add(config, &folder, Some(name))?);
    }
    Ok(added)
}

/// Remove a folder by name; `false` when no such name was listed.
pub fn remove(config: &Path, name: &str) -> Result<bool, CliError> {
    let mut sources = load(config);
    let before = sources.len();
    sources.retain(|source| source.name != name);
    if sources.len() == before {
        return Ok(false);
    }
    save(config, &sources)?;
    Ok(true)
}

fn skipped_dir(name: &str) -> bool {
    name.starts_with('.') || SKIPPED_DIRS.contains(&name)
}

fn is_markdown(name: &str) -> bool {
    name.to_lowercase().ends_with(".md")
}

/// Every readable Markdown file in `source`, sorted, at most `MAX_FILES`.
/// Symlinks, hidden and skipped folders and oversized files are left out.
/// The second value says whether the walk stopped at the cap.
pub fn files(source: &Source) -> (Vec<LibraryFile>, bool) {
    let mut found = Vec::new();
    let mut stack = vec![PathBuf::new()];
    let mut truncated = false;
    while let Some(relative) = stack.pop() {
        let Ok(entries) = fs::read_dir(source.path.join(&relative)) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if !skipped_dir(&name) {
                    stack.push(relative.join(&name));
                }
                continue;
            }
            if !kind.is_file() || !is_markdown(&name) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            if found.len() == MAX_FILES {
                truncated = true;
                break;
            }
            let rel = relative.join(&name);
            found.push(LibraryFile {
                path: format!("{}/{}", source.name, slash_path(&rel)),
                bytes: meta.len(),
            });
        }
        if truncated {
            break;
        }
    }
    found.sort_by(|left, right| left.path.cmp(&right.path));
    (found, truncated)
}

fn slash_path(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Read one Library file by its `<source>/<relative path>`. Refuses anything
/// a listing would not show: other extensions, hidden or skipped folders,
/// `..`, symlinks at any depth, oversized files.
pub fn read(sources: &[Source], library_path: &str) -> Result<String, CliError> {
    let refuse = || CliError::Usage(format!("not a Library file: {library_path}"));
    let (name, rel) = library_path.split_once('/').ok_or_else(refuse)?;
    let source = sources
        .iter()
        .find(|source| source.name == name)
        .ok_or_else(|| CliError::NotFound(format!("no Library folder named {name:?}")))?;
    let parts: Vec<&str> = rel.split('/').collect();
    let (file, dirs) = parts.split_last().ok_or_else(refuse)?;
    let clean = Path::new(rel)
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    if !clean || !is_markdown(file) || file.starts_with('.') || dirs.iter().any(|d| skipped_dir(d))
    {
        return Err(refuse());
    }
    let absolute = symlink_free_path(&source.path, rel)
        .map_err(|err| CliError::runtime(format!("{library_path}: {err}")))?
        .ok_or_else(|| CliError::Usage(format!("refusing a symlinked path: {library_path}")))?;
    let meta = fs::metadata(&absolute)
        .map_err(|_| CliError::NotFound(format!("no such Library file: {library_path}")))?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(refuse());
    }
    Ok(fs::read_to_string(&absolute)?)
}

/// One matching line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LibraryMatch {
    pub path: String,
    pub line: usize,
    pub text: String,
}

/// Every line containing `text` across `sources`, at most `limit`; the flag
/// says whether more were left.
pub fn grep(
    sources: &[Source],
    text: &str,
    ignore_case: bool,
    limit: usize,
) -> (Vec<LibraryMatch>, bool) {
    let needle = if ignore_case {
        text.to_lowercase()
    } else {
        text.to_string()
    };
    let mut matches = Vec::new();
    for source in sources {
        let (listed, _) = files(source);
        for file in listed {
            let Ok(content) = read(std::slice::from_ref(source), &file.path) else {
                continue;
            };
            for (index, line) in content.lines().enumerate() {
                let hit = if ignore_case {
                    line.to_lowercase().contains(&needle)
                } else {
                    line.contains(&needle)
                };
                if !hit {
                    continue;
                }
                if matches.len() == limit {
                    return (matches, true);
                }
                matches.push(LibraryMatch {
                    path: file.path.clone(),
                    line: index + 1,
                    text: line.to_string(),
                });
            }
        }
    }
    (matches, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn library() -> (tempfile::TempDir, PathBuf, Source) {
        let dir = tempdir().unwrap();
        let home = dir.path().join("home/.claude");
        fs::create_dir_all(home.join("skills/review")).unwrap();
        fs::create_dir_all(home.join("projects/x")).unwrap();
        fs::create_dir_all(home.join(".secret")).unwrap();
        fs::write(
            home.join("CLAUDE.md"),
            "# Rules\nAlways answer in Italian\n",
        )
        .unwrap();
        fs::write(home.join("skills/review/SKILL.md"), "review the diff\n").unwrap();
        fs::write(home.join("projects/x/log.md"), "session log\n").unwrap();
        fs::write(home.join(".secret/token.md"), "sk-123\n").unwrap();
        fs::write(home.join("settings.json"), "{\"token\":\"sk\"}").unwrap();
        let config = dir.path().join("config/libraries.json");
        let source = add(&config, &home, None).unwrap();
        (dir, config, source)
    }

    #[test]
    fn lists_only_markdown_outside_hidden_and_skipped_folders() {
        let (_dir, config, source) = library();
        assert_eq!(source.name, "claude");
        assert_eq!(load(&config), vec![source.clone()]);
        let (listed, truncated) = files(&source);
        let paths: Vec<&str> = listed.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, ["claude/CLAUDE.md", "claude/skills/review/SKILL.md"]);
        assert!(!truncated);
    }

    #[test]
    fn reads_listed_files_and_refuses_everything_else() {
        let (_dir, config, _) = library();
        let sources = load(&config);
        assert!(read(&sources, "claude/CLAUDE.md")
            .unwrap()
            .contains("Italian"));
        for refused in [
            "claude/settings.json",
            "claude/.secret/token.md",
            "claude/projects/x/log.md",
            "claude/../claude/CLAUDE.md",
            "claude",
        ] {
            assert!(
                read(&sources, refused).is_err(),
                "{refused} should be refused"
            );
        }
        assert!(matches!(
            read(&sources, "codex/AGENTS.md"),
            Err(CliError::NotFound(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_reads_through_a_symlinked_folder() {
        let (dir, config, source) = library();
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("notes.md"), "private").unwrap();
        std::os::unix::fs::symlink(&outside, source.path.join("linked")).unwrap();
        let sources = load(&config);
        assert!(read(&sources, "claude/linked/notes.md").is_err());
        assert!(files(&source)
            .0
            .iter()
            .all(|file| !file.path.contains("linked")));
    }

    #[test]
    fn greps_across_sources_and_stops_at_the_limit() {
        let (_dir, config, _) = library();
        let sources = load(&config);
        let (found, more) = grep(&sources, "italian", true, 10);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "claude/CLAUDE.md");
        assert_eq!(found[0].line, 2);
        assert!(!more);
        let (_, more) = grep(&sources, "e", false, 1);
        assert!(more);
    }

    #[test]
    fn add_refuses_duplicates_and_remove_forgets() {
        let (dir, config, source) = library();
        assert!(add(&config, &source.path, Some("other")).is_err());
        let codex = dir.path().join("home/.codex");
        fs::create_dir_all(&codex).unwrap();
        let added = add_known(&config, &dir.path().join("home")).unwrap();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].name, "codex");
        assert!(remove(&config, "codex").unwrap());
        assert!(!remove(&config, "codex").unwrap());
        assert_eq!(load(&config).len(), 1);
    }
}
