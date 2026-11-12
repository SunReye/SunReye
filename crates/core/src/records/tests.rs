//! Years and records over plant-local days, worked by hand.

use jiff::civil::{Date, date};

use super::{Best, Day, Figures, records};

fn day(on: Date, pv: f64, saved: Option<f64>) -> Day {
    Day {
        date: on,
        figures: Figures {
            production: pv,
            consumption: 10.0,
            self_supply: 5.0,
            saved,
        },
    }
}

/// Every day from `from` to before `to`, producing `pv(date)` kWh and saving 1 EUR.
fn days(from: Date, to: Date, pv: impl Fn(Date) -> f64) -> Vec<Day> {
    let mut out = Vec::new();
    let mut on = from;
    while on < to {
        out.push(day(on, pv(on), Some(1.0)));
        on = on.tomorrow().unwrap();
    }
    out
}

#[test]
fn each_year_sums_its_days_newest_first_the_running_one_against_the_same_days_before() {
    let list = days(date(2025, 3, 1), date(2026, 3, 11), |_| 2.0);

    let found = records(&list, date(2026, 3, 10));

    assert_eq!(found.years.len(), 2);
    let [running, closed] = [&found.years[0], &found.years[1]];
    assert_eq!((running.year, running.running), (2026, true));
    // 1 January to 10 March: 69 days.
    assert_eq!(running.figures.production, 138.0);
    assert_eq!(running.figures.consumption, 690.0);
    assert_eq!(running.figures.self_supply, 345.0);
    assert_eq!(running.figures.saved, Some(69.0));
    // 2025 was recorded from 1 to 10 March only.
    assert_eq!(running.before.as_ref().unwrap().production, 20.0);
    assert_eq!((closed.year, closed.running), (2025, false));
    assert_eq!(closed.figures.production, 612.0);
    assert!(closed.before.is_none());
}

#[test]
fn a_year_without_cost_days_has_no_savings() {
    let list = vec![day(date(2026, 5, 1), 3.0, None)];

    assert_eq!(
        records(&list, date(2026, 5, 2)).years[0].figures.saved,
        None
    );
}

#[test]
fn the_bests_count_only_closed_days_and_months() {
    let mut list = days(date(2026, 4, 1), date(2026, 6, 11), |on| {
        if on.month() == 5 { 3.0 } else { 2.0 }
    });
    // Today, 10 June, is not closed: its record would move.
    list.last_mut().unwrap().figures.production = 99.0;
    list[20].figures.production = 40.0;
    list[30].figures.saved = Some(7.5);

    let found = records(&list, date(2026, 6, 10));

    assert_eq!(
        found.best_day,
        Some(Best {
            date: date(2026, 4, 21),
            value: 40.0
        })
    );
    // April's 29 × 2 + 40 beats May's 31 × 3; June is not closed.
    assert_eq!(
        found.best_month,
        Some(Best {
            date: date(2026, 4, 1),
            value: 98.0
        })
    );
    assert_eq!(
        found.best_saving,
        Some(Best {
            date: date(2026, 5, 1),
            value: 7.5
        })
    );
}

#[test]
fn nothing_recorded_has_no_years_and_no_records() {
    let found = records(&[], date(2026, 6, 10));

    assert_eq!(found.years, []);
    assert_eq!(
        (found.best_day, found.best_month, found.best_saving),
        (None, None, None)
    );
}
