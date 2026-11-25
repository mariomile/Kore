use serde::{Deserialize, Serialize};

/// The iOS feedback generators, one variant per native style: a selection
/// tick (`UISelectionFeedbackGenerator`), two impact weights
/// (`UIImpactFeedbackGenerator`), and the three notification outcomes
/// (`UINotificationFeedbackGenerator`). Which interaction gets which style is
/// policy and lives in the frontend; this is only the vocabulary the native
/// side can play.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HapticStyle {
    Selection,
    Light,
    Medium,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HapticRequest {
    pub style: HapticStyle,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn styles_cross_the_bridge_as_lowercase_names() {
        let request: HapticRequest = serde_json::from_str(r#"{"style":"medium"}"#).unwrap();
        assert_eq!(request.style, HapticStyle::Medium);
        assert_eq!(
            serde_json::to_string(&HapticRequest {
                style: HapticStyle::Selection
            })
            .unwrap(),
            r#"{"style":"selection"}"#
        );
    }

    #[test]
    fn unknown_styles_are_rejected() {
        assert!(serde_json::from_str::<HapticRequest>(r#"{"style":"heavy"}"#).is_err());
    }
}
