//! The Library: coding agents' home folders (`~/.claude`, `~/.codex`,
//! `~/.agents`, …) browsable read-only inside Kore, so the skills, agent
//! definitions and memory files those tools keep can be read next to the
//! graph. Nothing here writes.
//!
//! This module is the fence: the folders are a fixed list (a caller names
//! one by id, never by path), only markdown files are read, every path
//! component below a folder must be a plain name that does not start with
//! `.` (so no traversal and no `~/.claude/.credentials.json`-style dotfiles),
//! and the real path, after symlinks, must sit inside one of the folders
//! with no hidden component below it (so the skills Claude Code links in
//! from `~/.agents` show, and a link to a dotfile or out of the folders
//! does not). Folders load one level at a time because `~/.claude` alone can
//! hold ten thousand markdown files.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Each folder's id, its path under the home directory, and its label.
const ROOTS: [(&str, &str, &str); 8] = [
    ("claude", ".claude", "Claude Code"),
    ("codex", ".codex", "Codex"),
    ("agents", ".agents", "Agents"),
    ("gemini", ".gemini", "Gemini"),
    ("cursor", ".cursor", "Cursor"),
    ("copilot", ".copilot", "Copilot"),
    ("opencode", ".config/opencode", "OpenCode"),
    ("kiro", ".kiro", "Kiro"),
];

/// Files larger than this are refused rather than shipped to the webview.
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: String,
    pub label: String,
    /// Absolute, for display.
    pub path: String,
}

/// One folder level: subfolder names and markdown file names, each sorted.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDir {
    pub folders: Vec<String>,
    pub files: Vec<String>,
}

fn home() -> AppResult<PathBuf> {
    dirs::home_dir().ok_or_else(|| AppError::io("no home directory"))
}

/// The folders from [`ROOTS`] that exist under `home`.
fn roots_in(home: &Path) -> Vec<LibraryRoot> {
    ROOTS
        .iter()
        .filter(|(_, rel, _)| home.join(rel).is_dir())
        .map(|(id, rel, label)| LibraryRoot {
            id: (*id).to_string(),
            label: (*label).to_string(),
            path: home.join(rel).to_string_lossy().into_owned(),
        })
        .collect()
}

fn root_dir(home: &Path, id: &str) -> AppResult<PathBuf> {
    ROOTS
        .iter()
        .find(|(root_id, _, _)| *root_id == id)
        .map(|(_, rel, _)| home.join(rel))
        .ok_or_else(|| AppError::not_found(format!("no library folder named {id}")))
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

/// The canonical paths of every Library folder that exists under `home`. A
/// symlink is followed only when its real target lands in one of them.
fn fence(home: &Path) -> Vec<PathBuf> {
    ROOTS
        .iter()
        .filter_map(|(_, rel, _)| home.join(rel).canonicalize().ok())
        .collect()
}

/// Whether a canonical path sits inside a Library folder with no hidden
/// component below it. Checked on the real path, after symlinks, so a link
/// named `notes.md` cannot hand out `.credentials.json`.
fn fenced(fence: &[PathBuf], canonical: &Path) -> bool {
    fence.iter().any(|root| {
        canonical.strip_prefix(root).is_ok_and(|below| {
            below
                .components()
                .all(|part| matches!(part, Component::Normal(name) if !is_hidden(&name.to_string_lossy())))
        })
    })
}

/// `rel` (forward slashes, may be empty for the folder itself) resolved
/// inside `root`: plain, non-hidden components only, and a real path that
/// is still fenced once symlinks are followed.
fn resolve_inside(home: &Path, root: &Path, rel: &str) -> AppResult<PathBuf> {
    let mut joined = root.to_path_buf();
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(part) if !is_hidden(&part.to_string_lossy()) => joined.push(part),
            _ => return Err(AppError::traversal(format!("not a library path: {rel}"))),
        }
    }
    let canonical = joined.canonicalize()?;
    if !fenced(&fence(home), &canonical) {
        return Err(AppError::traversal(format!("{rel} leaves the library")));
    }
    Ok(canonical)
}

fn list_in(home: &Path, root: &Path, rel: &str) -> AppResult<LibraryDir> {
    let dir = resolve_inside(home, root, rel)?;
    let fence = fence(home);
    let mut folders = Vec::new();
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden(&name) {
            continue;
        }
        // A symlink shows only when its real target is fenced too: skills
        // linked from `~/.agents/skills` into `~/.claude/skills` do, a link
        // out to a dotfiles repo or into a hidden folder does not.
        let Ok(canonical) = entry.path().canonicalize() else {
            continue;
        };
        if !fenced(&fence, &canonical) {
            continue;
        }
        let Ok(meta) = fs::metadata(&canonical) else {
            continue;
        };
        if meta.is_dir() {
            folders.push(name);
        } else if meta.is_file() && is_markdown(&name) && is_markdown(&canonical.to_string_lossy())
        {
            files.push(name);
        }
    }
    folders.sort_by_key(|name| name.to_lowercase());
    files.sort_by_key(|name| name.to_lowercase());
    Ok(LibraryDir { folders, files })
}

fn read_in(home: &Path, root: &Path, rel: &str) -> AppResult<String> {
    let path = resolve_inside(home, root, rel)?;
    // Both the name asked for and the file it really is must be markdown.
    if !is_markdown(rel) || !is_markdown(&path.to_string_lossy()) {
        return Err(AppError::traversal(format!("not a markdown file: {rel}")));
    }
    let file = fs::File::open(&path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::not_found(format!("not a file: {rel}")));
    }
    // Bounded by the read itself, so a file growing after a size check
    // still cannot push more than the cap into the webview.
    let mut bytes = Vec::new();
    file.take(MAX_READ_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(AppError::io(format!("{rel} is too large to show")));
    }
    String::from_utf8(bytes).map_err(|_| AppError::parse(format!("{rel} is not UTF-8 text")))
}

/// Command: the agent folders that exist on this machine. Read-only.
#[tauri::command]
pub async fn library_roots() -> AppResult<Vec<LibraryRoot>> {
    crate::blocking::run_blocking(move || Ok(roots_in(&home()?))).await
}

/// Command: one level of a library folder (`dir` relative to it, `""` for
/// its top). Read-only.
#[tauri::command]
pub async fn library_list(root: String, dir: String) -> AppResult<LibraryDir> {
    crate::blocking::run_blocking(move || {
        let home = home()?;
        list_in(&home, &root_dir(&home, &root)?, &dir)
    })
    .await
}

/// Command: one markdown file's text from a library folder. Read-only.
#[tauri::command]
pub async fn library_read(root: String, path: String) -> AppResult<String> {
    crate::blocking::run_blocking(move || {
        let home = home()?;
        read_in(&home, &root_dir(&home, &root)?, &path)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let home = tempfile::tempdir().expect("tempdir");
        let claude = home.path().join(".claude");
        fs::create_dir_all(claude.join("skills/review")).expect("skills");
        fs::create_dir_all(claude.join(".secret")).expect("hidden dir");
        fs::write(claude.join("CLAUDE.md"), "# Rules").expect("claude.md");
        fs::write(claude.join("skills/review/SKILL.md"), "# Review").expect("skill");
        fs::write(claude.join("settings.json"), "{}").expect("json");
        fs::write(claude.join(".credentials.md"), "token").expect("dotfile");
        fs::write(claude.join(".secret/notes.md"), "hidden").expect("hidden note");
        fs::write(home.path().join("outside.md"), "outside").expect("outside");
        home
    }

    #[cfg(unix)]
    #[test]
    fn a_skill_linked_in_from_another_agent_folder_shows_and_reads() {
        let home = fixture();
        let shared = home.path().join(".agents/skills/plan");
        fs::create_dir_all(&shared).expect("agents skill");
        fs::write(shared.join("SKILL.md"), "# Plan").expect("skill file");
        let root = root_dir(home.path(), "claude").expect("root");
        std::os::unix::fs::symlink(&shared, root.join("skills/plan")).expect("symlink");
        let skills = list_in(home.path(), &root, "skills").expect("skills");
        assert_eq!(skills.folders, ["plan", "review"]);
        assert_eq!(
            read_in(home.path(), &root, "skills/plan/SKILL.md").expect("read"),
            "# Plan"
        );
    }

    #[test]
    fn roots_lists_only_existing_folders() {
        let home = fixture();
        let roots = roots_in(home.path());
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].id, "claude");
        assert_eq!(roots[0].label, "Claude Code");
    }

    #[test]
    fn list_shows_folders_and_markdown_but_no_hidden_entries() {
        let home = fixture();
        let root = root_dir(home.path(), "claude").expect("root");
        let top = list_in(home.path(), &root, "").expect("top");
        assert_eq!(top.folders, ["skills"]);
        assert_eq!(top.files, ["CLAUDE.md"]);
        let nested = list_in(home.path(), &root, "skills/review").expect("nested");
        assert_eq!(nested.files, ["SKILL.md"]);
    }

    #[test]
    fn read_returns_markdown_inside_the_folder() {
        let home = fixture();
        let root = root_dir(home.path(), "claude").expect("root");
        assert_eq!(
            read_in(home.path(), &root, "skills/review/SKILL.md").expect("read"),
            "# Review"
        );
    }

    #[test]
    fn read_refuses_hidden_traversal_non_markdown_and_unknown_roots() {
        let home = fixture();
        let root = root_dir(home.path(), "claude").expect("root");
        for rel in [
            ".credentials.md",
            ".secret/notes.md",
            "../outside.md",
            "settings.json",
        ] {
            assert!(
                read_in(home.path(), &root, rel).is_err(),
                "{rel} should be refused"
            );
        }
        assert!(list_in(home.path(), &root, "..").is_err());
        assert!(list_in(home.path(), &root, ".secret").is_err());
        assert!(root_dir(home.path(), "../etc").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn read_refuses_a_symlink_that_leaves_the_folder() {
        let home = fixture();
        let root = root_dir(home.path(), "claude").expect("root");
        std::os::unix::fs::symlink(home.path().join("outside.md"), root.join("link.md"))
            .expect("symlink");
        assert!(read_in(home.path(), &root, "link.md").is_err());
        // A link that stays inside the folders but lands on a hidden file or
        // a non-markdown file is refused by its real path, not its name.
        std::os::unix::fs::symlink(root.join(".credentials.md"), root.join("notes.md"))
            .expect("symlink to dotfile");
        std::os::unix::fs::symlink(root.join("settings.json"), root.join("settings.md"))
            .expect("symlink to json");
        std::os::unix::fs::symlink(root.join(".secret"), root.join("x")).expect("symlink to dir");
        for rel in ["notes.md", "settings.md", "x/notes.md"] {
            assert!(
                read_in(home.path(), &root, rel).is_err(),
                "{rel} should be refused"
            );
        }
        assert!(list_in(home.path(), &root, "x").is_err());
        let top = list_in(home.path(), &root, "").expect("top");
        assert!(!top
            .files
            .iter()
            .any(|f| f == "notes.md" || f == "settings.md"));
        assert!(!top.folders.iter().any(|f| f == "x"));
        assert!(list_in(home.path(), &root, "")
            .expect("top")
            .files
            .iter()
            .all(|f| f != "link.md"));
    }
}
