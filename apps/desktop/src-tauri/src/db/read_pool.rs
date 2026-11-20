//! Fixed-size pool of read-only SQLite connections over WAL (`db_query` /
//! `db_query_batch`).
//!
//! Replacing a single mutex-guarded reader with a small checkout pool lets
//! concurrent UI queries (daily stream backlinks, semantic KNN batches, list
//! queries) execute in parallel across WAL snapshots while preserving the
//! strict per-generation isolation contract across graph switches:
//! - Opening a new graph bumps the pool's generation, clears idle connections,
//!   and wakes every waiter so superseded queries fail loudly instead of
//!   crossing graphs.
//! - Any in-flight query holding an older-generation connection finishes on its
//!   own connection and drops it on [`ReadLease`] drop instead of returning it
//!   to the new graph's pool.

use std::path::Path;
use std::sync::{Condvar, Mutex};

use kore_index_store::query;
use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Concurrent WAL read connections per open graph. Four covers parallel daily
/// stream, sidebar, and KNN reads without multiplying file descriptors or page
/// caches.
const READ_POOL_SIZE: usize = 4;

#[derive(Default)]
struct PoolState {
    generation: u64,
    idle: Vec<Connection>,
}

/// Thread-safe checkout pool of read-only connections scoped to one index
/// generation at a time.
#[derive(Default)]
pub(super) struct ReadPool {
    state: Mutex<PoolState>,
    available: Condvar,
}

/// Checked-out read connection returned to the pool on drop (or dropped if the
/// pool moved to a newer generation while the query ran).
pub(super) struct ReadLease<'a> {
    pool: &'a ReadPool,
    generation: u64,
    conn: Option<Connection>,
}

impl ReadLease<'_> {
    pub(super) fn conn(&self) -> &Connection {
        self.conn
            .as_ref()
            .expect("ReadLease always holds a connection until Drop")
    }
}

impl Drop for ReadLease<'_> {
    fn drop(&mut self) {
        let Some(conn) = self.conn.take() else {
            return;
        };
        if let Ok(mut state) = self.state_lock() {
            if state.generation == self.generation {
                state.idle.push(conn);
                self.pool.available.notify_one();
            }
            // Otherwise the graph switched while this query ran; dropping `conn`
            // here closes the stale handle cleanly.
        }
    }
}

impl ReadLease<'_> {
    fn state_lock(&self) -> Result<std::sync::MutexGuard<'_, PoolState>, ()> {
        self.pool.state.lock().map_err(|_| ())
    }
}

impl ReadPool {
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, PoolState>> {
        self.state.lock().map_err(|err| {
            tracing::error!(?err, "index read pool lock poisoned by an earlier panic");
            AppError::io("index read pool lock poisoned")
        })
    }

    /// Drop every idle connection, reset generation to 0, and wake every waiter
    /// (called before re-opening so a failing re-open can never strand waiters).
    pub(super) fn clear(&self) -> AppResult<()> {
        let mut state = self.lock()?;
        state.generation = 0;
        state.idle.clear();
        self.available.notify_all();
        Ok(())
    }

    /// Rebind the pool to `root` at `generation` with [`READ_POOL_SIZE`] fresh
    /// read-only WAL connections.
    pub(super) fn rebind(&self, root: &Path, generation: u64) -> AppResult<()> {
        let mut fresh = Vec::with_capacity(READ_POOL_SIZE);
        for _ in 0..READ_POOL_SIZE {
            fresh.push(query::open_read_connection(root)?);
        }
        self.rebind_connections(fresh, generation)
    }

    fn rebind_connections(&self, fresh: Vec<Connection>, generation: u64) -> AppResult<()> {
        let mut state = self.lock()?;
        state.generation = generation;
        state.idle = fresh;
        self.available.notify_all();
        Ok(())
    }

    /// Current generation bound to the pool (`0` before first open).
    pub(super) fn generation(&self) -> AppResult<u64> {
        Ok(self.lock()?.generation)
    }

    /// Check out a read connection pinned to `expected_generation`. Waits if
    /// all slots are busy; fails immediately if the pool moved to another
    /// generation or was cleared.
    pub(super) fn checkout(&self, expected_generation: u64) -> AppResult<ReadLease<'_>> {
        if expected_generation == 0 {
            return Err(AppError::no_graph());
        }
        let mut state = self.lock()?;
        loop {
            if state.generation != expected_generation {
                return Err(AppError::io("index reopened during query"));
            }
            if let Some(conn) = state.idle.pop() {
                return Ok(ReadLease {
                    pool: self,
                    generation: expected_generation,
                    conn: Some(conn),
                });
            }
            state = self.available.wait(state).map_err(|err| {
                tracing::error!(?err, "index read pool condvar wait poisoned");
                AppError::io("index read pool lock poisoned")
            })?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conns(count: usize) -> Vec<Connection> {
        (0..count)
            .map(|_| Connection::open_in_memory().expect("in-memory sqlite"))
            .collect()
    }

    #[test]
    fn supports_parallel_checkouts_and_returns_connections_on_drop() {
        let pool = ReadPool::default();
        pool.rebind_connections(mem_conns(READ_POOL_SIZE), 1)
            .expect("rebind");

        let leases: Vec<_> = (0..READ_POOL_SIZE)
            .map(|_| pool.checkout(1).expect("checkout"))
            .collect();
        for lease in &leases {
            let one: i64 = lease
                .conn()
                .query_row("SELECT 1", [], |row| row.get(0))
                .expect("select 1");
            assert_eq!(one, 1);
        }
        drop(leases);

        assert_eq!(pool.lock().expect("lock").idle.len(), READ_POOL_SIZE);
    }

    #[test]
    fn rebind_rejects_stale_generation_and_drops_superseded_leases() {
        let pool = ReadPool::default();
        pool.rebind_connections(mem_conns(2), 1).expect("rebind 1");
        let stale_lease = pool.checkout(1).expect("checkout 1");

        pool.rebind_connections(mem_conns(2), 2).expect("rebind 2");
        assert!(pool.checkout(1).is_err());

        // Dropping the old-generation lease must NOT push it into gen 2's pool.
        drop(stale_lease);
        assert_eq!(pool.lock().expect("lock").idle.len(), 2);
        assert_eq!(pool.generation().expect("gen"), 2);

        pool.clear().expect("clear");
        assert_eq!(pool.generation().expect("cleared gen"), 0);
        assert!(pool.checkout(2).is_err());
    }
}
