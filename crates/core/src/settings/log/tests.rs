//! The write log over a real store.

use std::time::{Duration, UNIX_EPOCH};

use super::{Attempt, append, entries};
use crate::bus::Bus;
use crate::settings::{Applied, Outcome};
use crate::storage::Storage;

#[tokio::test]
async fn a_remote_write_is_logged_with_the_device_key_it_came_through() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(
        &dir.path().join("core.sqlite"),
        UNIX_EPOCH,
        "UTC",
        &Bus::default(),
    )
    .unwrap();
    let applied = Applied {
        outcome: Outcome::Verified,
        before: Some(40.0),
        after: Some(50.0),
        failed_step: None,
    };

    let logged = storage
        .database()
        .run(move |db| {
            let attempt = |via| Attempt {
                time: UNIX_EPOCH + Duration::from_hours(496_596),
                device: 1,
                setting: "battery.max_charge_current",
                requested: 50.0,
                applied,
                actor: "admin",
                via,
            };
            append(db, &attempt(Some("Ediz's phone")))?;
            append(db, &attempt(None))?;
            entries(db)
        })
        .await
        .unwrap();

    let via: Vec<_> = logged.iter().map(|e| e.via.as_deref()).collect();
    assert_eq!(via, [Some("Ediz's phone"), None]);
}
