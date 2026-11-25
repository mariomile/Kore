use tauri::{command, AppHandle, Runtime};

use crate::models::HapticRequest;
use crate::KeyboardExt;
use crate::Result;

/// Play one native haptic style. A no-op wherever there is no haptic engine
/// (desktop, iPad, the simulator).
#[command]
pub(crate) async fn haptic<R: Runtime>(app: AppHandle<R>, request: HapticRequest) -> Result<()> {
    app.keyboard().haptic(request)
}
