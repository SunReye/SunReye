//! The standing charge per plant-local day, worked by hand in Europe/Berlin.

use std::time::SystemTime;

use jiff::tz::TimeZone;

use super::owed;
use crate::tariff::{Schedule, Version};

fn instant(text: &str) -> SystemTime {
    text.parse::<jiff::Timestamp>().unwrap().into()
}

fn berlin() -> TimeZone {
    TimeZone::get("Europe/Berlin").unwrap()
}

fn charging(applies_from: &str, standing_charge: f64) -> Version {
    let flat = Schedule {
        price: 0.30,
        bands: vec![],
    };
    Version {
        applies_from: instant(applies_from),
        import: flat.clone(),
        export: flat,
        standing_charge,
    }
}

/// Each day starting within the range, by its start, with what it owes to a hundredth of a cent.
fn days(versions: &[Version], from: &str, to: &str, now: &str) -> Vec<(String, String)> {
    owed(
        versions,
        &berlin(),
        instant(from)..instant(to),
        instant(now),
    )
    .into_iter()
    .map(|day| {
        let start = jiff::Timestamp::try_from(day.start).unwrap();
        (start.to_string(), format!("{:.4}", day.euros))
    })
    .collect()
}

fn sum(versions: &[Version], from: &str, to: &str) -> String {
    let now = instant("2030-01-01T00:00:00Z");
    let days = owed(versions, &berlin(), instant(from)..instant(to), now);
    format!("{:.4}", days.iter().map(|day| day.euros).sum::<f64>())
}

/// 16 EUR a month since 2026.
fn sixteen() -> [Version; 1] {
    [charging("2025-12-31T23:00:00Z", 16.0)]
}

#[test]
fn a_month_of_any_length_owes_the_whole_charge() {
    // November has 30 days, December 31, February 28.
    let months = [
        ("2026-10-31T23:00:00Z", "2026-11-30T23:00:00Z"),
        ("2026-11-30T23:00:00Z", "2026-12-31T23:00:00Z"),
        ("2026-01-31T23:00:00Z", "2026-02-28T23:00:00Z"),
    ];

    for (from, to) in months {
        assert_eq!(sum(&sixteen(), from, to), "16.0000", "{from}");
    }
}

#[test]
fn a_day_owes_the_charge_by_its_share_of_the_month() {
    // 16 / 30 in November, 16 / 31 in December.
    assert_eq!(
        days(
            &sixteen(),
            "2026-11-29T23:00:00Z",
            "2026-12-01T23:00:00Z",
            "2027-01-01T00:00:00Z"
        ),
        [
            ("2026-11-29T23:00:00Z".to_owned(), "0.5333".to_owned()),
            ("2026-11-30T23:00:00Z".to_owned(), "0.5161".to_owned()),
        ]
    );
}

#[test]
fn a_range_across_a_month_boundary_owes_each_month_its_share() {
    // 29 and 30 November, 1 and 2 December: 2 × 16 / 30 + 2 × 16 / 31.
    assert_eq!(
        sum(&sixteen(), "2026-11-28T23:00:00Z", "2026-12-02T23:00:00Z"),
        "2.0989"
    );
}

#[test]
fn a_month_with_a_dst_change_still_owes_the_whole_charge() {
    // March 2026 has 743 hours, October 745.
    let march = ("2026-02-28T23:00:00Z", "2026-03-31T22:00:00Z");
    let october = ("2026-09-30T22:00:00Z", "2026-10-31T23:00:00Z");

    assert_eq!(sum(&sixteen(), march.0, march.1), "16.0000");
    assert_eq!(sum(&sixteen(), october.0, october.1), "16.0000");
}

#[test]
fn the_23_and_25_hour_days_owe_by_their_real_length() {
    // 28 March has 24 of March's 743 hours, 29 March 23; 25 October has 25 of October's 745.
    assert_eq!(
        days(
            &sixteen(),
            "2026-03-27T23:00:00Z",
            "2026-03-29T22:00:00Z",
            "2027-01-01T00:00:00Z"
        ),
        [
            ("2026-03-27T23:00:00Z".to_owned(), "0.5168".to_owned()),
            ("2026-03-28T23:00:00Z".to_owned(), "0.4953".to_owned()),
        ]
    );
    assert_eq!(
        days(
            &sixteen(),
            "2026-10-24T22:00:00Z",
            "2026-10-25T23:00:00Z",
            "2027-01-01T00:00:00Z"
        ),
        [("2026-10-24T22:00:00Z".to_owned(), "0.5369".to_owned())]
    );
}

#[test]
fn a_charge_is_owed_from_the_instant_its_version_applies() {
    // From noon on 10 November: half that day; then 31 EUR a month from 1 December.
    let versions = [
        charging("2026-11-10T11:00:00Z", 15.0),
        charging("2026-11-30T23:00:00Z", 31.0),
    ];

    assert_eq!(
        days(
            &versions,
            "2026-11-08T23:00:00Z",
            "2026-11-11T23:00:00Z",
            "2027-01-01T00:00:00Z"
        ),
        [
            ("2026-11-09T23:00:00Z".to_owned(), "0.2500".to_owned()),
            ("2026-11-10T23:00:00Z".to_owned(), "0.5000".to_owned()),
        ]
    );
    assert_eq!(
        sum(&versions, "2026-11-29T23:00:00Z", "2026-12-01T23:00:00Z"),
        "1.5000"
    );
}

#[test]
fn today_owes_up_to_now_and_a_later_day_nothing() {
    // Six of the 24 hours of 9 November, of November's 720.
    assert_eq!(
        days(
            &sixteen(),
            "2026-11-07T23:00:00Z",
            "2026-11-30T23:00:00Z",
            "2026-11-09T05:00:00Z"
        ),
        [
            ("2026-11-07T23:00:00Z".to_owned(), "0.5333".to_owned()),
            ("2026-11-08T23:00:00Z".to_owned(), "0.1333".to_owned()),
        ]
    );
}

#[test]
fn a_day_that_starts_before_the_range_is_left_out() {
    // From 12:00 on 1 November: the day starting on the 2nd is the first.
    assert_eq!(
        days(
            &sixteen(),
            "2026-11-01T11:00:00Z",
            "2026-11-02T23:00:00Z",
            "2027-01-01T00:00:00Z"
        ),
        [("2026-11-01T23:00:00Z".to_owned(), "0.5333".to_owned())]
    );
}

#[test]
fn a_tariff_without_a_charge_owes_no_day() {
    let free = [charging("2025-12-31T23:00:00Z", 0.0)];

    assert_eq!(
        days(
            &free,
            "2026-11-01T23:00:00Z",
            "2026-11-08T23:00:00Z",
            "2027-01-01T00:00:00Z"
        ),
        []
    );
}
