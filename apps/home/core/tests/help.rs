//! `--help` prints each command's usage: what the docs' commands are checked against (ADR 13).
#![cfg(test)]

use std::process::Command;

/// The usage `args` print, once the binary exits cleanly.
fn help(args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_sunreye"))
        .args(args)
        .arg("--help")
        .env_remove("SUNREYE_DATA_DIR")
        .output()
        .unwrap();
    assert!(output.status.success(), "{args:?}: {output:?}");
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn each_command_prints_its_flags_and_their_variables() {
    let cases: [(&[&str], &[&str]); 5] = [
        (
            &[],
            &[
                "Usage: sunreye ",
                "Commands: capture, import, backup, restore",
                "--data-dir",
                "SUNREYE_DATA_DIR",
                "--listen",
                "SUNREYE_LISTEN",
                "--ingress",
                "SUNREYE_INGRESS",
            ],
        ),
        (
            &["capture"],
            &[
                "Usage: sunreye capture ",
                "--endpoint",
                "--unit",
                "--profile",
            ],
        ),
        (
            &["import"],
            &[
                "Usage: sunreye import ",
                "--device",
                "--data-dir",
                "SUNREYE_DATA_DIR",
            ],
        ),
        (
            &["backup"],
            &["Usage: sunreye backup ", "--secrets", "--data-dir"],
        ),
        (&["restore"], &["Usage: sunreye restore ", "--data-dir"]),
    ];
    for (args, expected) in cases {
        let usage = help(args);
        for text in expected {
            assert!(usage.contains(text), "{args:?} lacks {text:?}:\n{usage}");
        }
    }
    assert!(!help(&["restore"]).contains("--secrets"));
}
