//! Obsidian's "Excluded files" (`userIgnoreFilters` in `.obsidian/app.json`),
//! honored by the vault walk so an adopted vault's excluded notes (plugin
//! sidecars, archives) stay out of Kore's note list and search as they stay
//! out of Obsidian's.
//!
//! Only notes are excluded. Obsidian still resolves embeds from excluded
//! folders, so attachments under an excluded path keep listing and an
//! `![[photo.png]]` there keeps rendering.
//!
//! A `private: true` note is never excluded. The agent CLIs' privacy fence is
//! built from the index's private notes, so a private note the walk dropped
//! would lose its deny rule while staying readable on disk. Indexing it keeps
//! it fenced; listing one extra note is the cheap side of that trade.

use std::path::Path;

use regex::{Regex, RegexBuilder};

/// Larger than any real Obsidian settings file; a bigger one is not read.
const SETTINGS_MAX_BYTES: u64 = 256 * 1024;

/// Read `<root>/.obsidian/<name>`, the one way Kore reads Obsidian settings.
/// `None` unless `.obsidian` is a real directory (a symlinked one could
/// point anywhere on disk) and `name` a regular file no larger than any real
/// settings file. `name` is a fixed file name, never a caller's path.
pub fn read_obsidian_file(root: &Path, name: &str) -> Option<String> {
    let folder = root.join(".obsidian");
    if !std::fs::symlink_metadata(&folder).is_ok_and(|meta| meta.is_dir()) {
        return None;
    }
    let path = folder.join(name);
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > SETTINGS_MAX_BYTES {
        return None;
    }
    std::fs::read_to_string(&path).ok()
}

/// The parsed exclusion list: path prefixes and `/regex/` filters.
#[derive(Debug, Default)]
pub struct ObsidianExclusions {
    prefixes: Vec<String>,
    patterns: Vec<Regex>,
}

impl ObsidianExclusions {
    /// Exclusions from `<root>/.obsidian/app.json`; none when the file is
    /// absent, oversized, or malformed.
    pub fn load(root: &Path) -> Self {
        read_obsidian_file(root, "app.json")
            .map(|json| Self::from_app_json(&json))
            .unwrap_or_default()
    }

    /// Parse `userIgnoreFilters`. A plain entry excludes every path starting
    /// with it (Obsidian's folder and file filters); `/pattern/` or
    /// `/pattern/i` is a regular expression searched in the path. Entries
    /// that don't parse are skipped, never fatal.
    pub fn from_app_json(json: &str) -> Self {
        let mut exclusions = Self::default();
        let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
            return exclusions;
        };
        let Some(filters) = value.get("userIgnoreFilters").and_then(|v| v.as_array()) else {
            return exclusions;
        };
        for filter in filters.iter().filter_map(|filter| filter.as_str()) {
            let filter = filter.trim();
            if filter.is_empty() {
                continue;
            }
            match regex_filter(filter) {
                Some(Some(pattern)) => exclusions.patterns.push(pattern),
                Some(None) => {}
                None => exclusions
                    .prefixes
                    .push(filter.trim_start_matches('/').to_string()),
            }
        }
        exclusions
    }

    /// Does an exclusion cover this wire path?
    pub fn excludes(&self, wire: &str) -> bool {
        self.prefixes
            .iter()
            .any(|prefix| !prefix.is_empty() && wire.starts_with(prefix.as_str()))
            || self.patterns.iter().any(|pattern| pattern.is_match(wire))
    }

    /// Does an exclusion drop the note at `wire` from the vault listing? An
    /// excluded note that is `private: true`, or whose file can't be read to
    /// tell, stays listed so the privacy fence keeps covering it.
    pub fn excludes_note(&self, root: &Path, wire: &str) -> bool {
        self.excludes(wire) && is_readably_public(&root.join(wire))
    }

    /// No filters at all — the walk can skip the per-note check.
    pub fn is_empty(&self) -> bool {
        self.prefixes.is_empty() && self.patterns.is_empty()
    }
}

/// `true` only when the note reads and its frontmatter is not private.
fn is_readably_public(path: &Path) -> bool {
    let Ok(source) = std::fs::read_to_string(path) else {
        return false;
    };
    let split = reflect_note_policy::split_frontmatter(&source);
    !reflect_note_policy::parse_frontmatter(split.raw).private
}

/// `Some(regex)` for a `/…/flags` filter that compiles, `Some(None)` for one
/// that doesn't, `None` when the filter is a plain path.
fn regex_filter(filter: &str) -> Option<Option<Regex>> {
    let body = filter.strip_prefix('/')?;
    let end = body.rfind('/')?;
    let (pattern, flags) = (&body[..end], &body[end + 1..]);
    if pattern.is_empty() || !flags.chars().all(|flag| "gimsuy".contains(flag)) {
        return None;
    }
    Some(
        RegexBuilder::new(pattern)
            .case_insensitive(flags.contains('i'))
            .build()
            .ok(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_filters_are_prefixes_and_slashed_filters_are_regexes() {
        let exclusions = ObsidianExclusions::from_app_json(
            r#"{"userIgnoreFilters":["Archive/","/\\.sidecar\\.md$/","/(/"]}"#,
        );
        assert!(exclusions.excludes("Archive/old.md"));
        assert!(exclusions.excludes("Resources/_attachments/x.png.sidecar.md"));
        assert!(!exclusions.excludes("Knowledge/Archive/kept.md"));
        assert!(!exclusions.excludes("Resources/_attachments/x.md"));
    }

    #[test]
    fn private_and_unreadable_notes_are_never_excluded() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("Archive")).unwrap();
        std::fs::write(root.join("Archive/old.md"), "# Old\n").unwrap();
        std::fs::write(
            root.join("Archive/secret.md"),
            "---\nprivate: true\n---\n# Secret\n",
        )
        .unwrap();
        let exclusions = ObsidianExclusions::from_app_json(r#"{"userIgnoreFilters":["Archive/"]}"#);
        assert!(exclusions.excludes_note(root, "Archive/old.md"));
        assert!(!exclusions.excludes_note(root, "Archive/secret.md"));
        assert!(!exclusions.excludes_note(root, "Archive/missing.md"));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_settings_folder_is_not_read() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(
            outside.path().join("app.json"),
            r#"{"userIgnoreFilters":["x/"]}"#,
        )
        .unwrap();
        let vault = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.path().join(".obsidian")).unwrap();
        assert_eq!(read_obsidian_file(vault.path(), "app.json"), None);
        assert!(ObsidianExclusions::load(vault.path()).is_empty());

        let real = tempfile::tempdir().unwrap();
        std::fs::create_dir(real.path().join(".obsidian")).unwrap();
        std::fs::write(real.path().join(".obsidian/app.json"), "{}").unwrap();
        assert_eq!(
            read_obsidian_file(real.path(), "app.json").as_deref(),
            Some("{}")
        );
    }

    #[test]
    fn missing_or_malformed_settings_exclude_nothing() {
        assert!(ObsidianExclusions::from_app_json("{}").is_empty());
        assert!(ObsidianExclusions::from_app_json("not json").is_empty());
        assert!(ObsidianExclusions::load(Path::new("/nonexistent")).is_empty());
    }
}
