//! `reflect new <title>` — create a regular note the way the app would: a
//! title-derived filename (`notes/<slug>.md`, `-2` suffix on collision,
//! claimed with an atomic no-clobber create) and an H1 title. `--template`
//! seeds the body from a `templates/` file with its frontmatter stripped and
//! the `{{date}}`/`{{date:iso}}`/`{{time}}`/`{{title}}` placeholders
//! expanded (`packages/core/src/markdown/template-placeholders.ts`). The CLI
//! deliberately mints no frontmatter `id:` — the app owns those — and a
//! `private: true` template is refused: copying its body into a new public
//! note would leak it.

use std::fs;
use std::io::Write;
use std::path::Path;

use reflect_note_policy::split_frontmatter;

use crate::body_tag::{append_body_tag, is_tag_name};
use crate::commands::output::{print_json, NewJson};
use crate::commands::properties::property_json;
use crate::commands::{open_index_for_resolution, warn};
use crate::error::CliError;
use crate::frontmatter_write::{patch_source, Patch};
use crate::graph::Graph;
use crate::keys::fold_key;
use crate::keys::fold_tag;
use crate::note_file::parse_note_meta;
use crate::paths::today_date;
use crate::schema::{parse_assignments, union_schema, TagSchema};
use crate::slug::slug_for_title;
use crate::write::read_stdin;

/// Far beyond any real graph's same-slug population; fail loud instead of
/// spinning (`create-note.ts`'s `MAX_CREATE_ATTEMPTS`).
const MAX_CREATE_ATTEMPTS: usize = 1000;

struct TemplateValues {
    title: String,
    date: String,
    date_iso: String,
    time: String,
}

fn ordinal_suffix(day: i8) -> &'static str {
    match day {
        11..=13 => "th",
        _ => match day % 10 {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        },
    }
}

/// The app's default display formats (`formatDayLabel` with `mdy`,
/// `formatTimeOfDay` with `12h`) — the CLI cannot read the user's format
/// settings, so it mirrors the defaults.
fn template_values(title: &str) -> TemplateValues {
    let now = jiff::Zoned::now();
    let date = now.date();
    let hour = now.hour();
    let hour12 = ((hour + 11) % 12) + 1;
    let meridiem = if hour < 12 { "am" } else { "pm" };
    TemplateValues {
        title: title.to_string(),
        date: format!(
            "{}, {} {}{}, {}",
            now.strftime("%a"),
            now.strftime("%B"),
            date.day(),
            ordinal_suffix(date.day()),
            date.year()
        ),
        date_iso: today_date(),
        time: format!("{}:{:02}{}", hour12, now.minute(), meridiem),
    }
}

/// Expand the known placeholders — the scanner mirror of the TS module's
/// `/\{\{\s*(title|date:iso|date|time)\s*\}\}/gi`: whitespace inside the
/// braces and any casing are accepted; anything else passes through.
fn expand_placeholders(body: &str, values: &TemplateValues) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            break;
        };
        let replacement = match after[..end].trim().to_ascii_lowercase().as_str() {
            "title" => Some(values.title.as_str()),
            "date" => Some(values.date.as_str()),
            "date:iso" => Some(values.date_iso.as_str()),
            "time" => Some(values.time.as_str()),
            _ => None,
        };
        match replacement {
            Some(value) => {
                out.push_str(&rest[..start]);
                out.push_str(value);
                rest = &after[end + 2..];
            }
            None => {
                // Not a placeholder: emit through the `{{` and rescan after it.
                out.push_str(&rest[..start + 2]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Resolve `--template` to a `templates/*.md` body (frontmatter stripped),
/// matching by explicit path, filename stem, or H1 title (case-insensitive).
fn template_body(root: &Path, arg: &str) -> Result<String, CliError> {
    let key = fold_key(arg.trim().strip_prefix("templates/").unwrap_or(arg.trim()));
    let key = key.strip_suffix(".md").unwrap_or(&key).to_string();
    let dir = root.join("templates");
    let mut names: Vec<String> = match fs::read_dir(&dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| name.to_ascii_lowercase().ends_with(".md"))
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    for name in names {
        let rel_path = format!("templates/{name}");
        let Ok(content) = fs::read_to_string(root.join(&rel_path)) else {
            continue;
        };
        let meta = parse_note_meta(&rel_path, &content);
        let stem = name.strip_suffix(".md").unwrap_or(&name);
        if fold_key(stem) != key && fold_key(&meta.title) != key {
            continue;
        }
        if meta.private {
            return Err(CliError::Private(format!(
                "template is private: {rel_path}"
            )));
        }
        return Ok(split_frontmatter(&content).body.to_string());
    }
    Err(CliError::NotFound(format!(
        "no template matching '{arg}' under templates/"
    )))
}

/// Atomic create that refuses to replace an existing file — the claim step of
/// the collision loop (`create-note.ts`'s no-clobber create).
fn create_noclobber(path: &Path, contents: &str) -> Result<bool, CliError> {
    let dir = path
        .parent()
        .ok_or_else(|| CliError::Runtime(format!("no parent directory for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents.as_bytes())?;
    tmp.flush()?;
    match tmp.persist_noclobber(path) {
        Ok(_) => Ok(true),
        Err(err) if err.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(err) => Err(CliError::Runtime(err.to_string())),
    }
}

/// Where a new note's body comes from, in precedence order.
fn seed_body(
    graph: &Graph,
    template: Option<&str>,
    stdin: bool,
    schema: &TagSchema,
) -> Result<Option<String>, CliError> {
    if stdin {
        if template.is_some() {
            return Err(CliError::Usage(
                "give the body on stdin (--stdin) or from --template, not both".to_string(),
            ));
        }
        let body = read_stdin()?;
        return Ok((!body.trim().is_empty()).then_some(body));
    }
    if let Some(template_arg) = template {
        return Ok(Some(template_body(&graph.root, template_arg)?));
    }
    // A typed tag's bound template seeds its rows, like the table's "+ New"
    // (`createTitledCollectionNote`); a missing file just means no seed.
    if let Some(bound) = &schema.template {
        return Ok(template_body(&graph.root, bound).ok());
    }
    Ok(None)
}

pub fn run(
    graph: &Graph,
    json: bool,
    title: &str,
    template: Option<&str>,
    tag_args: &[String],
    sets: &[String],
    stdin: bool,
) -> Result<(), CliError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(CliError::Runtime("the note needs a title".to_string()));
    }
    let mut tags: Vec<String> = Vec::new();
    for tag_arg in tag_args {
        let tag = tag_arg.trim().trim_start_matches('#');
        if !is_tag_name(tag) {
            return Err(CliError::Usage(format!(
                "'{tag_arg}' is not a tag name (a letter, then letters, digits, /, _ or -)"
            )));
        }
        if !tags
            .iter()
            .any(|existing| fold_tag(existing) == fold_tag(tag))
        {
            tags.push(tag.to_string());
        }
    }
    let index = open_index_for_resolution(&graph.root);
    let schema = match &index {
        Some(open) => union_schema(&open.conn, &tags)?,
        None => {
            if !sets.is_empty() {
                warn("no index — values are written as text (open the graph in Kore to type them)");
            }
            TagSchema::default()
        }
    };

    let content = match seed_body(graph, template, stdin, &schema)? {
        None => format!("# {title}\n"),
        Some(seed) => {
            let body = expand_placeholders(&seed, &template_values(title));
            let body = body.trim_start_matches(['\n', '\r']);
            // A template that opens with its own H1 owns the note's structure
            // (it can title through {{title}}); otherwise the title leads.
            let seeded = if body.starts_with("# ") {
                body.to_string()
            } else {
                format!("# {title}\n\n{body}")
            };
            if seeded.ends_with('\n') {
                seeded
            } else {
                format!("{seeded}\n")
            }
        }
    };
    let mut content = content;
    for tag in &tags {
        if let Some(tagged) = append_body_tag(&content, tag) {
            content = tagged;
        }
    }
    let mut values = parse_assignments(&schema, sets)?;
    for (key, stamp) in schema.created_stamps() {
        if !values.iter().any(|(present, _)| *present == key) {
            values.push((key, stamp));
        }
    }
    let patch: Patch = values
        .iter()
        .map(|(key, value)| (key.clone(), Some(value.clone())))
        .collect();
    let content = patch_source(&content, &patch)?;
    let mut properties = serde_json::Map::new();
    for (key, value) in &values {
        properties.insert(key.clone(), property_json(value));
    }

    let slug = slug_for_title(title);
    for ordinal in 1..=MAX_CREATE_ATTEMPTS {
        let stem = if ordinal == 1 {
            slug.clone()
        } else {
            format!("{slug}-{ordinal}")
        };
        let rel_path = format!("notes/{stem}.md");
        let absolute = graph.root.join(&rel_path);
        if !create_noclobber(&absolute, &content)? {
            continue;
        }
        if json {
            return print_json(&NewJson {
                path: &rel_path,
                absolute_path: absolute.display().to_string(),
                title,
                tags: &tags,
                properties,
            });
        }
        println!("{}", absolute.display());
        return Ok(());
    }
    Err(CliError::Runtime(format!(
        "no available note path for slug \"{slug}\" after {MAX_CREATE_ATTEMPTS} attempts"
    )))
}

#[cfg(test)]
mod tests {
    use super::{expand_placeholders, ordinal_suffix, TemplateValues};

    fn values() -> TemplateValues {
        TemplateValues {
            title: "Project X".to_string(),
            date: "Thu, August 20th, 2026".to_string(),
            date_iso: "2026-08-20".to_string(),
            time: "3:07pm".to_string(),
        }
    }

    #[test]
    fn expands_known_placeholders_case_and_space_insensitively() {
        assert_eq!(
            expand_placeholders(
                "# {{ Title }}\n{{DATE:ISO}} at {{time}} on {{date}}",
                &values()
            ),
            "# Project X\n2026-08-20 at 3:07pm on Thu, August 20th, 2026"
        );
    }

    #[test]
    fn leaves_unknown_tokens_and_unclosed_braces_alone() {
        assert_eq!(
            expand_placeholders("{{nope}} {{date} {{", &values()),
            "{{nope}} {{date} {{"
        );
        assert_eq!(
            expand_placeholders("{{ {{date:iso}} }}", &values()),
            "{{ 2026-08-20 }}"
        );
    }

    #[test]
    fn ordinal_suffixes_cover_the_teens() {
        assert_eq!(ordinal_suffix(1), "st");
        assert_eq!(ordinal_suffix(2), "nd");
        assert_eq!(ordinal_suffix(3), "rd");
        assert_eq!(ordinal_suffix(4), "th");
        assert_eq!(ordinal_suffix(11), "th");
        assert_eq!(ordinal_suffix(12), "th");
        assert_eq!(ordinal_suffix(13), "th");
        assert_eq!(ordinal_suffix(21), "st");
        assert_eq!(ordinal_suffix(22), "nd");
        assert_eq!(ordinal_suffix(23), "rd");
    }
}
