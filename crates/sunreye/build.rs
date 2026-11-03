//! Picks the folder the SPA is embedded from: the static build under `apps/web/build` (or
//! `SUNREYE_SPA_DIR`) when it has an `index.html`, else the committed placeholder. A release build
//! without the static build fails.

#![allow(clippy::print_stdout, reason = "cargo reads its directives from stdout")]
#![allow(clippy::expect_used, reason = "a build script has no caller to return to")]
#![allow(clippy::panic, reason = "a failed build script is how a build is refused")]

mod spa_dir;

use std::env;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=SUNREYE_SPA_DIR");
    println!("cargo:rerun-if-env-changed=PROFILE");
    // `sqlx::migrate!` embeds the migrations; without this a new one is not compiled in.
    println!("cargo:rerun-if-changed=migrations");
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let built =
        env::var_os("SUNREYE_SPA_DIR").map_or_else(|| manifest.join("../../apps/web/build"), PathBuf::from);
    println!("cargo:rerun-if-changed={}", built.display());
    let profile = env::var("PROFILE").expect("cargo sets PROFILE");
    let embedded = spa_dir::choose(&built, &manifest.join("spa-placeholder"), &profile)
        .unwrap_or_else(|refusal| panic!("{refusal}"));
    println!("cargo:rustc-env=SUNREYE_EMBED_DIR={}", embedded.display());
}
