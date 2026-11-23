//! Card thumbnails for the `kore-asset://` protocol: a note card shows a
//! photo a few hundred points wide, and decoding the 12-megapixel original
//! for it costs tens of megabytes of memory per card and stalls scrolling.
//! A request carrying `kore-thumb` gets a JPEG no longer than
//! [`THUMBNAIL_LONG_EDGE`] on either side instead, made once and kept in the
//! app's cache directory (per device, outside the vault: nothing to sync and
//! nothing Obsidian or an agent would see). The cache key folds in the
//! file's path, size and modification time, so an edited image gets a fresh
//! thumbnail and a stale one is simply never asked for again.

use std::path::{Path, PathBuf};

use super::asset_identity::sha256_hex;

/// Long edge of a card thumbnail, in pixels: a card at most ~420 points wide
/// on a 2x screen, with room for a portrait crop.
pub(super) const THUMBNAIL_LONG_EDGE: u32 = 960;

/// The cache file for one version of one image, or None when the file can't
/// be stat'ed (the caller then serves the original, which reports the error).
pub(super) fn cache_path(cache_dir: &Path, image: &Path) -> Option<PathBuf> {
    let meta = std::fs::metadata(image).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let key = format!(
        "{}\n{}\n{modified}\n{THUMBNAIL_LONG_EDGE}",
        image.to_string_lossy(),
        meta.len()
    );
    Some(cache_dir.join(format!("{}.jpg", &sha256_hex(key.as_bytes())[..32])))
}

/// A fresh thumbnail of `original`, written to `cache_file` for next time
/// (the caller reads a cache hit itself, before reading the original). None
/// when the original doesn't decode (a WebP or GIF without a decoder here):
/// the caller serves the original bytes as they are.
pub(super) fn thumbnail(cache_file: &Path, original: &[u8]) -> Option<Vec<u8>> {
    let jpeg = crate::raster::downscale_jpeg(original, THUMBNAIL_LONG_EDGE).ok()?;
    if let Some(dir) = cache_file.parent() {
        // A failed write only costs the next request a fresh downscale.
        let staged = cache_file.with_extension("tmp");
        let written = std::fs::create_dir_all(dir)
            .and_then(|()| std::fs::write(&staged, &jpeg))
            .and_then(|()| std::fs::rename(&staged, cache_file));
        if let Err(err) = written {
            tracing::debug!(%err, "thumbnail cache write failed");
            let _ = std::fs::remove_file(&staged);
        }
    }
    Some(jpeg)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(width, height)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        bytes
    }

    #[test]
    fn shrinks_the_long_edge_and_keeps_the_result() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("photo.png");
        std::fs::write(&image, png(3000, 2000)).unwrap();
        let cache_file = cache_path(&dir.path().join("cache"), &image).unwrap();

        let jpeg = thumbnail(&cache_file, &std::fs::read(&image).unwrap()).unwrap();
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (960, 640));
        assert_eq!(std::fs::read(&cache_file).unwrap(), jpeg);
    }

    #[test]
    fn a_changed_image_gets_a_new_cache_key() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("photo.png");
        std::fs::write(&image, png(10, 10)).unwrap();
        let before = cache_path(dir.path(), &image).unwrap();
        std::fs::write(&image, png(20, 10)).unwrap();
        assert_ne!(cache_path(dir.path(), &image).unwrap(), before);
    }

    #[test]
    fn an_undecodable_original_is_left_to_the_caller() {
        let dir = tempfile::tempdir().unwrap();
        assert!(thumbnail(&dir.path().join("x.jpg"), b"GIF89a not decodable").is_none());
    }
}
