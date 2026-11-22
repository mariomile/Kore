#!/bin/bash
# Adds the UIScene manifest to the built app's Info.plist when, and only when,
# the build uses the iOS 27 SDK or later. The rationale lives with the phase
# definition in ios.project.yml.
set -euo pipefail

# First SDK whose UIKit traps on launch for an app without the scene lifecycle.
SCENE_LIFECYCLE_REQUIRED_SDK_MAJOR=27

SDK_MAJOR="${SDK_VERSION:?}"
SDK_MAJOR="${SDK_MAJOR%%.*}"
if [ "$SDK_MAJOR" -lt "$SCENE_LIFECYCLE_REQUIRED_SDK_MAJOR" ]; then
  exit 0
fi

PLIST="${TARGET_BUILD_DIR:?}/${INFOPLIST_PATH:?}"
PLIST_BUDDY=/usr/libexec/PlistBuddy

# Idempotent: Xcode only rewrites the built Info.plist when its inputs change,
# so an incremental build finds the manifest this script added last time.
if "$PLIST_BUDDY" -c "Print :UIApplicationSceneManifest" "$PLIST" >/dev/null 2>&1; then
  exit 0
fi

"$PLIST_BUDDY" \
  -c "Add :UIApplicationSceneManifest dict" \
  -c "Add :UIApplicationSceneManifest:UIApplicationSupportsMultipleScenes bool true" \
  "$PLIST"
