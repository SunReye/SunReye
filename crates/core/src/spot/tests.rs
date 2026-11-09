//! The spot-price device through a fake provider, and the energy-charts adapter on responses
//! recorded from `https://api.energy-charts.info/price` (API: <https://api.energy-charts.info/>,
//! licence in each response's `license_info`: CC BY 4.0, Bundesnetzagentur | SMARD.de).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{broadcast, watch};
use tokio::time::Instant;

use super::fake::Fake;
use super::{BiddingZone, DEVICE, Error, Slot, SpotPrices, energy_charts};
use crate::bus::{Bus, Reading};
use crate::storage::Storage;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

fn instant(text: &str) -> SystemTime {
    text.parse::<jiff::Timestamp>().unwrap().into()
}

#[test]
fn energy_charts_reads_15_minute_prices_in_eur_per_kwh() {
    let slots = energy_charts::parse(include_str!(
        "../../fixtures/energy-charts-price-de-lu-2026-11-09.json"
    ))
    .unwrap();

    // 2026-11-09 and 2026-11-10 in Berlin, CET: from 23:00 UTC the evening before, 96 slots a day.
    assert_eq!(slots.len(), 192);
    assert_eq!(slots[0].start, instant("2026-11-08T23:00:00Z"));
    assert_eq!(slots[1].start, instant("2026-11-08T23:15:00Z"));
    assert_eq!(slots[191].start, instant("2026-11-10T22:45:00Z"));
    // 246.01 EUR/MWh.
    assert_eq!(format!("{:.5}", slots[0].price), "0.24601");
}

#[test]
fn energy_charts_serves_100_slots_on_the_day_clocks_fall_back() {
    let slots = energy_charts::parse(include_str!(
        "../../fixtures/energy-charts-price-de-lu-2025-10-26.json"
    ))
    .unwrap();

    // 2025-10-26 runs from 00:00 CEST (22:00 UTC the day before) to 24:00 CET (23:00 UTC): 25 hours.
    assert_eq!(slots.len(), 100);
    assert_eq!(slots[0].start, instant("2025-10-25T22:00:00Z"));
    assert_eq!(slots[99].start, instant("2025-10-26T22:45:00Z"));
}

#[test]
fn energy_charts_serves_92_slots_on_the_day_clocks_spring_forward() {
    let slots = energy_charts::parse(include_str!(
        "../../fixtures/energy-charts-price-de-lu-2026-03-29.json"
    ))
    .unwrap();

    // 2026-03-29 runs from 00:00 CET (23:00 UTC the day before) to 24:00 CEST (22:00 UTC): 23 hours.
    assert_eq!(slots.len(), 92);
    assert_eq!(slots[0].start, instant("2026-03-28T23:00:00Z"));
    assert_eq!(slots[91].start, instant("2026-03-29T21:45:00Z"));
}

#[test]
fn energy_charts_drops_a_slot_without_a_price_and_keeps_a_negative_one() {
    let body = r#"{"unix_seconds":[1794222000,1794222900,1794223800],
        "price":[-0.5,null,12.3],"unit":"EUR / MWh"}"#;

    let slots = energy_charts::parse(body).unwrap();

    // An absent price is unknown, never zero.
    let read: Vec<_> = slots
        .iter()
        .map(|s| (s.start, format!("{:.5}", s.price)))
        .collect();
    assert_eq!(
        read,
        [
            (at(1_794_222_000), "-0.00050".to_owned()),
            (at(1_794_223_800), "0.01230".to_owned())
        ]
    );
}

#[test]
fn energy_charts_refuses_another_unit_or_a_body_without_prices() {
    let kwh = r#"{"unix_seconds":[1794222000],"price":[0.1],"unit":"EUR / kWh"}"#;
    assert!(matches!(energy_charts::parse(kwh), Err(Error::Format)));
    assert!(matches!(
        energy_charts::parse("No content available"),
        Err(Error::Format)
    ));
}

#[test]
fn energy_charts_asks_for_today_and_tomorrow_on_the_market_calendar() {
    // 00:30 CEST on 2025-10-26 is still the 25th in UTC.
    assert_eq!(
        energy_charts::url(BiddingZone::DeLu, instant("2025-10-25T22:30:00Z")),
        "https://api.energy-charts.info/price?bzn=DE-LU&start=2025-10-26&end=2025-10-27"
    );
}

fn slot(start: &str, price: f64) -> Slot {
    Slot {
        start: instant(start),
        price,
    }
}

/// 11:00 to 11:45 UTC on 2026-11-09, the 11:45 slot unpublished, then 12:00.
fn morning() -> Vec<Slot> {
    vec![
        slot("2026-11-09T11:00:00Z", 0.10),
        slot("2026-11-09T11:15:00Z", -0.02),
        slot("2026-11-09T11:30:00Z", 0.12),
        slot("2026-11-09T12:00:00Z", 0.13),
    ]
}

struct Site {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
}

fn site() -> Site {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(&dir.path().join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    Site {
        _dir: dir,
        bus,
        storage,
    }
}

/// A clock reading `start` when the paused Tokio clock is read now.
fn clock(start: &str) -> impl Fn() -> SystemTime + Sync + use<> {
    let (start, paused) = (instant(start), Instant::now());
    move || start + paused.elapsed()
}

/// The device's readings until one of `value`, as (instant, value to the stored step).
async fn until(readings: &mut broadcast::Receiver<Reading>, value: &str) -> Vec<(String, String)> {
    let mut seen = Vec::new();
    loop {
        let reading = readings.recv().await.unwrap();
        if reading.device != DEVICE {
            continue;
        }
        let at = jiff::Timestamp::try_from(reading.time).unwrap().to_string();
        let price = format!("{:.5}", reading.value);
        let found = price == value;
        seen.push((at, price));
        if found {
            return seen;
        }
    }
}

#[tokio::test]
async fn a_refresh_stores_each_slot_as_a_forecast() {
    let site = site();
    let (fake, mut calls) = Fake::new(morning(), &[]);
    let spot = SpotPrices::new(fake, &site.bus);

    let issued = instant("2026-11-09T11:05:00Z");
    spot.refresh(&site.storage, BiddingZone::DeLu, issued)
        .await
        .unwrap();

    assert_eq!(calls.recv().await.unwrap().1, BiddingZone::DeLu);
    let series = site.bus.intern("price.spot", None);
    let stored: Vec<_> = site
        .storage
        .forecasts(
            DEVICE,
            series,
            instant("2026-11-09T11:00:00Z"),
            instant("2026-11-09T13:00:00Z"),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|f| (f.target, f.issued, format!("{:.5}", f.value)))
        .collect();
    assert_eq!(
        stored,
        [
            (
                instant("2026-11-09T11:00:00Z"),
                issued,
                "0.10000".to_owned()
            ),
            (
                instant("2026-11-09T11:15:00Z"),
                issued,
                "-0.02000".to_owned()
            ),
            (
                instant("2026-11-09T11:30:00Z"),
                issued,
                "0.12000".to_owned()
            ),
            (
                instant("2026-11-09T12:00:00Z"),
                issued,
                "0.13000".to_owned()
            ),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn each_slot_is_published_when_it_begins_and_an_unknown_slot_not_at_all() {
    let site = site();
    let (fake, _calls) = Fake::new(morning(), &[]);
    let spot = SpotPrices::new(fake, &site.bus);
    let mut readings = site.bus.subscribe();
    let (_zone, zone) = watch::channel(Some(BiddingZone::DeLu));

    let seen = tokio::select! {
        () = spot.run(&site.storage, zone, clock("2026-11-09T11:05:00Z")) => panic!("the device stopped"),
        seen = until(&mut readings, "0.13000") => seen,
    };

    // The price in force on start, then each slot from its first instant; 11:45 is unknown, not 0.
    assert_eq!(
        seen,
        [
            ("2026-11-09T11:05:00Z".to_owned(), "0.10000".to_owned()),
            ("2026-11-09T11:15:00Z".to_owned(), "-0.02000".to_owned()),
            ("2026-11-09T11:30:00Z".to_owned(), "0.12000".to_owned()),
            ("2026-11-09T12:00:00Z".to_owned(), "0.13000".to_owned()),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn without_a_zone_nothing_is_fetched() {
    let site = site();
    let (fake, mut calls) = Fake::new(morning(), &[]);
    let spot = SpotPrices::new(fake, &site.bus);
    let (_zone, unset) = watch::channel(None);

    tokio::select! {
        () = spot.run(&site.storage, unset, clock("2026-11-09T11:05:00Z")) => panic!("the device stopped"),
        () = tokio::time::sleep(Duration::from_hours(3)) => {}
    }
    drop(spot);
    assert!(calls.recv().await.is_none());
}

#[tokio::test(start_paused = true)]
async fn a_zone_set_is_fetched_at_once_and_hourly_and_a_failed_fetch_does_not_stop_it() {
    let site = site();
    let (fake, mut calls) = Fake::new(morning(), &[true]);
    let spot = SpotPrices::new(fake, &site.bus);
    let (zone, watched) = watch::channel(None);
    let start = Instant::now();
    let minutes = |m| Duration::from_mins(m);

    let mut seen = Vec::new();
    tokio::select! {
        () = spot.run(&site.storage, watched, clock("2026-11-09T11:05:00Z")) => panic!("the device stopped"),
        () = async {
            tokio::time::sleep(minutes(10)).await;
            zone.send_replace(Some(BiddingZone::DeLu));
            while seen.len() < 3 {
                seen.push(calls.recv().await.unwrap().0 - start);
            }
        } => {}
    }
    assert_eq!(seen, [minutes(10), minutes(70), minutes(130)]);
}

#[tokio::test(start_paused = true)]
async fn after_a_restart_the_stored_prices_are_published_while_the_source_fails() {
    let site = site();
    let (fetched, _calls) = Fake::new(morning(), &[]);
    SpotPrices::new(fetched, &site.bus)
        .refresh(
            &site.storage,
            BiddingZone::DeLu,
            instant("2026-11-09T11:00:00Z"),
        )
        .await
        .unwrap();
    let (offline, _calls) = Fake::new(Vec::new(), &[true, true]);
    let spot = SpotPrices::new(offline, &site.bus);
    let mut readings = site.bus.subscribe();
    let (_zone, zone) = watch::channel(Some(BiddingZone::DeLu));

    let seen = tokio::select! {
        () = spot.run(&site.storage, zone, clock("2026-11-09T11:20:00Z")) => panic!("the device stopped"),
        seen = until(&mut readings, "0.12000") => seen,
    };

    assert_eq!(
        seen,
        [
            ("2026-11-09T11:20:00Z".to_owned(), "-0.02000".to_owned()),
            ("2026-11-09T11:30:00Z".to_owned(), "0.12000".to_owned()),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn the_prices_are_stored_as_change_points() {
    let site = site();
    let (fake, _calls) = Fake::new(morning(), &[]);
    let spot = SpotPrices::new(fake, &site.bus);
    let mut readings = site.bus.subscribe();
    let (_zone, zone) = watch::channel(Some(BiddingZone::DeLu));
    tokio::select! {
        () = spot.run(&site.storage, zone, clock("2026-11-09T11:05:00Z")) => panic!("the device stopped"),
        _ = until(&mut readings, "-0.02000") => {}
    }
    let series = site.bus.intern("price.spot", None);
    let (from, to) = (
        instant("2026-11-09T11:00:00Z"),
        instant("2026-11-09T11:20:00Z"),
    );

    // Storage hears the bus on its own task: asked until both prices are history.
    let mut history = Vec::new();
    while history.len() < 2 {
        tokio::task::yield_now().await;
        site.storage.tick(to).await.unwrap();
        history = site
            .storage
            .history(DEVICE, series, from, to)
            .await
            .unwrap();
    }

    let stored: Vec<_> = history
        .iter()
        .map(|p| (p.time, p.value.map(|v| format!("{v:.5}"))))
        .collect();
    assert_eq!(
        stored,
        [
            (instant("2026-11-09T11:05:00Z"), Some("0.10000".to_owned())),
            (instant("2026-11-09T11:15:00Z"), Some("-0.02000".to_owned())),
        ]
    );
}
