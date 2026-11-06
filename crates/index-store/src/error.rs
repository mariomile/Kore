//! The store's error: every failure is an I/O-shaped message the host maps
//! onto its own error type (the desktop's `AppError`, the CLI's host reply).

use std::fmt;

/// A failed index operation.
#[derive(Debug)]
pub enum StoreError {
    /// SQLite or bookkeeping failure.
    Io(String),
    /// A payload the store could not interpret.
    Parse(String),
}

/// Result alias for index store operations.
pub type StoreResult<T> = Result<T, StoreError>;

impl StoreError {
    /// An I/O-shaped failure with `message`.
    pub fn io(message: impl Into<String>) -> Self {
        Self::Io(message.into())
    }

    /// A payload-shape failure with `message`.
    pub fn parse(message: impl Into<String>) -> Self {
        Self::Parse(message.into())
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) | Self::Parse(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Io(err.to_string())
    }
}
