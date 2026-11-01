# shellcheck shell=bash
# Sourced by scripts/setup-targets and scripts/target-gate: the toolchain pins and the check of what is installed.

NDK_VERSION=r27c
ANDROID_TARGET=aarch64-linux-android

TARGETS_HOME=${SUNREYE_TARGETS_HOME:-$HOME/.cache/sunreye-targets}

# An ANDROID_NDK_HOME that exists wins over the one setup-targets installs.
ndk_home() {
  if [[ -n ${ANDROID_NDK_HOME:-} && -d $ANDROID_NDK_HOME ]]; then
    echo "$ANDROID_NDK_HOME"
  else
    echo "$TARGETS_HOME/android-ndk-$NDK_VERSION"
  fi
}

# Prints one name per missing piece.
missing_pieces() {
  command -v cargo-ndk >/dev/null || echo cargo-ndk
  [[ -d $(ndk_home) ]] || echo ndk
  rustup target list --installed | grep -qx "$ANDROID_TARGET" || echo android-target
}

# Puts the installed NDK where cargo-ndk looks.
use_targets() {
  ANDROID_NDK_HOME=$(ndk_home)
  export ANDROID_NDK_HOME
}
