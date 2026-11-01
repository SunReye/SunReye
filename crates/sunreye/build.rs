//! Picks the folder the SPA is embedded from: the static build under `apps/web/build` (or
//! `SUNREYE_SPA_DIR`) when it has an `index.html`, else the committed placeholder.

#![allow(clippy::print_stdout, reason = "cargo reads its directives from stdout")]
#![allow(clippy::expect_used, reason = "a build script has no caller to return to")]

use std::env;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=SUNREYE_SPA_DIR");
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let built =
        env::var_os("SUNREYE_SPA_DIR").map_or_else(|| manifest.join("../../apps/web/build"), PathBuf::from);
    println!("cargo:rerun-if-changed={}", built.display());
    let embedded = if built.join("index.html").is_file() { built } else { manifest.join("spa-placeholder") };
    println!("cargo:rustc-env=SUNREYE_EMBED_DIR={}", embedded.display());
}
