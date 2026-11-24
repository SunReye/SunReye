//! The loss chain (ADR 17): a year's run carries the energy after each loss, from irradiation on
//! the planes to the energy each inverter delivers, every loss named.

use super::fixtures::MODULE;
use crate::{
    AcCable, AcSide, Cable, Chain, Energy, Horizon, Input, Inverter, Layout, Location, Loss,
    Module, MpptLimits, Occluder, Place, Plane, PvString, RunInputs, ShadingTable, Warranty,
    Weather, Year, clear_weather, estimate, irradiation, year, year_run,
};

const QUARTER: i64 = 900;

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

/// 2026-06-21 and 2026-12-21, 00:00 UTC.
const JUNE_21: i64 = 1_782_000_000;
const DECEMBER_21: i64 = 1_797_811_200;

fn string(azimuth: f64, modules: u16) -> PvString {
    let plane = Plane {
        tilt: 35.0,
        azimuth,
    };
    PvString::on_one_plane(MODULE, plane, modules, 0, 2.0)
}

/// 16 south and 16 north in parallel on one input, 14 south on another; a second inverter with
/// 10 west.
fn plant() -> Layout {
    Layout {
        location: BERLIN,
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

/// Clear quarter hours of a summer and a winter day.
fn days() -> Vec<Weather> {
    [JUNE_21, DECEMBER_21]
        .iter()
        .flat_map(|day| (0..96).map(move |q| day + q * QUARTER))
        .map(|unix| clear_weather(unix, BERLIN))
        .collect()
}

fn assert_near(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 1e-9 * expected.abs().max(1.0),
        "{what}: {actual} != {expected}"
    );
}

fn ids(chain: &Chain) -> Vec<Loss> {
    chain.steps.iter().map(|step| step.loss).collect()
}

/// The datasheet watts of the `inverter`th inverter's modules.
fn peak_watts(layout: &Layout, inverter: usize) -> f64 {
    layout.inverters[inverter]
        .inputs
        .iter()
        .flat_map(|input| &input.strings)
        .map(|s| s.module.vmp * s.module.imp * f64::from(u32::try_from(s.modules.len()).unwrap()))
        .sum()
}

#[test]
fn the_chain_runs_from_the_planes_to_the_dc_sum_with_only_what_was_computed() {
    let layout = plant();
    let weather = days();

    let run = year(&layout, &weather, QUARTER);

    for (k, inverter) in run.inverters.iter().enumerate() {
        let chain = &inverter.chain;
        let mut alone = layout.clone();
        alone.inverters = vec![layout.inverters[k].clone()];
        assert_near(
            chain.planes.total,
            irradiation(&alone, &weather, QUARTER) * peak_watts(&layout, k) / 1000.0,
            "the planes' irradiation at the datasheet's efficiency",
        );
        assert_eq!(
            chain.end(),
            inverter.dc,
            "an untyped inverter's chain ends at DC"
        );
        assert_eq!(
            ids(chain),
            [
                Loss::Incidence,
                Loss::IrradianceLevel,
                Loss::Temperature,
                Loss::String,
                Loss::Mismatch,
            ],
            "no horizon, scene, soiling, limits, cable or AC side: those losses are absent"
        );
    }
}

#[test]
fn the_losses_sum_to_the_whole_and_their_factors_multiply_to_it() {
    let run = year(&plant(), &days(), QUARTER);
    let chain = &run.inverters[0].chain;

    let losses = chain.losses();
    for month in 0..12 {
        let lost: f64 = losses.iter().map(|(_, e)| e.months[month]).sum();
        assert_near(
            lost,
            chain.planes.months[month] - chain.end().months[month],
            &format!("month {month}"),
        );
    }
    let lost: f64 = losses.iter().map(|(_, e)| e.total).sum();
    assert_near(lost, chain.planes.total - chain.end().total, "the year");
    let factors: f64 = chain.factors().iter().map(|(_, f)| f).product();
    assert_near(
        factors,
        chain.end().total / chain.planes.total,
        "the factors",
    );
    let incidence = losses[0].1.total / chain.planes.total;
    assert!(
        (0.01..0.08).contains(&incidence),
        "glass reflects a few % in a year: {incidence}"
    );
    let string = &losses[3];
    assert_eq!(string.0, Loss::String);
    let before = chain.steps[2].after.total;
    assert_near(
        string.1.total,
        before * 0.02,
        "the string's 2 % on its current",
    );
}

#[test]
fn a_hot_day_loses_more_to_temperature_than_a_cold_one() {
    let layout = plant();
    let hot: Vec<Weather> = days()
        .into_iter()
        .map(|w| Weather {
            temperature: 35.0,
            ..w
        })
        .collect();
    let cold: Vec<Weather> = hot
        .iter()
        .map(|w| Weather {
            temperature: -10.0,
            ..*w
        })
        .collect();

    let temperature = |weather: &[Weather]| {
        let chain = year(&layout, weather, QUARTER).inverters[0].chain.clone();
        chain
            .losses()
            .into_iter()
            .find(|(loss, _)| *loss == Loss::Temperature)
            .map(|(_, e)| e.total)
            .unwrap()
    };

    let (hot, cold) = (temperature(&hot), temperature(&cold));
    assert!(hot > 0.0, "{hot}");
    assert!(cold < 0.0, "cells under 25 °C gain: {cold}");
}

#[test]
fn every_loss_has_a_stable_id_and_its_names() {
    let named: Vec<_> = Loss::ALL.iter().map(|l| (l.id(), l.en(), l.de())).collect();

    assert_eq!(
        named,
        [
            ("horizon", "Horizon", "Horizont"),
            ("beam_shading", "Beam shading", "Verschattung direkt"),
            ("diffuse_shading", "Diffuse shading", "Verschattung diffus"),
            ("incidence", "Incidence angle", "Einfallswinkel"),
            ("soiling", "Soiling", "Verschmutzung"),
            (
                "irradiance_level",
                "Irradiance level",
                "Einstrahlungsniveau"
            ),
            ("temperature", "Temperature", "Temperatur"),
            ("string", "String loss", "Strangverlust"),
            ("mismatch", "Mismatch", "Fehlanpassung"),
            ("mppt_limits", "MPPT limits", "MPPT-Grenzen"),
            ("dc_cable", "DC cable", "DC-Leitung"),
            (
                "inverter",
                "Inverter efficiency",
                "Wechselrichter-Wirkungsgrad"
            ),
            ("clipping", "Clipping", "Kappung am Wechselrichter"),
            ("ac_cable", "AC cable", "AC-Leitung"),
        ]
    );
}

fn find(chain: &Chain, loss: Loss) -> Energy {
    chain
        .losses()
        .into_iter()
        .find(|(l, _)| *l == loss)
        .map_or_else(|| panic!("{loss:?} is in the chain"), |(_, e)| e)
}

fn after(chain: &Chain, loss: Loss) -> Energy {
    chain
        .steps
        .iter()
        .find(|step| step.loss == loss)
        .map_or_else(|| panic!("{loss:?} is in the chain"), |step| step.after)
}

fn run(layout: &Layout, inputs: &RunInputs, weather: &[Weather]) -> Year {
    year_run(
        layout,
        &mut ShadingTable::default(),
        inputs,
        weather,
        QUARTER,
    )
}

/// The first inverter typed at 96 %, rated at half its June noon's DC, so it clips.
fn typed() -> Layout {
    let mut layout = plant();
    let noon = clear_weather(JUNE_21 + 11 * 3600, BERLIN);
    let dc = estimate(&layout, &noon).inverters[0].power;
    layout.inverters[0].ac = Some(AcSide {
        rating: 0.5 * dc,
        efficiency: 96.0,
    });
    layout
}

#[test]
fn a_typed_inverter_s_chain_ends_at_its_ac_energy_through_its_curve_and_its_clipping() {
    let run = year(&typed(), &days(), QUARTER);

    let inverter = &run.inverters[0];
    let ac = inverter.ac.expect("typed");
    let chain = &inverter.chain;
    assert_eq!(chain.end(), ac.energy);
    assert_eq!(&ids(chain)[5..], [Loss::Inverter, Loss::Clipping]);
    assert_near(
        find(chain, Loss::Clipping).total,
        ac.clipped.total,
        "clipped",
    );
    assert!(ac.clipped.total > 0.0);
    assert_near(
        find(chain, Loss::Inverter).total,
        inverter.dc.total - ac.energy.total - ac.clipped.total,
        "the curve",
    );
    assert_eq!(
        ids(&run.inverters[1].chain).last(),
        Some(&Loss::Mismatch),
        "the untyped one ends at DC"
    );
}

#[test]
fn the_plant_s_chain_adds_its_inverters_over_the_losses_all_of_them_have() {
    let run = year(&typed(), &days(), QUARTER);

    let plant = run.chain();

    assert_eq!(ids(&plant), ids(&run.inverters[1].chain));
    assert_near(
        plant.planes.total,
        run.inverters[0].chain.planes.total + run.inverters[1].chain.planes.total,
        "the planes",
    );
    assert_near(
        plant.end().total,
        run.inverters[0].dc.total + run.inverters[1].dc.total,
        "the plant's DC",
    );
    let mut both = typed();
    both.inverters[1].ac = both.inverters[0].ac;
    let typed_both = year(&both, &days(), QUARTER);
    assert_eq!(ids(&typed_both.chain()).last(), Some(&Loss::Clipping));
}

/// Ten modules south at 35° in a row, a pole due south of them.
fn shaded() -> Layout {
    let modules = (0..10)
        .map(|m| Module {
            plane: Plane {
                tilt: 35.0,
                azimuth: 0.0,
            },
            optimized: false,
            place: Some(Place {
                centre: [1.2 * f64::from(m), 0.0, 5.0],
                landscape: false,
            }),
        })
        .collect();
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![Input {
                limits: None,
                strings: vec![PvString {
                    module: MODULE,
                    modules,
                    loss: 2.0,
                }],
            }],
            ac: None,
        }],
        occluders: vec![Occluder::Cylinder {
            base: [5.0, -4.0, 0.0],
            radius: 0.3,
            height: 12.0,
        }],
    }
}

/// One pair per degree from −180 going east, each elevation `at`.
fn uniform(at: f64) -> Horizon {
    let profile: Vec<[f64; 2]> = (-180..180).map(|a| [f64::from(a), at]).collect();
    Horizon::new(&profile).unwrap()
}

#[test]
fn a_horizon_and_the_scene_take_beam_and_diffuse_light_each_as_its_own_loss() {
    let layout = shaded();
    let hills = uniform(10.0);
    let inputs = RunInputs {
        horizon: Some(&hills),
        ..RunInputs::default()
    };

    let year = run(&layout, &inputs, &days());

    let chain = &year.inverters[0].chain;
    assert_eq!(
        &ids(chain)[..4],
        [
            Loss::Horizon,
            Loss::BeamShading,
            Loss::DiffuseShading,
            Loss::Incidence
        ]
    );
    for loss in [Loss::Horizon, Loss::BeamShading, Loss::DiffuseShading] {
        let lost = find(chain, loss).total / chain.planes.total;
        assert!(lost > 0.0005 && lost < 0.3, "{loss:?}: {lost}");
    }
    assert_eq!(chain.end(), year.inverters[0].dc);
    let open = run(&layout, &RunInputs::default(), &days());
    assert_eq!(
        open.inverters[0].chain.planes, chain.planes,
        "the planes' irradiation is before the horizon"
    );
}

#[test]
fn soiling_takes_its_share_of_the_light_through_the_glass_and_lowers_the_yield() {
    let layout = plant();
    let soiled = RunInputs {
        soiling: Some(3.0),
        ..RunInputs::default()
    };

    let clean = run(&layout, &RunInputs::default(), &days());
    let dirty = run(&layout, &soiled, &days());

    let chain = &dirty.inverters[0].chain;
    assert_eq!(&ids(chain)[..2], [Loss::Incidence, Loss::Soiling]);
    assert_near(
        find(chain, Loss::Soiling).total,
        0.03 * after(chain, Loss::Incidence).total,
        "3 % of the light",
    );
    assert_eq!(clean.inverters[0].chain.planes, chain.planes);
    let (clean, dirty) = (clean.inverters[0].dc.total, dirty.inverters[0].dc.total);
    assert!(
        dirty < 0.98 * clean && dirty > 0.96 * clean,
        "{dirty} of {clean}"
    );
}

#[test]
fn an_input_s_limits_take_what_its_free_peak_would_have_given() {
    let mut limited = plant();
    let free = run(&limited, &RunInputs::default(), &days());
    limited.inverters[0].inputs[1].limits = Some(MpptLimits {
        max_current: 6.0,
        min_voltage: 200.0,
        max_voltage: 800.0,
        start_voltage: 250.0,
    });

    let capped = run(&limited, &RunInputs::default(), &days());

    let chain = &capped.inverters[0].chain;
    assert_eq!(ids(chain).last(), Some(&Loss::MpptLimits));
    assert_near(
        after(chain, Loss::Mismatch).total,
        free.inverters[0].dc.total,
        "the free peaks",
    );
    assert!(find(chain, Loss::MpptLimits).total > 0.01 * chain.end().total);
    assert_eq!(
        ids(&capped.inverters[1].chain).last(),
        Some(&Loss::MpptLimits),
        "a loss the plant computes is in every inverter's chain"
    );
}

#[test]
fn a_dc_cable_loses_its_resistance_times_the_string_s_current_squared() {
    let layout = plant();
    let noon = clear_weather(JUNE_21 + 11 * 3600, BERLIN);
    let at = estimate(&layout, &noon);
    let cable = Cable {
        length: 25.0,
        cross_section: 4.0,
    };
    let cables = RunInputs {
        dc_cables: vec![None, None, Some(cable)],
        ..RunInputs::default()
    };

    let year = run(&layout, &cables, &[noon]);

    let input = &at.inverters[0].inputs[1];
    let amperes = input.strings[0] / input.voltage;
    // Out and back, 50 m of 4 mm² copper at 56 m/(Ω·mm²).
    let watts = 50.0 / (56.0 * 4.0) * amperes * amperes;
    let chain = &year.inverters[0].chain;
    assert_eq!(ids(chain).last(), Some(&Loss::DcCable));
    assert_near(find(chain, Loss::DcCable).total, watts / 4.0, "the cable");
    assert!(watts > 5.0 && watts < 0.02 * input.power, "{watts} W");
    let inverter = &year.inverters[0];
    assert_eq!(chain.end(), inverter.dc);
    assert_near(
        inverter.inputs[1].strings[0].total,
        inverter.inputs[1].energy.total,
        "a string still sums to its input",
    );
    assert_near(
        inverter.inputs[1].energy.total,
        (input.power - watts) / 4.0,
        "the input past the cable",
    );
}

#[test]
fn an_ac_cable_loses_its_resistance_times_the_current_squared_in_each_conductor() {
    let layout = typed();
    let morning = clear_weather(JUNE_21 + 7 * 3600, BERLIN);
    let cable = Cable {
        length: 30.0,
        cross_section: 2.5,
    };
    for (three_phase, conductors, volts) in [(true, 3.0, 3f64.sqrt() * 400.0), (false, 2.0, 230.0)]
    {
        let inputs = RunInputs {
            ac_cables: vec![Some(AcCable { cable, three_phase })],
            ..RunInputs::default()
        };

        let year = run(&layout, &inputs, &[morning]);

        let inverter = &year.inverters[0];
        let ac = inverter.ac.expect("typed").energy.total * 4.0;
        let amperes = ac / volts;
        let watts = conductors * 30.0 / (56.0 * 2.5) * amperes * amperes;
        let chain = &inverter.chain;
        assert_eq!(ids(chain).last(), Some(&Loss::AcCable));
        assert_near(find(chain, Loss::AcCable).total, watts / 4.0, "the cable");
        assert!(watts > 1.0 && watts < 0.06 * ac, "{watts} W of {ac} W");
        assert_eq!(
            ids(&year.inverters[1].chain).last(),
            Some(&Loss::Mismatch),
            "the untyped one has no AC side, so no AC cable"
        );
    }
}

#[test]
fn degradation_gives_each_later_year_by_the_warranted_power_s_mean_over_it() {
    // A common linear warranty: 98 % after the first year, then 0.55 % less each year.
    let warranty = Warranty {
        first_year: 2.0,
        yearly: 0.55,
    };

    let yields = warranty.yields(10_000.0, 25);

    assert_eq!(yields.len(), 25);
    // The first year runs from 100 % to 98 %, the second from 98 % to 97.45 %.
    assert_near(yields[0], 9900.0, "the first year");
    assert_near(yields[1], 9772.5, "the second year");
    // The 25th from 85.35 % to 84.8 %.
    assert_near(yields[24], 8507.5, "the 25th year");
}

#[test]
fn a_warranty_never_takes_a_year_below_nothing() {
    let warranty = Warranty {
        first_year: 50.0,
        yearly: 30.0,
    };

    let yields = warranty.yields(1000.0, 4);

    // 100 % to 50 %, to 20 %, to nothing, and nothing.
    for (year, expected) in yields.iter().zip([750.0, 350.0, 100.0, 0.0]) {
        assert_near(*year, expected, "a year");
    }
}

#[test]
fn a_lone_evenly_lit_string_loses_nothing_to_mismatch_and_parallel_planes_do() {
    let mut lone = plant();
    lone.inverters.truncate(1);
    lone.inverters[0].inputs = vec![Input {
        limits: None,
        strings: vec![string(0.0, 14)],
    }];
    let mut mixed = lone.clone();
    mixed.inverters[0].inputs[0].strings.push(string(180.0, 14));

    let mismatch = |layout: &Layout| {
        let chain = year(layout, &days(), QUARTER).inverters[0].chain.clone();
        find(&chain, Loss::Mismatch).total / chain.end().total
    };

    let (lone, mixed) = (mismatch(&lone), mismatch(&mixed));
    assert!(lone.abs() < 1e-9, "{lone}");
    assert!(mixed > 1e-4, "south and north share one voltage: {mixed}");
}

#[test]
fn strings_without_a_loss_of_their_own_leave_it_out() {
    let mut layout = plant();
    for string in layout
        .inverters
        .iter_mut()
        .flat_map(|inverter| &mut inverter.inputs)
        .flat_map(|input| &mut input.strings)
    {
        string.loss = 0.0;
    }

    let run = year(&layout, &days(), QUARTER);

    assert!(!ids(&run.inverters[0].chain).contains(&Loss::String));
    assert!(!ids(&run.inverters[1].chain).contains(&Loss::String));
}
