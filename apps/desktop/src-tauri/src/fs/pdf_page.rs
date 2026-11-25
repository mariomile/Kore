//! A PDF's first page as a picture, for its card on a folder page: drawn by
//! Core Graphics, the renderer Preview and Quick Look use, on macOS and iOS
//! alike. Nothing else of the document runs: no scripts, forms, or links.

/// The first page of `pdf`, white behind it, `long_edge` pixels on its
/// longer side. None for a document Core Graphics can't open, a locked one,
/// or one without pages; the card then keeps its icon.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(super) fn first_page(pdf: &[u8], long_edge: u32) -> Option<image::RgbImage> {
    use objc2_core_foundation::{CFData, CGFloat, CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        CGBitmapContextCreate, CGColorSpace, CGContext, CGDataProvider, CGImageAlphaInfo,
        CGInterpolationQuality, CGPDFBox, CGPDFDocument, CGPDFPage,
    };

    let data = CFData::from_bytes(pdf);
    let provider = CGDataProvider::with_cf_data(Some(&data))?;
    let document = CGPDFDocument::with_provider(Some(&provider))?;
    if !CGPDFDocument::is_unlocked(Some(&document)) {
        return None;
    }
    let page = CGPDFDocument::page(Some(&document), 1)?;
    let crop = CGPDFPage::box_rect(Some(&page), CGPDFBox::CropBox).size;
    // A page turned a quarter shows its box on its side.
    let turned = CGPDFPage::rotation_angle(Some(&page)).rem_euclid(180) == 90;
    let (width, height) = if turned {
        (crop.height, crop.width)
    } else {
        (crop.width, crop.height)
    };
    if !(width > 0.0 && height > 0.0) {
        return None;
    }
    let scale = CGFloat::from(long_edge) / width.max(height);
    let pixels_wide = (width * scale).round().max(1.0) as usize;
    let pixels_high = (height * scale).round().max(1.0) as usize;
    let mut pixels = vec![0_u8; pixels_wide * pixels_high * 4];
    let space = CGColorSpace::new_device_rgb()?;
    // SAFETY: `pixels` holds `pixels_high` rows of `pixels_wide * 4` bytes
    // and outlives `context`, which is dropped below before it is read.
    let context = unsafe {
        CGBitmapContextCreate(
            pixels.as_mut_ptr().cast(),
            pixels_wide,
            pixels_high,
            8,
            pixels_wide * 4,
            Some(&space),
            CGImageAlphaInfo::NoneSkipLast.0,
        )
    }?;
    let canvas = CGRect::new(
        CGPoint::ZERO,
        CGSize::new(pixels_wide as CGFloat, pixels_high as CGFloat),
    );
    CGContext::set_rgb_fill_color(Some(&context), 1.0, 1.0, 1.0, 1.0);
    CGContext::fill_rect(Some(&context), canvas);
    CGContext::set_interpolation_quality(Some(&context), CGInterpolationQuality::High);
    // The page's own transform only turns and places it (the rect is the
    // page's size, so it never scales); the scale draws it at card size.
    CGContext::scale_ctm(Some(&context), scale, scale);
    let page_rect = CGRect::new(CGPoint::ZERO, CGSize::new(width, height));
    CGContext::concat_ctm(
        Some(&context),
        CGPDFPage::drawing_transform(Some(&page), CGPDFBox::CropBox, page_rect, 0, true),
    );
    CGContext::draw_pdf_page(Some(&context), Some(&page));
    drop(context);

    // A bitmap context's memory runs top row first, as `image` expects.
    let rgb = pixels
        .chunks_exact(4)
        .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    image::RgbImage::from_raw(pixels_wide as u32, pixels_high as u32, rgb)
}

/// Core Graphics is Apple's: elsewhere a PDF card keeps its icon.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub(super) fn first_page(_pdf: &[u8], _long_edge: u32) -> Option<image::RgbImage> {
    None
}
