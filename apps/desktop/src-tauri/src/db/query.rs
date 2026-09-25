//! The read-only query bridge: executes SQL the frontend compiled with Kysely.
//!
//! Parameters are bound (never interpolated) and any mutating statement is
//! rejected via `Statement::readonly`, so this surface can read the projection
//! but never write it — writes go through the transactional path in
//! [`super::write`].

use std::path::Path;

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};

/// Authorize only pure reads of our own projection. `Statement::readonly()`
/// (checked in [`run_query`]) already rejects writes, but SQLite still considers
/// `ATTACH`/`DETACH` and connection-state `PRAGMA`s "read only" even though none
/// of them read our tables:
///
/// - an `ATTACH DATABASE '<path>'` would let a caller open and then `SELECT`
///   from an **arbitrary SQLite file elsewhere on disk** — turning the read
///   bridge into a file-exfiltration primitive;
/// - a `PRAGMA foreign_keys = OFF` would quietly disable the `ON DELETE CASCADE`
///   relationships the write path's `apply_note`/`remove_note` rely on.
///
/// Both are denied at prepare time. Everything else a read needs — `SELECT`,
/// table/column reads, function calls, FTS5/vec0 `MATCH` — is allowed.
///
/// The one PRAGMA allowed is reading `data_version`: FTS5 prepares
/// `PRAGMA main.data_version` internally while answering a `MATCH`, and the
/// authorizer vets that statement too. It returns a change counter and sets
/// nothing.
fn read_only_authorization(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Pragma {
            pragma_name,
            pragma_value: None,
        } if pragma_name.eq_ignore_ascii_case("data_version") => Authorization::Allow,
        AuthAction::Attach { .. } | AuthAction::Detach { .. } | AuthAction::Pragma { .. } => {
            Authorization::Deny
        }
        _ => Authorization::Allow,
    }
}

/// Open the read bridge's connection: the index read-only, guarded by
/// [`read_only_authorization`] for its whole life. Installing the authorizer
/// once matters: `sqlite3_set_authorizer` expires every prepared statement, so
/// toggling it around each query made SQLite parse every read twice. This
/// connection serves only [`run_query`]; writes (and their
/// `PRAGMA defer_foreign_keys`) use the writer connection.
pub(super) fn open_read_connection(root: &Path) -> AppResult<Connection> {
    let conn = super::migrations::open_index_read_only_at(root)?;
    conn.authorizer(Some(read_only_authorization))?;
    Ok(conn)
}

fn json_to_sql(value: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sql;
    match value {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(Sql::Integer)
            .or_else(|| n.as_f64().map(Sql::Real))
            .unwrap_or(Sql::Null),
        Value::String(s) => Sql::Text(s.clone()),
        // arrays/objects arrive only from the `json()` helper → store as JSON text
        other => Sql::Text(other.to_string()),
    }
}

fn column_to_json(row: &rusqlite::Row, index: usize) -> AppResult<Value> {
    use rusqlite::types::ValueRef;
    Ok(match row.get_ref(index)? {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(bytes) => Value::from(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => Value::from(bytes.to_vec()),
    })
}

/// Execute a read query the frontend compiled with Kysely; rows as JSON objects.
pub(super) fn run_query(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> AppResult<Vec<Map<String, Value>>> {
    // This bridge is reachable from the (untrusted) webview, so it must run only
    // reads of our projection. On the read connection ([`open_read_connection`])
    // the authorizer rejects ATTACH/DETACH/PRAGMA with `SQLITE_AUTH`, here at
    // prepare or, for table-valued pragmas like `pragma_database_list()`, at
    // the first step.
    let mut stmt = conn.prepare(sql)?;
    // `Statement::readonly()` rejects any remaining mutating statement so a
    // compromised/buggy caller can't write through the read bridge.
    if !stmt.readonly() {
        return Err(AppError::io("db_query only executes read-only statements"));
    }
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let bound: Vec<rusqlite::types::Value> = params.iter().map(json_to_sql).collect();
    let mut rows = stmt.query(params_from_iter(bound))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::with_capacity(columns.len());
        for (index, name) in columns.iter().enumerate() {
            object.insert(name.clone(), column_to_json(row, index)?);
        }
        out.push(object);
    }
    Ok(out)
}
