use serde::{Deserialize, Serialize};

/// Options for `start_recording`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    /// Auto-stop cap in milliseconds; the native recorder enforces it even if
    /// the webview never wakes to ask for a stop.
    pub max_duration_ms: f64,
}

/// A finished recording, still in the plugin's staging directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopResponse {
    /// Absolute path of the staged `.m4a`.
    pub path: String,
    /// Recorded length in milliseconds.
    pub duration_ms: f64,
    /// The staged file's modification time in epoch milliseconds — its stop
    /// time, used as the memo's identity timestamp so that re-ingesting the
    /// same file (after a failed delete) resolves to the same memo basename.
    /// Matches what `list_staged` reports for the same file.
    pub modified_ms: f64,
}

/// A native action to queue for the webview (the V1 handshake). Sent by the
/// Rust shell when an OS entry point arrives as a URL open.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueActionRequest {
    /// `recordAudio` or `openDaily`.
    pub action: String,
}

/// `recording_status`'s response — whether a native recording is live.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatusResponse {
    /// True while a recording is in progress.
    pub recording: bool,
    /// Recorded length so far in milliseconds (0 when not recording).
    pub elapsed_ms: f64,
}

/// One file in the staging directory — a recording not yet moved into the
/// graph (an orphan from a crash, or one mid-ingest).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedFile {
    /// Absolute path of the staged `.m4a`.
    pub path: String,
    /// Modification time in epoch milliseconds — the recording's stop time.
    pub modified_ms: f64,
}

/// `list_staged`'s response — every finished recording still in staging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListStagedResponse {
    /// Staged recordings, in no guaranteed order.
    pub files: Vec<StagedFile>,
}

/// `read_staged`'s response — a staged recording's bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadStagedResponse {
    /// The staged file's bytes, base64-encoded.
    pub base64: String,
}

/// Path argument for `read_staged` / `delete_staged`. The native side rejects
/// paths outside its staging directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedPathRequest {
    /// Absolute path of the staged file, as returned by a stop or `list_staged`.
    pub path: String,
}

/// Arguments for `transcribe_on_device` — one recording segment's bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// The recording's bytes, base64-encoded.
    pub base64: String,
    /// The recording's MIME type (picks the temp file's extension, which
    /// AVFoundation uses to choose the container parser).
    pub mime_type: String,
}

/// `transcribe_on_device`'s response. `unavailable` is an expected outcome
/// (speech access denied, no on-device model for the language), not an
/// error: the memo stays pending until a cloud key or the model appears.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResponse {
    /// `ok` | `unavailable`
    pub status: String,
    /// The transcript when `ok` (empty when no speech was heard).
    pub text: String,
    /// Why on-device transcription can't run, when `unavailable`.
    pub reason: String,
}

/// Arguments for `update_daily_widget` — the daily-note widget's snapshot,
/// serialized by the app (`DailyWidgetSnapshot` in the Swift sources).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDailyWidgetRequest {
    /// The snapshot as JSON; the native side validates it before storing.
    pub json: String,
}
