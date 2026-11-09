//! HTTP hosts (ADR 6, 10): digest authentication, and devices read through an in-test host.

use std::sync::Arc;
use std::time::Duration;

use sunreye_profile::Profile;
use tokio::sync::broadcast::Receiver;

use super::digest::Challenge;
use super::fake::{Answers, Asked, Fake, serve};
use super::{Host, spawn};
use crate::bus::{Bus, DeviceId, Reading};
use crate::endpoint::Device;

/// RFC 7616 §3.9.1, <https://www.rfc-editor.org/rfc/rfc7616#section-3.9.1>: the SHA-256 challenge
/// and the answer to it for Mufasa, password "Circle of Life", GET /dir/index.html.
#[test]
fn a_digest_challenge_is_answered_as_rfc_7616_answers_it() {
    let challenge = Challenge::parse(
        r#"Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS""#,
    )
    .unwrap();

    let answer = challenge.answer(
        ("Mufasa", "Circle of Life"),
        "GET",
        "/dir/index.html",
        "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
    );

    assert_eq!(
        answer,
        r#"Digest username="Mufasa", realm="http-auth@example.org", uri="/dir/index.html", algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", nc=00000001, cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ", qop=auth, response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS""#
    );
}

#[test]
fn only_a_sha_256_digest_with_qop_auth_is_answered() {
    for header in [
        r#"Digest realm="r", qop="auth", algorithm=MD5, nonce="n""#,
        r#"Digest realm="r", nonce="n", algorithm=SHA-256"#,
        r#"Digest realm="r", qop="auth-int", nonce="n", algorithm=SHA-256"#,
        r#"Basic realm="r""#,
    ] {
        assert!(Challenge::parse(header).is_none(), "{header}");
    }
}

/// Shelly's documented `EM.GetStatus` answer (see the profile's tests).
const STATUS: &str = include_str!("../../../profile/src/tests/shelly-pro-3em-status.json");
/// Distinctive, so a search for it finds only a leak.
const PASSWORD: &str = "Tr0ub4dor&3";

fn shelly() -> Arc<Profile> {
    Arc::new(Profile::load(include_str!("../../../../profiles/shelly-pro-3em.json")).unwrap())
}

fn meter(id: u32, unit: u8) -> Device {
    Device {
        id: DeviceId(id),
        unit,
        profile: shelly(),
    }
}

fn host(fake: &Fake, credentials: Option<(String, String)>) -> Host {
    Host {
        host: fake.address.ip().to_string(),
        port: fake.address.port(),
        credentials,
    }
}

fn status(id: u8) -> (String, String) {
    (format!("/rpc/EM.GetStatus?id={id}"), STATUS.to_owned())
}

/// The first reading of `role` from each of `devices`, by device.
async fn grid_power(
    bus: &Bus,
    readings: &mut Receiver<Reading>,
    devices: usize,
) -> Vec<(u32, f64)> {
    let mut seen: Vec<(u32, f64)> = Vec::new();
    let wait = async {
        while seen.len() < devices {
            let reading = readings.recv().await.unwrap();
            let device = reading.device.0;
            if bus.series(reading.series).unwrap().role == "grid.power"
                && !seen.iter().any(|(d, _)| *d == device)
            {
                seen.push((device, reading.value));
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(10), wait)
        .await
        .expect("every device reads");
    seen.sort_by_key(|(d, _)| *d);
    seen
}

#[tokio::test]
async fn a_host_reads_each_device_through_its_gets_as_roles() {
    let fake = serve(Answers {
        bodies: vec![status(0)],
        password: None,
        together: 1,
    })
    .await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();

    let _task = spawn(host(&fake, None), vec![meter(7, 0)], bus.clone());

    assert_eq!(grid_power(&bus, &mut readings, 1).await, [(7, 2484.782)]);
}

#[tokio::test]
async fn a_password_answers_the_hosts_digest_challenge() {
    let mut fake = serve(Answers {
        bodies: vec![status(0)],
        password: Some(PASSWORD.to_owned()),
        together: 1,
    })
    .await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let credentials = Some(("admin".to_owned(), PASSWORD.to_owned()));

    let _task = spawn(host(&fake, credentials), vec![meter(7, 0)], bus.clone());

    assert_eq!(grid_power(&bus, &mut readings, 1).await, [(7, 2484.782)]);
    let path = "/rpc/EM.GetStatus?id=0".to_owned();
    let challenged = Asked {
        path: path.clone(),
        authorized: false,
    };
    assert_eq!(fake.asked.recv().await, Some(challenged));
    assert_eq!(
        fake.asked.recv().await,
        Some(Asked {
            path,
            authorized: true
        })
    );
}

/// The host holds every answer until both meters' GETs are open: a serialised task never reads.
#[tokio::test]
async fn the_devices_of_a_host_are_asked_in_parallel() {
    let fake = serve(Answers {
        bodies: vec![status(0), status(1)],
        password: None,
        together: 2,
    })
    .await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();

    let _task = spawn(
        host(&fake, None),
        vec![meter(7, 0), meter(8, 1)],
        bus.clone(),
    );

    assert_eq!(
        grid_power(&bus, &mut readings, 2).await,
        [(7, 2484.782), (8, 2484.782)]
    );
}

/// A cycle publishes its readings at once, so those after the first are already sent.
#[tokio::test]
async fn a_device_whose_get_failed_publishes_nothing() {
    let fake = serve(Answers {
        bodies: vec![status(0)],
        password: None,
        together: 1,
    })
    .await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();

    let _task = spawn(
        host(&fake, None),
        vec![meter(7, 0), meter(8, 1)],
        bus.clone(),
    );

    assert_eq!(grid_power(&bus, &mut readings, 1).await, [(7, 2484.782)]);
    while let Ok(reading) = readings.try_recv() {
        assert_eq!(reading.device, DeviceId(7));
    }
}
