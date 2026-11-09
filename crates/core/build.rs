//! Records the build time, a wall clock before it is unsynced (ADR 3), and embeds the SPA's
//! precompressed build (ADR 11).

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SPA: &str = "../../apps/web/build";

fn main() -> Result<(), String> {
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
    println!("cargo::rerun-if-changed={SPA}");
    embed()
}

/// Writes `spa.rs`: every built file with its gzip and brotli siblings, sorted by path.
fn embed() -> Result<(), String> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?;
    let root = Path::new(&manifest).join(SPA);
    // A binary without its screen must not build.
    let root = root.canonicalize().map_err(|e| {
        format!(
            "{}: {e}; build the SPA first: `bun run --cwd apps/web build`",
            root.display()
        )
    })?;
    let mut files = Vec::new();
    walk(&root, &mut files).map_err(|e| e.to_string())?;
    files.retain(|file| !file.extension().is_some_and(|e| e == "gz" || e == "br"));
    files.sort();
    let mut code = String::from("&[\n");
    for file in &files {
        let path = file
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        writeln!(
            code,
            "Asset {{ path: {path:?}, identity: include_bytes!({:?}), gzip: {}, brotli: {} }},",
            file.display(),
            sibling(file, "gz"),
            sibling(file, "br"),
        )
        .map_err(|e| e.to_string())?;
    }
    code.push(']');
    let out = std::env::var("OUT_DIR").map_err(|e| e.to_string())?;
    std::fs::write(Path::new(&out).join("spa.rs"), code).map_err(|e| e.to_string())
}

fn sibling(file: &Path, extension: &str) -> String {
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".{extension}"));
    let sibling = PathBuf::from(name);
    if sibling.is_file() {
        format!("Some(include_bytes!({:?}))", sibling.display())
    } else {
        "None".to_owned()
    }
}

fn walk(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}
