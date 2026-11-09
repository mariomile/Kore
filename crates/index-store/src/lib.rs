//! Row-level access to `<graph>/.kore/index.sqlite` (Plan 04): the write
//! path that applies TS-built note projections, the reconcile scan, the
//! embedding-table writes, and the read-only query bridge.
//!
//! Plain functions over a [`rusqlite::Connection`]. Hosts own the connection,
//! its transactions and the generation gate: the desktop app's Tauri command
//! layer (`apps/desktop/src-tauri/src/db/`) and the CLI's headless indexer
//! (`kore index`) both drive this crate, so the two can never write a
//! different projection.

pub mod embed_write;
pub mod error;
pub mod query;
pub mod scan;
pub mod write;

pub use error::{StoreError, StoreResult};
pub use scan::FileMeta;
