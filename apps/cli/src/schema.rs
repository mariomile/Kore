//! Tag schemas (TDR 0005) as the CLI reads and honours them: the
//! `tag_types.schema_json` decoding shared by `collection`, `set`, and
//! `new`, plus the typed coercion that turns an agent's `key=value` into the
//! frontmatter value the app's own editors would write
//! (`typedValueForText`, `apps/desktop/src/components/tags/property-editor-shared.tsx`,
//! and the per-type editors). View-only types are refused, never written.

use rusqlite::{params, Connection};

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

/// A decoded tag type: its properties and the bound new-row template path.
#[derive(Clone, Debug, Default)]
pub struct TagSchema {
    pub properties: Vec<SchemaProperty>,
    pub template: Option<String>,
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
    },
}

/// Decode a stored schema column. Tolerant like the app: a mangled column
/// reads as an empty schema.
pub fn decode_schema(schema_json: &str) -> TagSchema {
    match serde_json::from_str::<SchemaJson>(schema_json) {
        Ok(SchemaJson::Properties(properties)) => TagSchema {
            properties,
            template: None,
        },
        Ok(SchemaJson::Object {
            properties,
            template,
        }) => TagSchema {
            properties,
            template,
        },
        Err(_) => TagSchema::default(),
    }
}

/// The schema of one tag, or `None` when the tag has no type.
pub fn load_schema(conn: &Connection, tag: &str) -> Result<Option<TagSchema>, CliError> {
    let schema_json: Option<String> = conn
        .query_row(
            "SELECT schema_json FROM tag_types WHERE tag_key = ?1",
            params![fold_tag(tag)],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(schema_json.as_deref().map(decode_schema))
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
            if let Some(options) = &property.options {
                for item in &items {
                    if !options.contains(item) {
                        warn(format!(
                            "{key}: '{item}' is not one of the declared options"
                        ));
                    }
                }
            }
            Ok(PropertyValue::List(items))
        }
        "select" | "status" => {
            if let Some(options) = &property.options {
                if !options.iter().any(|option| option == trimmed) {
                    warn(format!(
                        "{key}: '{trimmed}' is not one of the declared options"
                    ));
                }
            }
            Ok(PropertyValue::String(trimmed.to_string()))
        }
        "updated" | "rollup" | "reverse" | "formula" => Err(CliError::Usage(format!(
            "{key}: a {} property is computed by Kore and cannot be set",
            property.kind
        ))),
        _ => Ok(PropertyValue::String(trimmed.to_string())),
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
