# shellcheck shell=bash
# Sourced by scripts/setup-targets and scripts/target-gate: the toolchain pins and the check of what is installed.

# Nightly for riscv32imafc-esp-espidf (tier 3, needs -Zbuild-std). 2026-07-29 is the last nightly whose
# std builds for it: 2026-08-05 fails on libc::AT_FDCWD, which libc has no value for on espidf. Later
# nightlies are also exposed to rust-lang/rust#164555 (libc 0.2.191 breaks std for every
# riscv32*-esp-espidf target). Move the pin only after both are fixed upstream and a newer nightly built here.
NIGHTLY=nightly-2026-07-29
NDK_VERSION=r27c
IDF_VERSION=v5.4.3
ANDROID_TARGET=aarch64-linux-android
ESP_TARGET=riscv32imafc-esp-espidf

TARGETS_HOME=${SUNREYE_TARGETS_HOME:-$HOME/.cache/sunreye-targets}
export IDF_TOOLS_PATH=$TARGETS_HOME/espressif

# An ANDROID_NDK_HOME that exists wins over the one setup-targets installs.
ndk_home() {
  if [[ -n ${ANDROID_NDK_HOME:-} && -d $ANDROID_NDK_HOME ]]; then
    echo "$ANDROID_NDK_HOME"
  else
    echo "$TARGETS_HOME/android-ndk-$NDK_VERSION"
  fi
}

# Directory of the ESP-IDF riscv32 compiler that setup-targets installed; empty when absent.
esp_gcc_dir() {
  local gcc
  gcc=$(compgen -G "$IDF_TOOLS_PATH/tools/riscv32-esp-elf/*/riscv32-esp-elf/bin/riscv32-esp-elf-gcc" | tail -n 1) || true
  [[ -z $gcc ]] || dirname "$gcc"
}

# Prints one name per missing piece.
missing_pieces() {
  command -v cargo-ndk >/dev/null || echo cargo-ndk
  [[ -d $(ndk_home) ]] || echo ndk
  rustup target list --installed | grep -qx "$ANDROID_TARGET" || echo android-target
  rustup toolchain list | grep -q "^$NIGHTLY-" || echo nightly
  rustup component list --installed --toolchain "$NIGHTLY" 2>/dev/null | grep -q '^rust-src' || echo rust-src
  command -v ldproxy >/dev/null || echo ldproxy
  [[ -n $(esp_gcc_dir) ]] || command -v riscv32-esp-elf-gcc >/dev/null || echo gcc
}

# Puts the installed NDK and ESP-IDF compiler where cargo-ndk and the build scripts of C crates look.
use_targets() {
  ANDROID_NDK_HOME=$(ndk_home)
  export ANDROID_NDK_HOME
  local gcc_dir
  gcc_dir=$(esp_gcc_dir)
  [[ -z $gcc_dir ]] || PATH=$gcc_dir:$PATH
}
