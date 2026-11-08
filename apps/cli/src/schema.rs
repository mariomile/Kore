//! Tag schemas (TDR 0005) as the CLI reads and honours them: the
//! `tag_types.schema_json` decoding shared by `collection`, `set`, and
//! `new`, plus the typed coercion that turns an agent's `key=value` into the
//! frontmatter value the app's own editors would write
//! (`typedValueForText`, `apps/desktop/src/components/tags/property-editor-shared.tsx`,
//! and the per-type editors). View-only types are refused, never written.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::commands::warn;
use crate::error::CliError;
use crate::frontmatter_values::{is_reserved_key, PropertyValue};
use crate::keys::fold_tag;
use crate::paths::{parse_calendar_date, today_date};

/// One schema entry of `tag_types.schema_json` — the fields the CLI uses.
/// Serde mirrors `tagPropertySchema` (`packages/core/src/tags/tag-type.ts`);
/// unknown fields are ignored so a newer app schema still decodes.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct SchemaProperty {
    pub name: String,
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// `select`/`multiselect`/`status` choices, when declared.
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

/// A decoded tag type: its properties, the bound new-row template path, and
/// the tags it builds on (`extends:`, Plan 33 B2; folded keys).
#[derive(Clone, Debug, Default)]
pub struct TagSchema {
    pub properties: Vec<SchemaProperty>,
    pub template: Option<String>,
    pub extends: Vec<String>,
}

/// The two on-disk forms of `tag_types.schema_json`, mirroring
/// `decodeTagTypeJson`: a bare property array, or `{properties, template}`
/// once the tag carries a new-row template.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum SchemaJson {
    Properties(Vec<SchemaProperty>),
    Object {
        properties: Vec<SchemaProperty>,
        #[serde(default)]
        template: Option<String>,
        #[serde(default)]
        extends: Vec<String>,
    },
}

/// Decode a stored schema column. Tolerant like the app: a mangled column
/// reads as an empty schema.
pub fn decode_schema(schema_json: &str) -> TagSchema {
    match serde_json::from_str::<SchemaJson>(schema_json) {
        Ok(SchemaJson::Properties(properties)) => TagSchema {
            properties,
            template: None,
            extends: Vec::new(),
        },
        Ok(SchemaJson::Object {
            properties,
            template,
            extends,
        }) => TagSchema {
            properties,
            template,
            extends: extends.iter().map(|parent| fold_tag(parent)).collect(),
        },
        Err(_) => TagSchema::default(),
    }
}

/// The schema of one tag, or `None` when the tag has no type. Inherited
/// fields are merged in the way the app merges them (`resolveTagTypes`,
/// `packages/core/src/tags/tag-inheritance.ts`): the parents' fields first,
/// then the tag's own, its own winning a key clash in the parent's slot.
pub fn load_schema(conn: &Connection, tag: &str) -> Result<Option<TagSchema>, CliError> {
    let key = fold_tag(tag);
    let schemas = load_all_schemas(conn)?;
    if !schemas.contains_key(&key) {
        return Ok(None);
    }
    Ok(resolve_schema(&schemas, &key, &mut Vec::new()))
}

/// Every stored tag schema by folded key, as written (inheritance not yet
/// applied). The table holds one row per definition note.
pub fn load_all_schemas(conn: &Connection) -> Result<HashMap<String, TagSchema>, CliError> {
    let mut statement = conn.prepare("SELECT tag_key, schema_json FROM tag_types")?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(key, schema_json)| (key, decode_schema(&schema_json)))
        .collect())
}

/// One tag's effective schema; a parent already on `trail` closes a loop
/// and is skipped, the way the app cuts it.
fn resolve_schema(
    schemas: &HashMap<String, TagSchema>,
    key: &str,
    trail: &mut Vec<String>,
) -> Option<TagSchema> {
    let own = schemas.get(key)?;
    trail.push(key.to_string());
    let mut inherited: Vec<SchemaProperty> = Vec::new();
    for parent in &own.extends {
        if trail.iter().any(|seen| seen == parent) {
            continue;
        }
        let Some(parent_schema) = resolve_schema(schemas, parent, trail) else {
            continue;
        };
        for property in parent_schema.properties {
            if !inherited
                .iter()
                .any(|existing| existing.key == property.key)
            {
                inherited.push(property);
            }
        }
    }
    trail.pop();
    let mut properties: Vec<SchemaProperty> = inherited
        .into_iter()
        .map(|property| own.property(&property.key).cloned().unwrap_or(property))
        .collect();
    for property in &own.properties {
        if !properties
            .iter()
            .any(|existing| existing.key == property.key)
        {
            properties.push(property.clone());
        }
    }
    Some(TagSchema {
        properties,
        template: own.template.clone(),
        extends: own.extends.clone(),
    })
}

/// Every tag that builds on `key`, directly or not, sorted, without `key`.
/// A parent's collection lists these tags' notes too (Plan 33 B2).
pub fn tag_descendants(schemas: &HashMap<String, TagSchema>, key: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut queue = vec![key.to_string()];
    while let Some(next) = queue.pop() {
        for (child, schema) in schemas {
            if child != key
                && schema.extends.iter().any(|parent| parent == &next)
                && !found.contains(child)
            {
                found.push(child.clone());
                queue.push(child.clone());
            }
        }
    }
    found.sort();
    found
}

/// The tags the index knows for a note, display-cased, one per key.
pub fn note_tags(conn: &Connection, rel_path: &str) -> Result<Vec<String>, CliError> {
    let mut statement = conn.prepare(
        "SELECT min(tag) FROM tags WHERE note_path = ?1 GROUP BY tag_key ORDER BY tag_key",
    )?;
    let tags = statement
        .query_map([rel_path], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

/// The schema a note's property writes are typed by: the union of the
/// schemas of every tag the index knows it carries.
pub fn schema_for_note(conn: &Connection, rel_path: &str) -> Result<TagSchema, CliError> {
    union_schema(conn, &note_tags(conn, rel_path)?)
}

/// Said once by `set`/`new` when there is no index to type values with.
pub fn warn_untyped_writes() {
    warn("no index — values are written as text (open the graph in Kore to type them)");
}

/// The union schema of several tags: the first declaration of a key wins,
/// like two types sharing `author` Obsidian-style.
pub fn union_schema(conn: &Connection, tags: &[String]) -> Result<TagSchema, CliError> {
    let mut union = TagSchema::default();
    for tag in tags {
        let Some(schema) = load_schema(conn, tag)? else {
            continue;
        };
        if union.template.is_none() {
            union.template = schema.template;
        }
        for property in schema.properties {
            if !union
                .properties
                .iter()
                .any(|existing| existing.key == property.key)
            {
                union.properties.push(property);
            }
        }
    }
    Ok(union)
}

impl TagSchema {
    pub fn property(&self, key: &str) -> Option<&SchemaProperty> {
        self.properties.iter().find(|property| property.key == key)
    }

    /// The `created` stamps a row born today would carry
    /// (`createdStampValues`, `packages/core/src/tags/timestamps.ts`).
    pub fn created_stamps(&self) -> Vec<(String, PropertyValue)> {
        let today = today_date();
        self.properties
            .iter()
            .filter(|property| property.kind == "created")
            .map(|property| (property.key.clone(), PropertyValue::String(today.clone())))
            .collect()
    }
}

/// Property keys are plain identifiers, never reserved (`isPropertyKey`).
pub fn is_property_key(key: &str) -> bool {
    let mut chars = key.chars();
    let first_ok = chars.next().is_some_and(|first| first.is_alphanumeric());
    first_ok
        && chars
            .all(|character| character.is_alphanumeric() || character == '_' || character == '-')
        && !is_reserved_key(key)
}

/// Wrap a relation target as its frontmatter value (`relationValue`), unless
/// the agent already passed a `[[link]]`.
fn relation_value(target: &str) -> String {
    let target = target.trim();
    if target.starts_with("[[") && target.ends_with("]]") {
        target.to_string()
    } else {
        format!("[[{target}]]")
    }
}

/// `select`-family values outside the declared options are written anyway
/// (the app tolerates them) but flagged, so a typo does not pass silently.
fn warn_unknown_options(property: &SchemaProperty, key: &str, values: &[String]) {
    let Some(options) = &property.options else {
        return;
    };
    for value in values {
        if !options.contains(value) {
            warn(format!(
                "{key}: '{value}' is not one of the declared options"
            ));
        }
    }
}

fn split_list(raw: &str, key: &str) -> Result<Vec<String>, CliError> {
    let items: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    if items.is_empty() {
        return Err(CliError::Usage(format!(
            "{key}: give at least one comma-separated value"
        )));
    }
    Ok(items)
}

/// Coerce an agent's text for `key` into the typed frontmatter value its
/// schema entry declares; a key without a schema entry is written as text.
pub fn coerce(
    property: Option<&SchemaProperty>,
    key: &str,
    raw: &str,
) -> Result<PropertyValue, CliError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CliError::Usage(format!(
            "{key}: empty value — use --unset {key} to remove it"
        )));
    }
    let Some(property) = property else {
        return Ok(PropertyValue::String(trimmed.to_string()));
    };
    match property.kind.as_str() {
        "number" => trimmed
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite())
            .map(PropertyValue::Number)
            .ok_or_else(|| CliError::Usage(format!("{key}: expected a number, got '{trimmed}'"))),
        "rating" => trimmed
            .parse::<i64>()
            .ok()
            .filter(|rating| (1..=5).contains(rating))
            .map(|rating| PropertyValue::Number(rating as f64))
            .ok_or_else(|| {
                CliError::Usage(format!(
                    "{key}: expected a rating from 1 to 5, got '{trimmed}'"
                ))
            }),
        "checkbox" => match trimmed.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" => Ok(PropertyValue::Bool(true)),
            "false" | "no" | "0" => Ok(PropertyValue::Bool(false)),
            _ => Err(CliError::Usage(format!(
                "{key}: expected true or false, got '{trimmed}'"
            ))),
        },
        "date" | "created" => parse_calendar_date(trimmed)
            .map(|date| PropertyValue::String(date.to_string()))
            .ok_or_else(|| CliError::Usage(format!("{key}: expected YYYY-MM-DD, got '{trimmed}'"))),
        "relation" | "person" => Ok(PropertyValue::String(relation_value(trimmed))),
        "relations" => Ok(PropertyValue::List(
            split_list(trimmed, key)?
                .iter()
                .map(|item| relation_value(item))
                .collect(),
        )),
        "multiselect" | "files" => {
            let items = split_list(trimmed, key)?;
            warn_unknown_options(property, key, &items);
            Ok(PropertyValue::List(items))
        }
        "select" | "status" => {
            warn_unknown_options(property, key, std::slice::from_ref(&trimmed.to_string()));
            Ok(PropertyValue::String(trimmed.to_string()))
        }
        "updated" | "rollup" | "reverse" | "formula" => Err(CliError::Usage(format!(
            "{key}: a {} property is computed by Kore and cannot be set",
            property.kind
        ))),
        "text" | "url" | "email" | "phone" => Ok(PropertyValue::String(trimmed.to_string())),
        // A type this CLI does not know (a newer app schema): text is the
        // only honest write, and the app shows a mismatch tint if it is not.
        other => {
            warn(format!(
                "{key}: unknown property type '{other}' — written as text"
            ));
            Ok(PropertyValue::String(trimmed.to_string()))
        }
    }
}

/// Parse `key=value` arguments into typed patch entries against `schema`.
pub fn parse_assignments(
    schema: &TagSchema,
    assignments: &[String],
) -> Result<Vec<(String, PropertyValue)>, CliError> {
    let mut parsed = Vec::with_capacity(assignments.len());
    for assignment in assignments {
        let Some((key, raw)) = assignment.split_once('=') else {
            return Err(CliError::Usage(format!(
                "expected key=value, got '{assignment}'"
            )));
        };
        let key = key.trim();
        if !is_property_key(key) {
            return Err(CliError::Usage(format!(
                "'{key}' is not a writable property key (letters, digits, - and _; the app's own keys are reserved)"
            )));
        }
        let value = coerce(schema.property(key), key, raw)?;
        parsed.push((key.to_string(), value));
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(keys: &[&str], parents: &[&str]) -> TagSchema {
        TagSchema {
            properties: keys.iter().map(|key| property(key, "text")).collect(),
            template: None,
            extends: parents.iter().map(|parent| (*parent).to_string()).collect(),
        }
    }

    fn keys_of(schema: &TagSchema) -> Vec<&str> {
        schema
            .properties
            .iter()
            .map(|property| property.key.as_str())
            .collect()
    }

    #[test]
    fn inherited_fields_come_first_and_loops_are_cut() {
        let schemas = HashMap::from([
            ("contact".to_string(), typed(&["email", "status"], &[])),
            (
                "client".to_string(),
                typed(&["contract", "status"], &["contact"]),
            ),
            ("a".to_string(), typed(&["a"], &["b"])),
            ("b".to_string(), typed(&["b"], &["a"])),
        ]);
        let client = resolve_schema(&schemas, "client", &mut Vec::new()).unwrap();
        assert_eq!(keys_of(&client), ["email", "status", "contract"]);
        let a = resolve_schema(&schemas, "a", &mut Vec::new()).unwrap();
        assert_eq!(keys_of(&a), ["b", "a"]);
        assert_eq!(tag_descendants(&schemas, "contact"), ["client"]);
        assert_eq!(tag_descendants(&schemas, "a"), ["b"]);
    }

    #[test]
    fn extends_is_decoded_folded() {
        let schema = decode_schema(r#"{"properties":[],"extends":["Contact"]}"#);
        assert_eq!(schema.extends, ["contact"]);
    }

    fn property(key: &str, kind: &str) -> SchemaProperty {
        SchemaProperty {
            name: key.to_string(),
            key: key.to_string(),
            kind: kind.to_string(),
            options: None,
        }
    }

    #[test]
    fn coerces_by_declared_type() {
        assert_eq!(
            coerce(Some(&property("rating", "number")), "rating", " 4.5 ").unwrap(),
            PropertyValue::Number(4.5)
        );
        assert_eq!(
            coerce(Some(&property("stars", "rating")), "stars", "3").unwrap(),
            PropertyValue::Number(3.0)
        );
        assert!(coerce(Some(&property("stars", "rating")), "stars", "6").is_err());
        assert_eq!(
            coerce(Some(&property("read", "checkbox")), "read", "yes").unwrap(),
            PropertyValue::Bool(true)
        );
        assert!(coerce(Some(&property("on", "date")), "on", "2026-02-31").is_err());
        assert_eq!(
            coerce(Some(&property("author", "relation")), "author", "Le Guin").unwrap(),
            PropertyValue::String("[[Le Guin]]".into())
        );
        assert_eq!(
            coerce(
                Some(&property("people", "relations")),
                "people",
                "Ann, [[Bob]]"
            )
            .unwrap(),
            PropertyValue::List(vec!["[[Ann]]".into(), "[[Bob]]".into()])
        );
        assert_eq!(
            coerce(Some(&property("genres", "multiselect")), "genres", "a,,b").unwrap(),
            PropertyValue::List(vec!["a".into(), "b".into()])
        );
        assert!(coerce(Some(&property("total", "rollup")), "total", "1").is_err());
        assert_eq!(
            coerce(None, "anything", "4").unwrap(),
            PropertyValue::String("4".into())
        );
        assert!(coerce(None, "anything", "  ").is_err());
    }

    #[test]
    fn property_keys_exclude_reserved_and_malformed_names() {
        assert!(is_property_key("author"));
        assert!(is_property_key("read-on"));
        assert!(!is_property_key("id"));
        assert!(!is_property_key("private"));
        assert!(!is_property_key("-x"));
        assert!(!is_property_key("a b"));
        assert!(!is_property_key(""));
    }

    #[test]
    fn decodes_both_schema_shapes() {
        let bare = decode_schema(r#"[{"name":"A","key":"a","type":"text"}]"#);
        assert_eq!(bare.properties.len(), 1);
        assert!(bare.template.is_none());
        let object = decode_schema(
            r#"{"properties":[{"name":"A","key":"a","type":"created","target":"x"}],"template":"templates/book.md"}"#,
        );
        assert_eq!(object.template.as_deref(), Some("templates/book.md"));
        assert_eq!(object.created_stamps()[0].0, "a");
        assert!(decode_schema("nonsense").properties.is_empty());
    }
}
