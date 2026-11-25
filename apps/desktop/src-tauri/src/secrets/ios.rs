//! iOS Keychain writes that never leave this iPhone.
//!
//! The `keyring` crate's iOS backend writes generic passwords with no
//! accessibility attribute, so the OS default (`WhenUnlocked`) applies and
//! the item travels inside encrypted device backups and onto a restored
//! device. Kore's keys are pinned to `WhenUnlockedThisDeviceOnly` instead:
//! readable only while this iPhone is unlocked, never in a backup, never on
//! another device. Reads and deletes still go through `keyring`: they match
//! on class + service + account, whatever the accessibility.

use std::ptr;

use core_foundation::base::{CFType, TCFType};
use core_foundation::data::CFData;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use security_framework_sys::access_control::kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
use security_framework_sys::base::{errSecItemNotFound, errSecSuccess};
use security_framework_sys::item::{
    kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecValueData,
};
use security_framework_sys::keychain_item::{SecItemAdd, SecItemUpdate};

use crate::error::{AppError, AppResult};

// security-framework-sys declares the accessibility values but not the
// attribute key itself.
#[link(name = "Security", kind = "framework")]
extern "C" {
    static kSecAttrAccessible: CFStringRef;
}

fn constant(value: CFStringRef) -> CFString {
    // SAFETY: Security framework constants are immortal CFStrings.
    unsafe { CFString::wrap_under_get_rule(value) }
}

fn item_query(service: &str, account: Option<&str>) -> Vec<(CFString, CFType)> {
    // SAFETY (all `constant` calls): reading `extern static` framework keys.
    let mut query = vec![
        (
            constant(unsafe { kSecClass }),
            constant(unsafe { kSecClassGenericPassword }).into_CFType(),
        ),
        (
            constant(unsafe { kSecAttrService }),
            CFString::new(service).into_CFType(),
        ),
    ];
    if let Some(account) = account {
        query.push((
            constant(unsafe { kSecAttrAccount }),
            CFString::new(account).into_CFType(),
        ));
    }
    query
}

fn this_device_only() -> (CFString, CFType) {
    (
        constant(unsafe { kSecAttrAccessible }),
        constant(unsafe { kSecAttrAccessibleWhenUnlockedThisDeviceOnly }).into_CFType(),
    )
}

fn check(status: i32) -> AppResult<()> {
    if status == errSecSuccess {
        Ok(())
    } else {
        Err(AppError::io(format!("keychain error {status}")))
    }
}

/// Store `value` under `service`/`account`, pinned to this device. An
/// existing item is updated in place (value and accessibility together), so
/// a key saved by an older build is re-protected the next time it is written.
pub(super) fn set_device_only(service: &str, account: &str, value: &str) -> AppResult<()> {
    let value_data = (
        constant(unsafe { kSecValueData }),
        CFData::from_buffer(value.as_bytes()).into_CFType(),
    );
    let query = CFDictionary::from_CFType_pairs(&item_query(service, Some(account)));
    let changes = CFDictionary::from_CFType_pairs(&[value_data.clone(), this_device_only()]);
    // SAFETY: both dictionaries outlive the call.
    let status =
        unsafe { SecItemUpdate(query.as_concrete_TypeRef(), changes.as_concrete_TypeRef()) };
    if status != errSecItemNotFound {
        return check(status);
    }
    let mut attributes = item_query(service, Some(account));
    attributes.push(value_data);
    attributes.push(this_device_only());
    let attributes = CFDictionary::from_CFType_pairs(&attributes);
    // SAFETY: the dictionary outlives the call; no result is requested.
    check(unsafe { SecItemAdd(attributes.as_concrete_TypeRef(), ptr::null_mut()) })
}

/// Re-protect every item already filed under `service` (keys saved before
/// this build, with the backup-eligible default). Nothing to update is fine.
pub(super) fn pin_service_to_device(service: &str) -> AppResult<()> {
    let query = CFDictionary::from_CFType_pairs(&item_query(service, None));
    let changes = CFDictionary::from_CFType_pairs(&[this_device_only()]);
    // SAFETY: both dictionaries outlive the call.
    let status =
        unsafe { SecItemUpdate(query.as_concrete_TypeRef(), changes.as_concrete_TypeRef()) };
    if status == errSecItemNotFound {
        return Ok(());
    }
    check(status)
}
