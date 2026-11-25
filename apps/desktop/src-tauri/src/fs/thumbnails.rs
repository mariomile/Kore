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

/// A fresh thumbnail of `original` (of type `mime`), written to `cache_file`
/// for next time (the caller reads a cache hit itself, before reading the
/// original). A raster image is shrunk; a PDF shows its first page. None for
/// anything else, or when the original doesn't decode (a WebP or GIF without
/// a decoder here, a locked PDF): the caller decides what to serve instead.
pub(super) fn thumbnail(cache_file: &Path, mime: &str, original: &[u8]) -> Option<Vec<u8>> {
    let jpeg = if mime == "application/pdf" {
        let page = super::pdf_page::first_page(original, THUMBNAIL_LONG_EDGE)?;
        crate::raster::encode_jpeg(&image::DynamicImage::ImageRgb8(page)).ok()?
    } else {
        crate::raster::downscale_jpeg(original, THUMBNAIL_LONG_EDGE).ok()?
    };
    if let Some(dir) = cache_file.parent() {
        // A failed write only costs the next request a fresh thumbnail. Each
        // writer stages its own file: two cards asking for the same picture at
        // once must not interleave into one half-written JPEG.
        let staged = cache_file.with_extension(format!("{}.tmp", next_stage_id()));
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

/// A process-unique suffix for a staging file.
fn next_stage_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{}-{id}", std::process::id())
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

        let jpeg = thumbnail(&cache_file, "image/png", &std::fs::read(&image).unwrap()).unwrap();
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
    fn concurrent_writers_never_share_a_staging_file() {
        let dir = tempfile::tempdir().unwrap();
        let cache_file = dir.path().join("cache").join("a.jpg");
        let original = png(1200, 800);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| thumbnail(&cache_file, "image/png", &original).unwrap());
            }
        });
        let cached = image::load_from_memory(&std::fs::read(&cache_file).unwrap()).unwrap();
        assert_eq!((cached.width(), cached.height()), (960, 640));
        let leftovers = std::fs::read_dir(dir.path().join("cache")).unwrap().count();
        assert_eq!(leftovers, 1, "staging files left behind");
    }

    /// A one-page US Letter PDF with a black square in its top left corner.
    fn letter_pdf() -> Vec<u8> {
        let content = "0 0 0 rg 0 692 100 100 re f";
        format!(
            "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n\
             2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n\
             3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n\
             4 0 obj << /Length {} >> stream\n{content}\nendstream endobj\n\
             trailer << /Root 1 0 R >>\n%%EOF\n",
            content.len()
        )
        .into_bytes()
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    #[test]
    fn a_pdf_shows_its_first_page_from_the_top() {
        let dir = tempfile::tempdir().unwrap();
        let jpeg = thumbnail(
            &dir.path().join("deck.jpg"),
            "application/pdf",
            &letter_pdf(),
        )
        .unwrap();
        let page = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        assert_eq!((page.width(), page.height()), (742, 960));
        // The square sits top left; the rest of the page is white.
        assert!(page.get_pixel(20, 20).0.iter().all(|&channel| channel < 40));
        assert!(page
            .get_pixel(600, 800)
            .0
            .iter()
            .all(|&channel| channel > 215));
    }

    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    #[test]
    fn a_pdf_off_apple_keeps_its_icon() {
        let dir = tempfile::tempdir().unwrap();
        assert!(thumbnail(
            &dir.path().join("deck.jpg"),
            "application/pdf",
            &letter_pdf()
        )
        .is_none());
    }

    #[test]
    fn an_undecodable_original_is_left_to_the_caller() {
        let dir = tempfile::tempdir().unwrap();
        assert!(thumbnail(
            &dir.path().join("x.jpg"),
            "image/gif",
            b"GIF89a not decodable"
        )
        .is_none());
    }
}
