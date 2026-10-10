//! Obsidian's "Excluded files" (`userIgnoreFilters` in `.obsidian/app.json`),
//! honored by the vault walk so an adopted vault's excluded notes (plugin
//! sidecars, archives) stay out of Kore's note list and search as they stay
//! out of Obsidian's.
//!
//! Only notes are excluded. Obsidian still resolves embeds from excluded
//! folders, so attachments under an excluded path keep listing and an
//! `![[photo.png]]` there keeps rendering.

use std::path::Path;

use regex::{Regex, RegexBuilder};

/// Larger than any real Obsidian settings file; a bigger one is not read.
const APP_JSON_MAX_BYTES: u64 = 256 * 1024;

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
        let path = root.join(".obsidian").join("app.json");
        let readable = std::fs::symlink_metadata(&path)
            .is_ok_and(|meta| meta.is_file() && meta.len() <= APP_JSON_MAX_BYTES);
        if !readable {
            return Self::default();
        }
        std::fs::read_to_string(&path)
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

    /// No filters at all — the walk can skip the per-note check.
    pub fn is_empty(&self) -> bool {
        self.prefixes.is_empty() && self.patterns.is_empty()
    }
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
    fn missing_or_malformed_settings_exclude_nothing() {
        assert!(ObsidianExclusions::from_app_json("{}").is_empty());
        assert!(ObsidianExclusions::from_app_json("not json").is_empty());
        assert!(ObsidianExclusions::load(Path::new("/nonexistent")).is_empty());
    }
}
