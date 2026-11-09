//! Starting values for schema fields (Plan 33 B4), for the notes `kore new`
//! and `kore tag` put into a tag. Core decides what a field's `default`
//! means (`startingValueOf`, `packages/core/src/tags/starting-values.ts`)
//! and stores the validated result on each property of the stored schema
//! as `start`; this module only turns it into a value: today, now, the next
//! number, or the fixed value as stored.

use rusqlite::Connection;
use serde::Deserialize;

use crate::error::CliError;
use crate::frontmatter_values::PropertyValue;
use crate::keys::fold_tag;
use crate::paths::today_date;
use crate::schema::{load_descendants, Descendants, TagSchema};
use crate::search::{tag_match_sql, Binds};

/// A stored starting value (`StartingValue` in core).
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Start {
    Today,
    Now,
    NextNumber,
    Fixed { value: Fixed },
}

/// A fixed value in the form the field's type stores it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Fixed {
    Bool(bool),
    Number(f64),
    Text(String),
    List(Vec<String>),
}

impl From<&Fixed> for PropertyValue {
    fn from(fixed: &Fixed) -> Self {
        match fixed {
            Fixed::Bool(flag) => PropertyValue::Bool(*flag),
            Fixed::Number(number) => PropertyValue::Number(*number),
            Fixed::Text(text) => PropertyValue::String(text.clone()),
            Fixed::List(items) => PropertyValue::List(items.clone()),
        }
    }
}

/// The local day and minute a `now` value records (`localDateTime`).
fn now_text() -> String {
    let now = jiff::Zoned::now();
    format!("{} {:02}:{:02}", now.date(), now.hour(), now.minute())
}

/// One past the highest number any note of `tags` (and of the tags that
/// build on them, private definitions included) holds under `key`, or 1, as `nextNumbers` counts it:
/// private notes included, so a number is never handed out twice (Mario,
/// 2026-11-09). Only the number leaves the index, never a note's content.
fn next_number(conn: &Connection, tags: &[String], key: &str) -> Result<f64, CliError> {
    let mut binds = Binds::default();
    let key_bind = binds.text(key);
    let mut members: Vec<String> = Vec::new();
    for tag in tags {
        members.push(fold_tag(tag));
        members.extend(load_descendants(conn, tag, Descendants::All)?);
    }
    let clauses = members
        .iter()
        .map(|member| tag_match_sql("t.tag_key", member, &mut binds))
        .collect::<Vec<_>>()
        .join(" OR ");
    let query = format!(
        "SELECT max(p.value_number) FROM note_properties p
         WHERE p.key = {key_bind} AND p.value_number IS NOT NULL
           AND EXISTS (SELECT 1 FROM tags t WHERE t.note_path = p.note_path AND ({clauses}))"
    );
    let highest: Option<f64> =
        conn.query_row(&query, rusqlite::params_from_iter(binds.values), |row| {
            row.get(0)
        })?;
    Ok(highest.map_or(1.0, |top| top.floor() + 1.0))
}

/// Every value a note joining `tags` now starts with (`startingValues`),
/// `created` stamps included: core stores those as `today` like any other
/// starting value. `conn` is the index, for `next-number`; without one
/// those fields stay empty.
pub fn starting_values(
    schema: &TagSchema,
    conn: Option<&Connection>,
    tags: &[String],
) -> Result<Vec<(String, PropertyValue)>, CliError> {
    let mut values = Vec::new();
    for property in &schema.properties {
        let value = match &property.start {
            None => None,
            Some(Start::Today) => Some(PropertyValue::String(today_date())),
            Some(Start::Now) => Some(PropertyValue::String(now_text())),
            Some(Start::NextNumber) => match conn {
                Some(conn) => Some(PropertyValue::Number(next_number(
                    conn,
                    tags,
                    &property.key,
                )?)),
                None => None,
            },
            Some(Start::Fixed { value }) => Some(PropertyValue::from(value)),
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
    use crate::schema::SchemaProperty;

    /// The stored shapes core writes (`withStoredStartingValues`).
    #[test]
    fn decodes_every_stored_start() {
        let decoded: Vec<Start> = serde_json::from_str(
            r#"[{"kind":"today"},{"kind":"now"},{"kind":"next-number"},
                {"kind":"fixed","value":3},{"kind":"fixed","value":false},
                {"kind":"fixed","value":"Draft"},{"kind":"fixed","value":["a"]}]"#,
        )
        .unwrap();
        assert_eq!(
            decoded,
            vec![
                Start::Today,
                Start::Now,
                Start::NextNumber,
                Start::Fixed {
                    value: Fixed::Number(3.0)
                },
                Start::Fixed {
                    value: Fixed::Bool(false)
                },
                Start::Fixed {
                    value: Fixed::Text("Draft".into())
                },
                Start::Fixed {
                    value: Fixed::List(vec!["a".into()])
                },
            ]
        );
    }

    #[test]
    fn materializes_today_now_and_fixed_values() {
        let field = |key: &str, start: Start| SchemaProperty {
            name: key.into(),
            key: key.into(),
            kind: "text".into(),
            options: None,
            start: Some(start),
        };
        let schema = TagSchema {
            properties: vec![
                field("day", Start::Today),
                field("at", Start::Now),
                field(
                    "status",
                    Start::Fixed {
                        value: Fixed::Text("Draft".into()),
                    },
                ),
                // No index: nothing to count, so no number.
                field("number", Start::NextNumber),
            ],
            template: None,
        };
        let values = starting_values(&schema, None, &[]).unwrap();
        let keys: Vec<&str> = values.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(keys, ["day", "at", "status"]);
        let PropertyValue::String(at) = &values[1].1 else {
            panic!("no time");
        };
        assert_eq!(at.len(), 16);
        assert_eq!(values[2].1, PropertyValue::String("Draft".into()));
    }
}
