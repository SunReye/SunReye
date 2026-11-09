//! Backup through the API (ADR 3): the admin names a file under `/share`, which the core writes.

use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use serde_json::json;

use super::Core;
use super::devices::send;

/// An unlock code: distinctive, so a search of the file finds only a leak.
const CODE: &str = "52817";

fn shared(dir: &Path, name: &str) -> PathBuf {
    dir.join("share").join(name)
}

fn holds(file: &Path, value: &str) -> bool {
    let bytes = std::fs::read(file).unwrap();
    bytes.windows(value.len()).any(|w| w == value.as_bytes())
}

/// A signed-in core with a connection whose secret `unlock` is `CODE`.
async fn plant(dir: &Path) -> (Core, String) {
    let (core, admin) = Core::signed_in(&dir.join("core.sqlite")).await;
    let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": 9, "secrets": { "unlock": CODE } });
    core.connection(&admin, &gateway).await;
    (core, admin)
}

#[tokio::test]
async fn the_admin_backs_up_into_a_named_file_under_share_without_secrets_unless_asked() {
    use std::os::unix::fs::PermissionsExt as _;
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = plant(dir.path()).await;

    let (status, plain) = core
        .ask(
            &admin,
            send("POST", "/api/v1/backups", &json!({ "name": "plain.tar" })),
        )
        .await;
    let (_, with) = core
        .ask(
            &admin,
            send(
                "POST",
                "/api/v1/backups",
                &json!({ "name": "with.tar", "secrets": true }),
            ),
        )
        .await;

    let file = shared(dir.path(), "plain.tar");
    assert_eq!(status, StatusCode::CREATED, "{plain}");
    assert_eq!(plain["name"], "plain.tar");
    assert_eq!(plain["bytes"], std::fs::metadata(&file).unwrap().len());
    let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(holds(&file, "gateway"));
    assert!(!holds(&file, CODE));
    assert_eq!(with["name"], "with.tar");
    assert!(holds(&shared(dir.path(), "with.tar"), CODE));
}

#[tokio::test]
async fn a_backup_is_refused_a_name_that_is_no_plain_file_name_or_names_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = plant(dir.path()).await;
    std::fs::create_dir_all(dir.path().join("share")).unwrap();
    std::fs::write(shared(dir.path(), "taken.tar"), "kept").unwrap();

    let mut refusals = Vec::new();
    for name in [
        "",
        ".",
        "..",
        "../core.tar",
        "sub/x.tar",
        ".hidden",
        "taken.tar",
    ] {
        let request = send("POST", "/api/v1/backups", &json!({ "name": name }));
        refusals.push(core.refusal(&admin, request).await);
    }

    let name = (StatusCode::UNPROCESSABLE_ENTITY, "backup.name".to_owned());
    let exists = (StatusCode::CONFLICT, "backup.exists".to_owned());
    assert_eq!(
        refusals,
        [&name, &name, &name, &name, &name, &name, &exists].map(Clone::clone)
    );
    assert_eq!(
        std::fs::read_to_string(shared(dir.path(), "taken.tar")).unwrap(),
        "kept"
    );
    assert!(!dir.path().join("core.tar").exists());
}
