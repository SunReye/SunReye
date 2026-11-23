//! A year's run (ADR 17): each step's estimate, held for the step, summed by UTC month and over
//! the run. `estimate` is pinned to pvlib on its own, so it is the oracle here.

use super::fixtures::MODULE;
use crate::{
    AcSide, Energy, Input, Inverter, Layout, Location, Plane, PvString, Weather, clear_weather,
    estimate, year,
};

const QUARTER: i64 = 900;

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

/// Late morning there while it is midnight in UTC.
const SYDNEY: Location = Location {
    latitude: -33.87,
    longitude: 151.21,
};

fn string(azimuth: f64, modules: u16) -> PvString {
    let plane = Plane {
        tilt: 35.0,
        azimuth,
    };
    PvString::on_one_plane(MODULE, plane, modules, 0, 2.0)
}

/// Input 1: 16 south and 16 north in parallel; input 2: 14 south. A second inverter: 10 west.
fn plant(location: Location) -> Layout {
    Layout {
        location,
        inverters: vec![
            Inverter {
                inputs: vec![
                    Input {
                        limits: None,
                        strings: vec![string(0.0, 16), string(180.0, 16)],
                    },
                    Input {
                        limits: None,
                        strings: vec![string(0.0, 14)],
                    },
                ],
                ac: None,
            },
            Inverter {
                inputs: vec![Input {
                    limits: None,
                    strings: vec![string(90.0, 10)],
                }],
                ac: None,
            },
        ],
        occluders: Vec::new(),
    }
}

/// Seconds since 1970 of a UTC date and time.
fn utc(year: i64, month: i64, day: i64, hour: i64, minute: i64) -> i64 {
    // Hinnant's days-from-civil.
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let of_era = y - era * 400;
    let of_year = (153 * m + 2) / 5 + day - 1;
    let days = era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468;
    days * 86_400 + hour * 3600 + minute * 60
}

fn assert_near(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 1e-9 * expected.abs().max(1.0),
        "{what}: {actual} != {expected}"
    );
}

#[test]
fn a_step_holds_its_estimate_for_the_step_in_its_month() {
    let layout = plant(BERLIN);
    let june = clear_weather(utc(2026, 6, 21, 11, 0), BERLIN);

    let run = year(&layout, &[june], QUARTER);

    let at = estimate(&layout, &june);
    let inverter = &run.inverters[0];
    let south = at.inverters[0].inputs[0].strings[0];
    assert!(south > 1000.0, "a bright June noon: {south} W");
    let months = inverter.inputs[0].strings[0].months;
    assert_near(months[5], south / 4.0, "south in June");
    assert!(
        months
            .iter()
            .enumerate()
            .all(|(m, &wh)| m == 5 || wh == 0.0),
        "{months:?}"
    );
    assert_near(inverter.inputs[0].strings[0].total, south / 4.0, "south");
    assert_near(
        inverter.dc.total,
        at.inverters[0].power / 4.0,
        "the first inverter",
    );
    assert_near(
        run.inverters[1].dc.total,
        at.inverters[1].power / 4.0,
        "the second inverter",
    );
}

#[test]
fn months_are_utc_and_february_has_its_leap_day() {
    let layout = plant(SYDNEY);
    let samples = [
        utc(2026, 1, 31, 23, 45),
        utc(2026, 2, 1, 0, 0),
        utc(2028, 2, 29, 1, 0),
        utc(2028, 3, 1, 1, 0),
        utc(2026, 12, 31, 23, 45),
    ]
    .map(|unix| clear_weather(unix, SYDNEY));

    let run = year(&layout, &samples, QUARTER);

    let wh = |w: &Weather| estimate(&layout, w).inverters[0].power / 4.0;
    let months = run.inverters[0].dc.months;
    assert_near(months[0], wh(&samples[0]), "January");
    assert_near(months[1], wh(&samples[1]) + wh(&samples[2]), "February");
    assert_near(months[2], wh(&samples[3]), "March");
    assert_near(months[11], wh(&samples[4]), "December");
    assert!(months[3..11].iter().all(|&m| m == 0.0), "{months:?}");
}

#[test]
fn strings_sum_to_their_input_inputs_to_their_inverter_and_months_to_the_total() {
    let layout = plant(BERLIN);
    // Every quarter hour of three days in spring, summer and winter.
    let days = [
        utc(2026, 3, 20, 0, 0),
        utc(2026, 7, 2, 0, 0),
        utc(2026, 12, 5, 0, 0),
    ];
    let samples: Vec<Weather> = days
        .iter()
        .flat_map(|day| (0..96).map(move |q| day + q * QUARTER))
        .map(|unix| clear_weather(unix, BERLIN))
        .collect();

    let run = year(&layout, &samples, QUARTER);

    let sum =
        |energies: &mut dyn Iterator<Item = &Energy>| -> f64 { energies.map(|e| e.total).sum() };
    for (i, inverter) in run.inverters.iter().enumerate() {
        for (j, input) in inverter.inputs.iter().enumerate() {
            assert_near(
                sum(&mut input.strings.iter()),
                input.energy.total,
                &format!("inverter {i} input {j}"),
            );
        }
        assert_near(
            sum(&mut inverter.inputs.iter().map(|input| &input.energy)),
            inverter.dc.total,
            &format!("inverter {i}"),
        );
        assert_near(
            inverter.dc.months.iter().sum(),
            inverter.dc.total,
            &format!("inverter {i}'s months"),
        );
    }
    let months = run.inverters[0].dc.months;
    assert!(
        months[2] > 0.0 && months[6] > months[2] && months[11] > 0.0,
        "{months:?}"
    );
}

#[test]
fn a_night_yields_nothing() {
    let layout = plant(BERLIN);
    let night: Vec<Weather> = (0..8)
        .map(|q| clear_weather(utc(2026, 6, 21, 22, 0) + q * QUARTER, BERLIN))
        .collect();

    let run = year(&layout, &night, QUARTER);

    assert!(run.inverters.iter().all(|i| i.dc.total == 0.0));
    assert_eq!(run.inverters[0].inputs[0].strings[1].months, [0.0; 12]);
}

/// A bright June noon in Berlin, and the first inverter's DC watts then.
fn noon() -> (Weather, f64) {
    let june = clear_weather(utc(2026, 6, 21, 11, 0), BERLIN);
    let dc = estimate(&plant(BERLIN), &june).inverters[0].power;
    assert!(dc > 5000.0, "{dc} W");
    (june, dc)
}

/// The first inverter typed at 96 %, rated so that `dc` watts load it to `load` of its DC rating.
fn typed(dc: f64, load: f64) -> Layout {
    let mut layout = plant(BERLIN);
    layout.inverters[0].ac = Some(AcSide {
        rating: 0.96 * dc / load,
        efficiency: 96.0,
    });
    layout
}

#[test]
fn ac_is_below_dc_by_the_efficiency_curve() {
    let (june, dc) = noon();
    // pvlib's `inverter.pvwatts` at 96 %: (−0.0162 ζ − 0.0059 / ζ + 0.9858) / 0.9637 of 96 %.
    for (load, curve) in [(0.1, 0.925_18), (0.5, 0.965_9), (0.99, 0.963_802_404_04)] {
        let run = year(&typed(dc, load), &[june], QUARTER);

        let inverter = &run.inverters[0];
        let ac = inverter
            .ac
            .as_ref()
            .expect("a typed inverter has an AC side");
        let expected = dc * 0.96 * curve / 0.9637 / 4.0;
        assert_near(ac.energy.total, expected, &format!("at {load}"));
        assert_near(ac.energy.months[5], ac.energy.total, "June");
        assert_eq!(ac.clipped.total, 0.0, "at {load}");
        assert_near(inverter.dc.total, dc / 4.0, "DC stays the inputs' sum");
    }
}

#[test]
fn power_above_the_ac_rating_is_clipped_and_reported() {
    let (june, dc) = noon();
    let morning = clear_weather(utc(2026, 6, 21, 4, 0), BERLIN);
    // Twice its DC rating at noon: the curve gives (−0.0324 − 0.00295 + 0.9858) / 0.9637 of 96 %.
    let layout = typed(dc, 2.0);
    let rating = 0.48 * dc;

    let run = year(&layout, &[june, morning], QUARTER);

    let ac = run.inverters[0].ac.as_ref().expect("typed");
    let at_noon = dc * 0.96 * 0.950_45 / 0.9637;
    let at_morning = estimate(&layout, &morning).inverters[0].power;
    assert!(
        at_morning > 0.0 && at_morning < rating,
        "the morning stays under the rating: {at_morning} W"
    );
    assert_near(
        ac.clipped.total,
        (at_noon - rating) / 4.0,
        "clipped at noon",
    );
    assert!(
        ac.energy.total > rating / 4.0 && ac.energy.total < (rating + at_morning) / 4.0,
        "noon at the rating, the morning below DC: {}",
        ac.energy.total
    );
    assert_near(ac.clipped.months[5], ac.clipped.total, "clipped in June");
    assert!(
        run.inverters[1].ac.is_none(),
        "an untyped inverter has no AC side"
    );
}

#[test]
fn an_inverter_without_a_type_computes_as_before() {
    let (june, dc) = noon();
    let untyped = year(&plant(BERLIN), &[june], QUARTER);
    let typed = year(&typed(dc, 2.0), &[june], QUARTER);

    assert!(untyped.inverters.iter().all(|i| i.ac.is_none()));
    assert_near(untyped.inverters[0].dc.total, dc / 4.0, "DC");
    for (untyped, typed) in untyped.inverters.iter().zip(&typed.inverters) {
        assert_eq!(untyped.dc, typed.dc, "the type leaves DC as it was");
        assert_eq!(untyped.inputs, typed.inputs);
    }
}

#[test]
fn a_load_too_small_for_the_curve_yields_no_ac() {
    let (june, dc) = noon();
    // Under 0.0059 / 0.9858 of its DC rating the curve's efficiency is negative.
    let run = year(&typed(dc, 0.001), &[june], QUARTER);

    let ac = run.inverters[0].ac.as_ref().expect("typed");
    assert_eq!(ac.energy.total, 0.0);
    assert_eq!(ac.clipped.total, 0.0);
}
