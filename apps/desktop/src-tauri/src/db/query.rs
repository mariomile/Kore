//! The read-only query bridge: executes SQL the frontend compiled with Kysely.
//! The statement guard and row conversion live in `reflect_index_store::query`;
//! this module opens the desktop's guarded read connection.

use std::path::Path;

use rusqlite::Connection;

use crate::error::AppResult;

pub(super) use reflect_index_store::query::run_query;

/// Open the read bridge's connection: the index read-only, guarded for its
/// whole life by the store's read-only authorizer. This connection serves only
/// [`run_query`]; writes use the writer connection.
pub(super) fn open_read_connection(root: &Path) -> AppResult<Connection> {
    let conn = super::migrations::open_index_read_only_at(root)?;
    reflect_index_store::query::guard_read_connection(&conn)?;
    Ok(conn)
}
