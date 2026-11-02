//! Which folder the SPA is embedded from. Shared by `build.rs` and its test.

use std::path::{Path, PathBuf};

/// `built` when it has an `index.html`; else the placeholder, except in a release, which must ship the
/// real SPA.
pub fn choose(built: &Path, placeholder: &Path, profile: &str) -> Result<PathBuf, String> {
    if built.join("index.html").is_file() {
        Ok(built.to_path_buf())
    } else if profile == "release" {
        Err(format!(
            "no SPA build at {}: a release embeds the real SPA. Run `bun run --cwd apps/web build:static`",
            built.display()
        ))
    } else {
        Ok(placeholder.to_path_buf())
    }
}
