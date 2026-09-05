use std::io::Read;

use sha2::{Digest, Sha256};

use crate::error::AppResult;

/// Matches resource-collection.ts's bounded-chunk identity, including empty files.
/// Bytes stay in the native process; at most one 4 MiB chunk is held in memory.
pub(super) fn content_identity(mut reader: impl Read) -> AppResult<String> {
    let mut hashes = Vec::new();
    let mut size = 0_u64;
    loop {
        let mut chunk = Vec::new();
        reader
            .by_ref()
            .take(4 * 1024 * 1024)
            .read_to_end(&mut chunk)?;
        if chunk.is_empty() {
            break;
        }
        size += chunk.len() as u64;
        hashes.push(sha256_hex(&chunk));
    }
    Ok(sha256_hex(
        format!("{size}:{}", hashes.join(":")).as_bytes(),
    ))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut hex = String::with_capacity(64);
    for byte in Sha256::digest(bytes) {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::content_identity;

    #[test]
    fn identities_match_web_crypto_and_detect_changed_bytes() {
        assert_eq!(
            content_identity(&b""[..]).unwrap(),
            "ba768b331fd86cec803be04e56ab2b3d4c0e98ef4ee4fcd4e72ad7cce61a1d1f"
        );
        assert_eq!(
            content_identity(&b"data"[..]).unwrap(),
            "9301e03c30e2cf887e4db0290ad2a3938068ccde687bb32920fa12b5c0b4da24"
        );
        assert_eq!(
            content_identity(&vec![b'x'; 4 * 1024 * 1024 + 1][..]).unwrap(),
            "99871b04b27fe413fb95093181e9aef49af7e2d4628369d1f41ce21f31e95e34"
        );
        assert_ne!(
            content_identity(&b"data"[..]).unwrap(),
            content_identity(&b"edit"[..]).unwrap()
        );
    }
}
