//! Tariff evaluation in the plant timezone, worked by hand.

use std::time::SystemTime;

use jiff::tz::TimeZone;

use super::{Band, Days, Prices, Schedule, Version, in_force, wake};

fn instant(text: &str) -> SystemTime {
    text.parse::<jiff::Timestamp>().unwrap().into()
}

fn berlin() -> TimeZone {
    TimeZone::get("Europe/Berlin").unwrap()
}

/// From `from` to `to` minutes of the plant-local day.
fn band(days: &[u8], from: u16, to: u16, price: f64) -> Band {
    Band {
        days: Days::of(days).unwrap(),
        from,
        to,
        price,
    }
}

const EVERY_DAY: &[u8] = &[1, 2, 3, 4, 5, 6, 7];

/// 0.30 EUR/kWh, 0.20 at night from 00:00 to 06:00; 0.08 paid for feed-in.
fn night_rate(applies_from: &str) -> Version {
    Version {
        applies_from: instant(applies_from),
        import: Schedule {
            price: 0.30,
            bands: vec![band(EVERY_DAY, 0, 6 * 60, 0.20)],
        },
        export: Schedule {
            price: 0.08,
            bands: vec![],
        },
    }
}

fn import(version: &Version, zone: &TimeZone, at: &str) -> f64 {
    version.prices(zone, instant(at)).import
}

/// The minutes of the plant-local day starting at `midnight` (UTC) whose import price is `price`.
fn minutes_at(version: &Version, zone: &TimeZone, midnight: &str, hours: i64, price: f64) -> usize {
    let start = midnight.parse::<jiff::Timestamp>().unwrap();
    (0..hours * 60)
        .map(|minute| start + jiff::SignedDuration::from_mins(minute))
        .filter(|t| version.prices(zone, (*t).into()).import.to_bits() == price.to_bits())
        .count()
}

#[test]
fn a_fixed_tariff_charges_one_price_at_every_instant() {
    let fixed = Version {
        import: Schedule {
            price: 0.32,
            bands: vec![],
        },
        ..night_rate("2026-01-01T00:00:00Z")
    };

    assert_eq!(
        fixed.prices(&berlin(), instant("2026-07-01T12:34:56Z")),
        Prices {
            import: 0.32,
            export: 0.08
        }
    );
}

#[test]
fn a_band_applies_on_plant_local_wall_clock_time() {
    let night = night_rate("2026-01-01T00:00:00Z");
    let zone = berlin();

    // Winter, UTC+1: the band ends at 06:00 CET, 05:00 UTC.
    assert_eq!(import(&night, &zone, "2026-01-14T04:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-01-14T05:00:00Z"), 0.30);
    // Summer, UTC+2: it begins at 00:00 CEST, 22:00 UTC the evening before.
    assert_eq!(import(&night, &zone, "2026-07-14T21:59:00Z"), 0.30);
    assert_eq!(import(&night, &zone, "2026-07-14T22:00:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-07-15T03:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-07-15T04:00:00Z"), 0.30);
}

#[test]
fn a_night_band_lasts_five_hours_on_the_23_hour_day() {
    let night = night_rate("2026-01-01T00:00:00Z");
    let zone = berlin();

    // 2026-03-29 begins at 00:00 CET (23:00 UTC the day before); clocks jump from 02:00 CET to
    // 03:00 CEST at 01:00 UTC, so 06:00 CEST is 04:00 UTC: five hours in the band.
    assert_eq!(import(&night, &zone, "2026-03-29T00:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-03-29T01:00:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-03-29T03:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-03-29T04:00:00Z"), 0.30);
    assert_eq!(
        minutes_at(&night, &zone, "2026-03-28T23:00:00Z", 23, 0.20),
        5 * 60
    );
    assert_eq!(
        minutes_at(&night, &zone, "2026-03-28T23:00:00Z", 23, 0.30),
        18 * 60
    );
}

#[test]
fn a_night_band_lasts_seven_hours_on_the_25_hour_day() {
    let night = night_rate("2026-01-01T00:00:00Z");
    let zone = berlin();

    // 2026-10-25 begins at 00:00 CEST (22:00 UTC the day before); clocks fall back from 03:00
    // CEST to 02:00 CET at 01:00 UTC, so 06:00 CET is 05:00 UTC: seven hours in the band.
    assert_eq!(import(&night, &zone, "2026-10-24T21:59:00Z"), 0.30);
    assert_eq!(import(&night, &zone, "2026-10-24T22:00:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-10-25T04:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-10-25T05:00:00Z"), 0.30);
    assert_eq!(
        minutes_at(&night, &zone, "2026-10-24T22:00:00Z", 25, 0.20),
        7 * 60
    );
    assert_eq!(
        minutes_at(&night, &zone, "2026-10-24T22:00:00Z", 25, 0.30),
        18 * 60
    );
}

#[test]
fn a_band_in_the_skipped_hour_never_applies_and_in_the_repeated_hour_applies_twice() {
    let mut version = night_rate("2026-01-01T00:00:00Z");
    version.import.bands = vec![band(EVERY_DAY, 2 * 60, 3 * 60, 0.10)];
    let zone = berlin();

    // 02:00 to 03:00 does not exist on 2026-03-29.
    assert_eq!(
        minutes_at(&version, &zone, "2026-03-28T23:00:00Z", 23, 0.10),
        0
    );
    // It runs twice on 2026-10-25: 02:00 CEST (00:00 UTC) to 02:59 CET (01:59 UTC).
    assert_eq!(import(&version, &zone, "2026-10-24T23:59:00Z"), 0.30);
    assert_eq!(import(&version, &zone, "2026-10-25T00:00:00Z"), 0.10);
    assert_eq!(import(&version, &zone, "2026-10-25T01:59:00Z"), 0.10);
    assert_eq!(import(&version, &zone, "2026-10-25T02:00:00Z"), 0.30);
    assert_eq!(
        minutes_at(&version, &zone, "2026-10-24T22:00:00Z", 25, 0.10),
        2 * 60
    );
}

#[test]
fn a_band_applies_only_on_its_plant_local_weekdays() {
    let mut version = night_rate("2026-01-01T00:00:00Z");
    // Monday to Friday, 08:00 to 20:00.
    version.import.bands = vec![band(&[1, 2, 3, 4, 5], 8 * 60, 20 * 60, 0.35)];
    let zone = berlin();

    // Monday 2026-11-09, 08:00 CET.
    assert_eq!(import(&version, &zone, "2026-11-09T06:59:00Z"), 0.30);
    assert_eq!(import(&version, &zone, "2026-11-09T07:00:00Z"), 0.35);
    // Friday 2026-11-13, 19:59 CET, then 20:00.
    assert_eq!(import(&version, &zone, "2026-11-13T18:59:00Z"), 0.35);
    assert_eq!(import(&version, &zone, "2026-11-13T19:00:00Z"), 0.30);
    // Saturday 2026-11-14, 12:00 CET.
    assert_eq!(import(&version, &zone, "2026-11-14T11:00:00Z"), 0.30);
    // Sunday 23:30 UTC is already Monday 00:30 CET, still outside the band.
    assert_eq!(import(&version, &zone, "2026-11-15T23:30:00Z"), 0.30);
}

#[test]
fn feed_in_has_bands_of_its_own() {
    let mut version = night_rate("2026-01-01T00:00:00Z");
    version.export.bands = vec![band(EVERY_DAY, 11 * 60, 15 * 60, 0.0)];

    let noon = version.prices(&TimeZone::UTC, instant("2026-06-01T12:00:00Z"));

    assert_eq!(
        noon,
        Prices {
            import: 0.30,
            export: 0.0
        }
    );
}

#[test]
fn the_version_in_force_is_the_latest_applying_by_then() {
    let versions = [
        night_rate("2026-01-01T00:00:00Z"),
        night_rate("2026-06-01T00:00:00Z"),
    ];

    assert!(in_force(&versions, instant("2025-12-31T23:59:59Z")).is_none());
    assert_eq!(
        in_force(&versions, instant("2026-05-31T23:59:59Z"))
            .unwrap()
            .applies_from,
        instant("2026-01-01T00:00:00Z")
    );
    assert_eq!(
        in_force(&versions, instant("2026-06-01T00:00:00Z"))
            .unwrap()
            .applies_from,
        instant("2026-06-01T00:00:00Z")
    );
}

#[test]
fn the_device_wakes_at_the_next_minute_or_the_next_version_if_sooner() {
    let versions = [night_rate("2026-06-01T12:00:45Z")];

    assert_eq!(
        wake(&versions, instant("2026-06-01T12:00:30Z")),
        instant("2026-06-01T12:00:45Z")
    );
    assert_eq!(
        wake(&versions, instant("2026-06-01T12:00:45Z")),
        instant("2026-06-01T12:01:00Z")
    );
    assert_eq!(
        wake(&versions, instant("2026-06-01T12:01:00Z")),
        instant("2026-06-01T12:02:00Z")
    );
}
