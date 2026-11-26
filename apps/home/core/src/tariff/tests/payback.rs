//! The payback forecast over plant-local days of savings, worked by hand.

use jiff::civil::{Date, date};

use super::super::payback::project;

/// `eur` saved every day from `from` to before `to`.
fn saving(from: Date, to: Date, eur: f64) -> Vec<(Date, f64)> {
    let mut out = Vec::new();
    let mut on = from;
    while on < to {
        out.push((on, eur));
        on = on.tomorrow().unwrap();
    }
    out
}

#[test]
fn the_savings_add_up_month_by_month() {
    let days = saving(date(2026, 1, 1), date(2026, 3, 6), 1.0);

    let p = project(&days, date(2026, 3, 5), Some(1000.0));

    assert_eq!(
        p.months,
        vec![
            (date(2026, 1, 31), 31.0),
            (date(2026, 2, 28), 59.0),
            (date(2026, 3, 5), 64.0)
        ]
    );
}

#[test]
fn the_pace_of_the_last_twelve_months_dates_the_payback() {
    // Two years at 2 EUR a day, then a year at 1: the last year's pace is 365 EUR.
    let mut days = saving(date(2023, 1, 1), date(2025, 1, 1), 2.0);
    days.extend(saving(date(2025, 1, 1), date(2026, 1, 1), 1.0));
    // Saved 731 × 2 + 365 = 1827 (2024 leaps); 365 to go at 365 a year.
    let p = project(&days, date(2026, 1, 1), Some(2192.0));

    assert_eq!(p.pace, Some(365.0));
    assert_eq!(p.reached, Some(date(2027, 1, 1)));
}

#[test]
fn a_young_plant_scales_its_pace_to_a_year() {
    // 100 days at 1 EUR: 100 / (100 / 365) = 365 a year.
    let days = saving(date(2026, 1, 1), date(2026, 4, 11), 1.0);

    let p = project(&days, date(2026, 4, 11), Some(465.0));

    assert_eq!(p.pace, Some(365.0));
    assert_eq!(p.reached, Some(date(2027, 4, 11)));
}

#[test]
fn under_three_months_of_record_has_no_pace() {
    let days = saving(date(2026, 1, 1), date(2026, 3, 1), 1.0);

    let p = project(&days, date(2026, 3, 1), Some(1000.0));

    assert_eq!((p.pace, p.reached), (None, None));
}

#[test]
fn no_date_without_an_investment_or_once_it_is_paid_back() {
    let days = saving(date(2025, 1, 1), date(2026, 1, 1), 1.0);

    assert_eq!(project(&days, date(2026, 1, 1), None).reached, None);
    assert_eq!(project(&days, date(2026, 1, 1), Some(100.0)).reached, None);
    assert_eq!(
        project(&days, date(2026, 1, 1), Some(100.0)).pace,
        Some(365.0)
    );
}
