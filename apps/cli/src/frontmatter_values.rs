//! Generic frontmatter values — the Rust mirror of `extractNoteProperties`
//! (`packages/core/src/tags/properties.ts`): every non-reserved scalar (or
//! list-of-scalars) key of a note's frontmatter, typed the way the desktop's
//! `note_properties` projection stores it. Objects, nested lists, nulls, and
//! non-finite numbers are skipped, never errors. `reflect properties` reads
//! through this; `reflect set` verifies its own write through it.

use saphyr::{LoadableYamlNode, Scalar, Yaml};
use serde::ser::{SerializeSeq, Serializer};
use serde::Serialize;

/// The app's own frontmatter keys — never properties, never writable through
/// `set` (`RESERVED_FRONTMATTER_KEYS`, `packages/core/src/tags/tag-type.ts`).
pub const RESERVED_KEYS: [&str; 12] = [
    "id",
    "title",
    "aliases",
    "private",
    "pinned",
    "gist",
    "ignoredContacts",
    "lore",
    "properties",
    "template",
    "cover",
    "icon",
];

pub fn is_reserved_key(key: &str) -> bool {
    RESERVED_KEYS.contains(&key)
}

/// One property value as the index would type it.
#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    String(String),
    Number(f64),
    Bool(bool),
    List(Vec<String>),
}

/// The one JSON form of a property value, shared by every `--json` shape:
/// integral numbers print as integers (`4`, never `4.0`), lists as arrays.
impl Serialize for PropertyValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            PropertyValue::String(text) => serializer.serialize_str(text),
            PropertyValue::Number(number) if is_integral(*number) => {
                serializer.serialize_i64(*number as i64)
            }
            PropertyValue::Number(number) => serializer.serialize_f64(*number),
            PropertyValue::Bool(flag) => serializer.serialize_bool(*flag),
            PropertyValue::List(items) => {
                let mut sequence = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    sequence.serialize_element(item)?;
                }
                sequence.end()
            }
        }
    }
}

impl PropertyValue {
    /// Decode a stored `note_properties` row, mirroring `propertyRowValue`
    /// (`packages/core/src/indexing/collections.ts`): a mangled number or
    /// list falls back to its string form rather than failing the row.
    pub fn from_row(value: &str, value_type: &str, value_number: Option<f64>) -> PropertyValue {
        match value_type {
            "number" => value_number
                .filter(|number| number.is_finite())
                .map(PropertyValue::Number)
                .unwrap_or_else(|| PropertyValue::String(value.to_string())),
            "boolean" => PropertyValue::Bool(value == "true"),
            "list" => serde_json::from_str::<Vec<String>>(value)
                .map(PropertyValue::List)
                .unwrap_or_else(|_| PropertyValue::String(value.to_string())),
            _ => PropertyValue::String(value.to_string()),
        }
    }

    /// The value as `serde_json::Value`, through the one serializer above.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// Properties keyed by name as a JSON object (the `properties` field of the
/// `--json` shapes).
pub fn properties_json<'a>(
    properties: impl IntoIterator<Item = (&'a String, &'a PropertyValue)>,
) -> serde_json::Map<String, serde_json::Value> {
    properties
        .into_iter()
        .map(|(key, value)| (key.clone(), value.to_json()))
        .collect()
}

fn is_integral(value: f64) -> bool {
    value.fract() == 0.0 && value.abs() < 1e15
}

/// The top-level mapping of a frontmatter block, or `None` when the YAML is
/// malformed or not a mapping (the tolerant read: such a note simply has no
/// properties).
pub fn parse_mapping(raw: &str) -> Option<saphyr::Mapping<'_>> {
    if raw.trim().is_empty() {
        return Some(saphyr::Mapping::new());
    }
    let documents = Yaml::load_from_str(raw).ok()?;
    match documents.into_iter().next()? {
        Yaml::Mapping(mapping) => Some(mapping),
        _ => None,
    }
}

/// A YAML scalar as the JS `String(value)` the indexer stores for list
/// entries (and the text of a scalar mapping key); `None` for anything that
/// isn't a finite scalar.
fn scalar_text(node: &Yaml) -> Option<String> {
    match node {
        Yaml::Value(Scalar::String(text)) => Some(text.to_string()),
        Yaml::Value(Scalar::Integer(number)) => Some(number.to_string()),
        Yaml::Value(Scalar::FloatingPoint(number)) => {
            let value = number.into_inner();
            value.is_finite().then(|| format_number(value))
        }
        Yaml::Value(Scalar::Boolean(flag)) => Some(flag.to_string()),
        _ => None,
    }
}

/// JS `String(number)`: integral floats print without a fraction.
pub fn format_number(value: f64) -> String {
    if is_integral(value) {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

/// Type one frontmatter node as a property value, or `None` to skip it.
pub fn property_value(node: &Yaml) -> Option<PropertyValue> {
    match node {
        Yaml::Value(Scalar::String(text)) => Some(PropertyValue::String(text.to_string())),
        Yaml::Value(Scalar::Integer(number)) => Some(PropertyValue::Number(*number as f64)),
        Yaml::Value(Scalar::FloatingPoint(number)) => {
            let value = number.into_inner();
            value.is_finite().then_some(PropertyValue::Number(value))
        }
        Yaml::Value(Scalar::Boolean(flag)) => Some(PropertyValue::Bool(*flag)),
        Yaml::Sequence(items) if !items.is_empty() => items
            .iter()
            .map(scalar_text)
            .collect::<Option<Vec<String>>>()
            .map(PropertyValue::List),
        _ => None,
    }
}

/// The mapping's string keys in document order, paired with their nodes.
pub fn entries<'a>(mapping: &'a saphyr::Mapping<'a>) -> Vec<(String, &'a Yaml<'a>)> {
    mapping
        .iter()
        .filter_map(|(key, value)| Some((scalar_text(key)?, value)))
        .collect()
}

/// Every non-reserved property of a frontmatter block, in document order.
/// Malformed YAML yields no properties.
pub fn extract_properties(raw: Option<&str>) -> Vec<(String, PropertyValue)> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    let Some(mapping) = parse_mapping(raw) else {
        return Vec::new();
    };
    entries(&mapping)
        .into_iter()
        .filter(|(key, _)| !is_reserved_key(key))
        .filter_map(|(key, node)| property_value(node).map(|value| (key, value)))
        .collect()
}

/// The TS `isPinned`: a boolean `pinned: true` or a numeric pin order.
pub fn is_pinned(raw: Option<&str>) -> bool {
    let Some(mapping) = raw.and_then(parse_mapping) else {
        return false;
    };
    match mapping.get(&Yaml::Value(Scalar::String("pinned".into()))) {
        Some(Yaml::Value(Scalar::Boolean(flag))) => *flag,
        Some(Yaml::Value(Scalar::Integer(_))) | Some(Yaml::Value(Scalar::FloatingPoint(_))) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_scalars_and_scalar_lists_skipping_reserved_and_nested() {
        let raw = "id: abc\nauthor: Le Guin\nrating: 4.5\nyear: 1974\nread: true\n\
                   tags:\n  - a\n  - 2\nnested:\n  x: 1\nempty: []\nnothing: null\n";
        let properties = extract_properties(Some(raw));
        assert_eq!(
            properties,
            vec![
                (
                    "author".to_string(),
                    PropertyValue::String("Le Guin".into())
                ),
                ("rating".to_string(), PropertyValue::Number(4.5)),
                ("year".to_string(), PropertyValue::Number(1974.0)),
                ("read".to_string(), PropertyValue::Bool(true)),
                (
                    "tags".to_string(),
                    PropertyValue::List(vec!["a".into(), "2".into()])
                ),
            ]
        );
    }

    #[test]
    fn json_form_prints_integral_numbers_as_integers() {
        assert_eq!(PropertyValue::Number(4.0).to_json(), serde_json::json!(4));
        assert_eq!(PropertyValue::Number(4.5).to_json(), serde_json::json!(4.5));
        assert_eq!(
            PropertyValue::from_row("[\"a\",\"b\"]", "list", None).to_json(),
            serde_json::json!(["a", "b"])
        );
        assert_eq!(
            PropertyValue::from_row("4", "number", Some(4.0)),
            PropertyValue::Number(4.0)
        );
        assert_eq!(
            PropertyValue::from_row("oops", "list", None),
            PropertyValue::String("oops".into())
        );
    }

    #[test]
    fn malformed_yaml_has_no_properties() {
        assert!(extract_properties(Some("author: [unclosed\n")).is_empty());
        assert!(extract_properties(Some("- just\n- a list\n")).is_empty());
        assert!(extract_properties(None).is_empty());
    }

    #[test]
    fn pinned_reads_booleans_and_orders() {
        assert!(is_pinned(Some("pinned: true\n")));
        assert!(is_pinned(Some("pinned: 3\n")));
        assert!(!is_pinned(Some("pinned: false\n")));
        assert!(!is_pinned(Some("pinned: soon\n")));
        assert!(!is_pinned(None));
    }
}
