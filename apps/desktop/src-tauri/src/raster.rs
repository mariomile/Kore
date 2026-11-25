//! Raster image normalization shared by capture (persisted photos) and the
//! asset protocol's card thumbnails: decode under hard limits, shrink to a
//! long edge, re-encode as JPEG.

use std::io::Cursor;

use crate::error::{AppError, AppResult};

// Maximum decoded image width or height, in pixels.
const MAX_DIMENSION: u32 = 8192;
// Maximum memory the image decoder may allocate, in bytes.
const MAX_ALLOC: u64 = 128 * 1024 * 1024;

/// Decode, downscale to `max_dim` on the long edge, re-encode as JPEG. Pure —
/// the unit tests exercise this without Tauri state.
pub(crate) fn downscale_jpeg(bytes: &[u8], max_dim: u32) -> AppResult<Vec<u8>> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|err| AppError::parse(format!("image format is invalid: {err}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|err| AppError::parse(format!("image does not decode: {err}")))?;
    let resized = if decoded.width() > max_dim || decoded.height() > max_dim {
        decoded.resize(max_dim, max_dim, image::imageops::FilterType::CatmullRom)
    } else {
        decoded
    };
    encode_jpeg(&resized)
}

/// `image` as a JPEG at the quality every Kore-made JPEG uses.
pub(crate) fn encode_jpeg(image: &image::DynamicImage) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80);
    image
        .to_rgb8() // JPEG carries no alpha
        .write_with_encoder(encoder)
        .map_err(|err| AppError::io(format!("image re-encode failed: {err}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{downscale_jpeg, MAX_DIMENSION};
    use crate::error::AppError;

    #[test]
    fn downscale_caps_the_long_edge_and_reencodes_jpeg() {
        let wide = image::DynamicImage::new_rgb8(3200, 1000);
        let mut png = Vec::new();
        wide.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();

        let jpeg = downscale_jpeg(&png, 1600).unwrap();
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert_eq!(decoded.width(), 1600);
        assert_eq!(decoded.height(), 500);
    }

    #[test]
    fn downscale_leaves_small_images_unscaled() {
        let small = image::DynamicImage::new_rgb8(800, 600);
        let mut png = Vec::new();
        small
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let decoded = image::load_from_memory(&downscale_jpeg(&png, 1600).unwrap()).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (800, 600));
    }

    #[test]
    fn downscale_rejects_non_images() {
        assert!(matches!(
            downscale_jpeg(b"not an image", 1600),
            Err(AppError::Parse { .. })
        ));
    }

    #[test]
    fn downscale_rejects_images_over_the_dimension_limit() {
        let too_wide = image::DynamicImage::new_rgb8(MAX_DIMENSION.saturating_add(1), 1);
        let mut png = Vec::new();
        too_wide
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();

        assert!(matches!(
            downscale_jpeg(&png, 1600),
            Err(AppError::Parse { .. })
        ));
    }
}
