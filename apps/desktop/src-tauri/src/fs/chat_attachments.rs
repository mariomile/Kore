//! Chat attachments (images, PDFs, text files) on disk.
//!
//! A sent image used to live as a base64 `data:` URL inside the persisted
//! turn row, which put the bytes on the webview heap for as long as the
//! conversation was open (see docs/memory-budget.md). The bytes now land in
//! `.kore/chat-attachments/<conversation-id>/<attachment-id>.<ext>` and
//! the row keeps only the graph-relative path; the webview renders the file
//! through the `reflect-asset://` protocol and reads it back (base64, for a
//! provider payload) only at send time.
//!
//! `.kore/` is the right home: excluded from sync, indexing, agent access
//! and Git like the chat database these files belong to, and deleted with
//! the graph. The path shape is closed — both id segments must be plain
//! `[A-Za-z0-9-]` tokens and the extension must be a known attachment type
//! (the asset-protocol carve-out narrows that to raster images, the only kind
//! the webview renders) — so neither the commands here nor the protocol
//! carve-out ever resolve a name a caller composed from anything but our own
//! generated ids.

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::fs::GraphState;

/// Graph-relative directory all chat attachments live under.
const CHAT_ATTACHMENTS_DIR: &str = ".kore/chat-attachments";

/// Raster image extensions — the only attachments the webview renders.
const RASTER_EXTENSIONS: [&str; 5] = ["jpeg", "jpg", "png", "webp", "gif"];

/// Document extensions the app writes beside images (see the media-type map
/// in `@reflect/core`'s attachment types).
const DOCUMENT_EXTENSIONS: [&str; 5] = ["pdf", "txt", "md", "csv", "json"];

fn is_allowed_extension(ext: &str) -> bool {
    RASTER_EXTENSIONS.contains(&ext) || DOCUMENT_EXTENSIONS.contains(&ext)
}

/// A plain id segment: what `crypto.randomUUID()` produces, nothing more.
fn is_id_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 64
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// `<attachment-id>.<ext>` with both halves from the closed sets above.
fn is_attachment_file_name(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) => is_id_segment(stem) && is_allowed_extension(ext),
        None => false,
    }
}

/// The file name of a graph-relative wire path shaped like a chat
/// attachment file, or None for anything else.
fn chat_attachment_file_name(rel: &str) -> Option<&str> {
    let mut parts = rel.split('/');
    match (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) {
        (Some(".kore"), Some("chat-attachments"), Some(conversation), Some(file), None)
            if is_id_segment(conversation) && is_attachment_file_name(file) =>
        {
            Some(file)
        }
        _ => None,
    }
}

/// Whether a graph-relative wire path is a chat attachment file (any kind) —
/// what [`chat_attachment_read`] accepts.
pub(super) fn is_chat_attachment_rel(rel: &str) -> bool {
    chat_attachment_file_name(rel).is_some()
}

/// Whether a graph-relative wire path is a chat attachment *image*. The asset
/// protocol calls this to carve these files out of its "no hidden
/// components" rule — exactly this shape, nothing else under `.kore/`.
pub(super) fn is_chat_attachment_image_rel(rel: &str) -> bool {
    chat_attachment_file_name(rel)
        .and_then(|file| file.rsplit_once('.'))
        .is_some_and(|(_, ext)| RASTER_EXTENSIONS.contains(&ext))
}

fn conversation_dir(root: &std::path::Path, conversation_id: &str) -> AppResult<PathBuf> {
    if !is_id_segment(conversation_id) {
        return Err(AppError::traversal(format!(
            "not a conversation id: {conversation_id}"
        )));
    }
    Ok(root.join(CHAT_ATTACHMENTS_DIR).join(conversation_id))
}

/// Write one attachment's bytes and return its graph-relative path. The
/// bytes arrive base64-encoded (images are pre-downscaled in the webview, so
/// one JSON invoke carries them comfortably); the write is atomic.
#[tauri::command]
pub async fn chat_attachment_write<R: tauri::Runtime>(
    conversation_id: String,
    file_name: String,
    bytes_base64: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<String> {
    if !is_attachment_file_name(&file_name) {
        return Err(AppError::traversal(format!(
            "not an attachment file name: {file_name}"
        )));
    }
    crate::blocking::run_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(bytes_base64)
            .map_err(|err| AppError::io(format!("attachment bytes are not base64: {err}")))?;
        let state = app.state::<GraphState>();
        let root = super::root_for_generation(&state, generation)?;
        let target = conversation_dir(&root, &conversation_id)?.join(&file_name);
        super::atomic_write_bytes(&root, &target, &bytes)?;
        Ok(format!(
            "{CHAT_ATTACHMENTS_DIR}/{conversation_id}/{file_name}"
        ))
    })
    .await
}

/// Read one attachment back, base64-encoded — the send path rebuilding a
/// provider payload for a restored turn. Only the closed path shape resolves.
#[tauri::command]
pub async fn chat_attachment_read<R: tauri::Runtime>(
    path: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<String> {
    if !is_chat_attachment_rel(&path) {
        return Err(AppError::traversal(format!(
            "not a chat attachment path: {path}"
        )));
    }
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = super::root_for_generation(&state, generation)?;
        let bytes = fs::read(super::resolve::resolve(&root, &path)?)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
}

/// Delete a conversation's attachment directory. Idempotent — deleting for a
/// conversation that never attached anything is fine.
#[tauri::command]
pub async fn chat_attachments_delete<R: tauri::Runtime>(
    conversation_id: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = super::root_for_generation(&state, generation)?;
        let dir = conversation_dir(&root, &conversation_id)?;
        match fs::remove_dir_all(&dir) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_exactly_the_generated_shape() {
        assert!(is_chat_attachment_rel(
            ".kore/chat-attachments/0b0e6a34-1111-4222-8333-444455556666/9f8e7d6c-1111-4222-8333-444455556666.jpeg"
        ));
        assert!(is_chat_attachment_rel(
            ".kore/chat-attachments/conv-1/att-2.png"
        ));
    }

    #[test]
    fn refuses_everything_else_under_reflect() {
        for rel in [
            ".kore/chat-attachments/conv/att.jpeg/extra",
            ".kore/chat-attachments/conv",
            ".kore/chat-attachments/../secrets/att.jpeg",
            ".kore/chat-attachments/conv/att.svg",
            ".kore/chat-attachments/conv/att",
            ".kore/chat-attachments/co nv/att.jpeg",
            ".kore/chat-attachments/conv/.jpeg",
            ".kore/tmp/att.jpeg",
            ".kore/index.db",
            "assets/photo.jpeg",
        ] {
            assert!(!is_chat_attachment_rel(rel), "{rel} must be refused");
        }
    }

    #[test]
    fn documents_are_attachments_but_not_renderable_images() {
        let pdf = ".kore/chat-attachments/conv-1/att-2.pdf";
        assert!(is_chat_attachment_rel(pdf));
        assert!(!is_chat_attachment_image_rel(pdf));
        assert!(is_chat_attachment_rel(
            ".kore/chat-attachments/conv-1/att-2.csv"
        ));
        assert!(is_chat_attachment_image_rel(
            ".kore/chat-attachments/conv-1/att-2.png"
        ));
    }

    #[test]
    fn conversation_dir_refuses_traversal_ids() {
        let root = std::path::Path::new("/g");
        assert!(conversation_dir(root, "../escape").is_err());
        assert!(conversation_dir(root, "a/b").is_err());
        assert!(conversation_dir(root, "").is_err());
        assert!(conversation_dir(root, "conv-1").is_ok());
    }
}
