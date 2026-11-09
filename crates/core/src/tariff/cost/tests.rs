//! Cost rates, worked by hand.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{Rates, replay};
use crate::storage::ChangePoint;
use crate::tariff::Prices;

/// To a hundredth of a cent per hour, zero unsigned.
fn cents(rates: Rates) -> [String; 3] {
    [rates.import, rates.export, rates.savings].map(|v| format!("{:.4}", v + 0.0))
}

const NIGHT: Prices = Prices {
    import: 0.30,
    export: 0.08,
};

#[test]
fn importing_pays_the_import_price_and_saves_nothing() {
    // 2 kW bought for a 2 kW house: 2 × 0.30.
    assert_eq!(
        cents(Rates::of(2000.0, 2000.0, NIGHT)),
        ["0.6000", "0.0000", "0.0000"]
    );
}

#[test]
fn feeding_in_earns_the_export_price_and_saves_what_the_house_did_not_buy() {
    // 3 kW fed in earns 3 × 0.08; the 1 kW house would have bought 1 × 0.30.
    assert_eq!(
        cents(Rates::of(-3000.0, 1000.0, NIGHT)),
        ["0.0000", "0.2400", "0.5400"]
    );
}

#[test]
fn a_negative_import_price_pays_the_plant_to_import() {
    let prices = Prices {
        import: -0.05,
        export: -0.02,
    };
    // Importing 4 kW at −0.05 earns 0.20 an hour; the 1 kW house alone would have earned 0.05.
    assert_eq!(
        cents(Rates::of(4000.0, 1000.0, prices)),
        ["-0.2000", "0.0000", "0.1500"]
    );
}

#[test]
fn a_negative_export_price_charges_for_feeding_in() {
    let prices = Prices {
        import: 0.10,
        export: -0.03,
    };
    // 2 kW fed in costs 2 × 0.03; the 0.5 kW house saves 0.5 × 0.10 = 0.05.
    assert_eq!(
        cents(Rates::of(-2000.0, 500.0, prices)),
        ["0.0000", "-0.0600", "-0.0100"]
    );
}

fn instant(minutes: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_800_000_000 + minutes * 60)
}

fn points(points: &[(u64, Option<f64>)]) -> Vec<ChangePoint> {
    points
        .iter()
        .map(|&(minute, value)| ChangePoint {
            time: instant(minute),
            value,
        })
        .collect()
}

#[test]
fn rates_change_with_each_input_and_a_gap_in_any_is_a_gap() {
    let grid = points(&[(0, Some(1000.0)), (20, Some(-2000.0)), (40, None)]);
    let load = points(&[(0, Some(1000.0))]);
    let import = points(&[(0, Some(0.30)), (10, Some(-0.05))]);
    let export = points(&[(0, Some(0.08))]);

    let rates: Vec<(SystemTime, Option<[String; 3]>)> =
        replay([&grid, &load, &import, &export], instant(5))
            .into_iter()
            .map(|(time, rates)| (time, rates.map(cents)))
            .collect();

    let cents = |values: [&str; 3]| Some(values.map(str::to_owned));
    assert_eq!(
        rates,
        [
            // The values in force before the start apply from it.
            (instant(5), cents(["0.3000", "0.0000", "0.0000"])),
            (instant(10), cents(["-0.0500", "0.0000", "0.0000"])),
            // 2 kW fed in earns 0.16; the house's 1 kW would have earned 0.05 bought.
            (instant(20), cents(["0.0000", "0.1600", "0.1100"])),
            (instant(40), None),
        ]
    );
}
