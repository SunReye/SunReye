//! Records the build time: a wall clock before it is unsynced (ADR 3).

use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // A reproducible build pins its time.
    let seconds = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs())
        })
        .unwrap_or(0);
    println!("cargo::rustc-env=SUNREYE_BUILD_TIME={seconds}");
    println!("cargo::rerun-if-env-changed=SOURCE_DATE_EPOCH");
}
