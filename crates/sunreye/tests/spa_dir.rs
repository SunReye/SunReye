//! The build script's choice of the SPA folder: a release never embeds the placeholder.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

#[path = "../spa_dir.rs"]
mod spa_dir;

use std::path::{Path, PathBuf};

use spa_dir::choose;

fn folder(name: &str, with_index: bool) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("spa-dir-{name}"));
    drop(std::fs::remove_dir_all(&dir));
    std::fs::create_dir_all(&dir).expect("create");
    if with_index {
        std::fs::write(dir.join("index.html"), "<!doctype html>").expect("write");
    }
    dir
}

#[test]
fn a_build_with_an_index_is_embedded_in_both_profiles() {
    let built = folder("built", true);
    let placeholder = PathBuf::from("placeholder");
    assert_eq!(choose(&built, &placeholder, "release"), Ok(built.clone()));
    assert_eq!(choose(&built, &placeholder, "debug"), Ok(built));
}

#[test]
fn a_debug_build_without_an_index_falls_back_to_the_placeholder() {
    let missing = folder("missing", false);
    let placeholder = PathBuf::from("placeholder");
    assert_eq!(choose(&missing, &placeholder, "debug"), Ok(placeholder));
}

#[test]
fn a_release_build_without_an_index_is_refused_naming_the_build_command() {
    let missing = folder("release-missing", false);
    let refusal = choose(&missing, Path::new("placeholder"), "release").expect_err("refused");
    assert!(refusal.contains("bun run --cwd apps/web build:static"), "{refusal}");
    assert!(refusal.contains(&missing.display().to_string()), "{refusal}");
}
