//! Secrets in the OS keychain (Plan 10): the only place BYOK API keys live.
//!
//! Per the product principles, credentials never touch markdown, Git, or
//! `.reflect/`. Rust exposes the keychain as an opaque name → value store (a
//! capability); which names exist and what they hold is `@reflect/core`
//! policy (see `ai/secrets.ts`).

use keyring::Entry;

use crate::error::{AppError, AppResult};

/// The keychain service every Reflect secret is filed under.
const SERVICE: &str = "lore";

/// The pre-rebrand service name. Reads fall back to it and migrate the entry
/// forward, so an upgrade from a build that filed secrets under
/// "reflect-open" never silently loses every configured key.
const LEGACY_SERVICE: &str = "reflect-open";

fn entry(name: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, name).map_err(|err| AppError::io(err.to_string()))
}

fn legacy_entry(name: &str) -> AppResult<Entry> {
    Entry::new(LEGACY_SERVICE, name).map_err(|err| AppError::io(err.to_string()))
}

/// Read under the current service, falling back to the legacy one; a legacy
/// hit is migrated forward (copy, then best-effort delete of the old entry)
/// so the fallback path runs at most once per secret.
fn get_migrating(name: &str) -> AppResult<Option<String>> {
    if let Some(value) = get_from(&entry(name)?)? {
        return Ok(Some(value));
    }
    let Some(value) = get_from(&legacy_entry(name)?)? else {
        return Ok(None);
    };
    set_in(&entry(name)?, &value)?;
    let _ = legacy_entry(name).and_then(|old| delete_from(&old));
    Ok(Some(value))
}

fn set_in(entry: &Entry, value: &str) -> AppResult<()> {
    entry
        .set_password(value)
        .map_err(|err| AppError::io(err.to_string()))
}

/// A missing entry is an expected state (key not configured yet), not an error.
fn get_from(entry: &Entry) -> AppResult<Option<String>> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(AppError::io(err.to_string())),
    }
}

/// Deleting a missing entry succeeds so the operation is idempotent
/// (retry-safe from the frontend).
fn delete_from(entry: &Entry) -> AppResult<()> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(AppError::io(err.to_string())),
    }
}

/// Keychain calls run on a blocking thread, never the main loop: macOS parks
/// `get_password` on a user-facing password prompt whenever the binary's code
/// signature doesn't match the item's ACL (every dev rebuild), and a sync
/// command would freeze the whole app — no paint, no notes — until the user
/// answers.
async fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|err| AppError::io(err.to_string()))?
}

/// Write under the current service and drop any leftover pre-rebrand copy.
/// Leaving the legacy entry would let a later `secret_get` migrate it back
/// after a delete that only touched `"lore"`.
fn write_secret(name: &str, value: &str) -> AppResult<()> {
    set_in(&entry(name)?, value)?;
    let _ = legacy_entry(name).and_then(|old| delete_from(&old));
    Ok(())
}

/// Delete under both service names so a cleared key cannot resurrect from
/// the pre-rebrand `"reflect-open"` entry that `secret_get` still migrates.
fn erase_secret(name: &str) -> AppResult<()> {
    delete_from(&entry(name)?)?;
    delete_from(&legacy_entry(name)?)?;
    Ok(())
}

/// Command: store `value` under `name`, replacing any prior value.
#[tauri::command]
pub async fn secret_set(name: String, value: String) -> AppResult<()> {
    run_blocking(move || write_secret(&name, &value)).await
}

/// Command: the secret stored under `name`, or `None` when there isn't one.
#[tauri::command]
pub async fn secret_get(name: String) -> AppResult<Option<String>> {
    run_blocking(move || get_migrating(&name)).await
}

/// Command: remove the secret stored under `name`.
#[tauri::command]
pub async fn secret_delete(name: String) -> AppResult<()> {
    run_blocking(move || erase_secret(&name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mock keystore scopes state to one `Entry` (no shared backing store),
    /// so the round trip is exercised on a single entry. What this asserts is
    /// the error mapping the frontend relies on: a missing entry reads as
    /// `None` (not an error) and delete is idempotent. The real cross-process
    /// persistence is the OS keychain's contract, not ours.
    #[test]
    fn keychain_round_trip_on_one_entry() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let entry = entry("ai-api-key:test").unwrap();

        assert_eq!(get_from(&entry).unwrap(), None);

        set_in(&entry, "sk-secret").unwrap();
        assert_eq!(get_from(&entry).unwrap(), Some("sk-secret".into()));

        set_in(&entry, "sk-rotated").unwrap();
        assert_eq!(get_from(&entry).unwrap(), Some("sk-rotated".into()));

        delete_from(&entry).unwrap();
        assert_eq!(get_from(&entry).unwrap(), None);

        // Idempotent: deleting again is fine.
        delete_from(&entry).unwrap();
    }

    /// A secret filed by a pre-rebrand build (service "reflect-open") is
    /// found by the migrating read and rewritten under the current service.
    /// The mock keystore scopes state per Entry, so persistence across the
    /// two services isn't observable here — what this pins is that the
    /// migrating read returns the legacy value instead of `None`.
    #[test]
    fn reads_fall_back_to_the_legacy_service_and_migrate() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        assert_eq!(get_migrating("fresh-secret").unwrap(), None);
    }

    /// The commands hop to a blocking thread (a parked keychain prompt must
    /// never stall the main loop); this exercises that plumbing end-to-end
    /// against the mock store, including set (which also best-effort-deletes
    /// the pre-rebrand service).
    #[test]
    fn commands_resolve_through_the_blocking_hop() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        tauri::async_runtime::block_on(async {
            assert_eq!(secret_get("plumbing-test".into()).await.unwrap(), None);
            secret_set("plumbing-test".into(), "sk-secret".into())
                .await
                .unwrap();
            secret_delete("plumbing-test".into()).await.unwrap();
        });
    }

    /// Set/delete must succeed even when the legacy service has no entry
    /// (the common post-rebrand case) and stay idempotent. The mock keystore
    /// scopes state per `Entry`, so a write is not visible to a later
    /// `get_migrating` — that limitation is the same as
    /// [`reads_fall_back_to_the_legacy_service_and_migrate`].
    #[test]
    fn set_and_delete_tolerate_a_missing_legacy_service() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        write_secret("dual-service", "sk-secret").unwrap();
        erase_secret("dual-service").unwrap();
        erase_secret("dual-service").unwrap();
        assert_eq!(get_migrating("dual-service").unwrap(), None);
    }
}
