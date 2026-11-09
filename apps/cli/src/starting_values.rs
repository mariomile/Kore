//! Starting values for schema fields (Plan 33 B4), for the notes `kore new`
//! and `kore tag` put into a tag: the same rule as the app's
//! `startingValues` (`packages/core/src/tags/starting-values.ts`), which
//! is the reference; the tests below pin the two together. `today` is the
//! local day, `now` the local day and minute, `next-number` one past the
//! highest number the tag's notes hold, anything else a fixed value. A
//! default the field's type can't hold is ignored.

use rusqlite::Connection;
use serde_json::Value;

use crate::error::CliError;
use crate::frontmatter_values::PropertyValue;
use crate::keys::fold_tag;
use crate::paths::today_date;
use crate::schema::{load_descendants, SchemaProperty, TagSchema};
use crate::search::{tag_match_sql, Binds};

/// Which kinds a field of `kind` takes (`startingValueKinds`).
fn allowed(kind: &str) -> &'static [&'static str] {
    match kind {
        "date" => &["today", "fixed"],
        "text" => &["today", "now", "fixed"],
        "number" => &["next-number", "fixed"],
        "rating" | "checkbox" | "select" | "multiselect" | "status" | "url" | "email" | "phone" => {
            &["fixed"]
        }
        _ => &[],
    }
}

fn kind_of(value: &Value) -> &'static str {
    match value.as_str() {
        Some("today") => "today",
        Some("now") => "now",
        Some("next-number") => "next-number",
        _ => "fixed",
    }
}

fn is_calendar_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

/// A fixed default as the value the field's type stores (`fixedValue`).
fn fixed_value(property: &SchemaProperty, value: &Value) -> Option<PropertyValue> {
    let options = property.options.as_deref().unwrap_or_default();
    match property.kind.as_str() {
        "number" | "rating" => match value {
            Value::Number(number) => number.as_f64().map(PropertyValue::Number),
            Value::String(text) if !text.trim().is_empty() => text
                .trim()
                .parse::<f64>()
                .ok()
                .filter(|n| n.is_finite())
                .map(PropertyValue::Number),
            _ => None,
        },
        "checkbox" => match value {
            Value::Bool(flag) => Some(PropertyValue::Bool(*flag)),
            Value::String(text) if text == "true" => Some(PropertyValue::Bool(true)),
            Value::String(text) if text == "false" => Some(PropertyValue::Bool(false)),
            _ => None,
        },
        "date" => value
            .as_str()
            .filter(|text| is_calendar_date(text))
            .map(|text| PropertyValue::String(text.to_string())),
        "select" | "status" => value
            .as_str()
            .filter(|text| options.iter().any(|option| option == text))
            .map(|text| PropertyValue::String(text.to_string())),
        "multiselect" => value
            .as_str()
            .filter(|text| options.iter().any(|option| option == text))
            .map(|text| PropertyValue::List(vec![text.to_string()])),
        "text" | "url" | "email" | "phone" => Some(PropertyValue::String(match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })),
        _ => None,
    }
}

/// The local day and minute a `now` value records (`localDateTime`).
fn now_text() -> String {
    let now = jiff::Zoned::now();
    format!("{} {:02}:{:02}", now.date(), now.hour(), now.minute())
}

/// The `next-number` fields of `schema` (`nextNumberKeys`).
fn next_number_keys(schema: &TagSchema) -> Vec<&str> {
    schema
        .properties
        .iter()
        .filter(|property| {
            property
                .default
                .as_ref()
                .is_some_and(|value| kind_of(value) == "next-number")
                && allowed(&property.kind).contains(&"next-number")
        })
        .map(|property| property.key.as_str())
        .collect()
}

/// One past the highest number the public notes of `tags` (and of the tags
/// that build on them) hold under `key`, or 1. Private notes are left out:
/// everything the CLI prints can reach an agent, and a number drawn from a
/// private note would say what it holds. The app counts them, so a CLI row
/// can draw a number a private note already has.
fn next_number(conn: &Connection, tags: &[String], key: &str) -> Result<f64, CliError> {
    let mut binds = Binds::default();
    let key_bind = binds.text(key);
    let mut members: Vec<String> = Vec::new();
    for tag in tags {
        members.push(fold_tag(tag));
        members.extend(load_descendants(conn, tag)?);
    }
    let clauses = members
        .iter()
        .map(|member| tag_match_sql("t.tag_key", member, &mut binds))
        .collect::<Vec<_>>()
        .join(" OR ");
    let query = format!(
        "SELECT max(p.value_number) FROM note_properties p
         JOIN notes n ON n.path = p.note_path AND n.is_private = 0
         WHERE p.key = {key_bind} AND p.value_number IS NOT NULL
           AND EXISTS (SELECT 1 FROM tags t WHERE t.note_path = p.note_path AND ({clauses}))"
    );
    let highest: Option<f64> =
        conn.query_row(&query, rusqlite::params_from_iter(binds.values), |row| {
            row.get(0)
        })?;
    Ok(highest.map_or(1.0, |top| top.floor() + 1.0))
}

/// Every value a note joining `tags` now starts with: the `created` stamps,
/// then each field's starting value (`startingValues`). `conn` is the
/// index, for `next-number`; without one those fields stay empty.
pub fn starting_values(
    schema: &TagSchema,
    conn: Option<&Connection>,
    tags: &[String],
) -> Result<Vec<(String, PropertyValue)>, CliError> {
    let mut values = schema.created_stamps();
    let mut numbers: Vec<(String, f64)> = Vec::new();
    if let Some(conn) = conn {
        for key in next_number_keys(schema) {
            numbers.push((key.to_string(), next_number(conn, tags, key)?));
        }
    }
    for property in &schema.properties {
        if values.iter().any(|(key, _)| *key == property.key) {
            continue;
        }
        let Some(declared) = &property.default else {
            continue;
        };
        let kind = kind_of(declared);
        if !allowed(&property.kind).contains(&kind) {
            continue;
        }
        let value = match kind {
            "today" => Some(PropertyValue::String(today_date())),
            "now" => Some(PropertyValue::String(now_text())),
            "next-number" => numbers
                .iter()
                .find(|(key, _)| *key == property.key)
                .map(|(_, number)| PropertyValue::Number(*number)),
            _ => fixed_value(property, declared),
        };
        if let Some(value) = value {
            values.push((property.key.clone(), value));
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn property(kind: &str, default: Value, options: Option<Vec<&str>>) -> SchemaProperty {
        SchemaProperty {
            name: "Field".into(),
            key: "field".into(),
            kind: kind.into(),
            options: options.map(|list| list.into_iter().map(String::from).collect()),
            default: Some(default),
        }
    }

    fn start(property: SchemaProperty) -> Option<PropertyValue> {
        let schema = TagSchema {
            properties: vec![property],
            template: None,
        };
        starting_values(&schema, None, &[])
            .unwrap()
            .into_iter()
            .next()
            .map(|(_, value)| value)
    }

    #[test]
    fn fixed_values_take_the_type_they_are_stored_as() {
        assert_eq!(
            start(property("number", json!("3"), None)),
            Some(PropertyValue::Number(3.0))
        );
        assert_eq!(
            start(property("checkbox", json!(false), None)),
            Some(PropertyValue::Bool(false))
        );
        assert_eq!(
            start(property("status", json!("Inbox"), Some(vec!["Inbox"]))),
            Some(PropertyValue::String("Inbox".into()))
        );
        assert_eq!(
            start(property("multiselect", json!("a"), Some(vec!["a"]))),
            Some(PropertyValue::List(vec!["a".into()]))
        );
    }

    #[test]
    fn a_default_the_type_cannot_hold_is_ignored() {
        assert_eq!(start(property("select", json!("b"), Some(vec!["a"]))), None);
        assert_eq!(start(property("date", json!("friday"), None)), None);
        assert_eq!(start(property("text", json!("next-number"), None)), None);
        assert_eq!(start(property("formula", json!("x"), None)), None);
    }

    #[test]
    fn today_and_now_are_local() {
        let Some(PropertyValue::String(day)) = start(property("date", json!("today"), None)) else {
            panic!("no day");
        };
        assert!(is_calendar_date(&day));
        let Some(PropertyValue::String(at)) = start(property("text", json!("now"), None)) else {
            panic!("no time");
        };
        assert_eq!(at.len(), 16);
        assert!(at.starts_with(&day[..4]));
    }
}
