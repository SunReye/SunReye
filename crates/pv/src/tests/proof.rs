//! The proof against pvlib (ADR 17): four plants run over one year of weather, their
//! energy computed offline by `fixtures/proof.py` and committed. Write-up: `docs/pv-proof.md`.
//!
//! pvlib knows no scene, so shade comes from two long obstacles it can model in two dimensions:
//! a wall south of a roof and the row in front in a field of rows.

use super::fixtures::{MODULE, rows};
use crate::{
    Energy, Input, Inverter, Layout, Location, Module, MpptLimits, Occluder, Place, Plane, Point,
    PvString, Weather, year,
};

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};
const HOUR: i64 = 3600;
/// Half the length of a wall or row that stands for an endless one, in metres.
const ENDLESS: f64 = 300.0;
/// Between modules side by side, in metres.
const GAP: f64 = 0.02;

/// The plants, by the names the fixture gives them.
const PLANTS: [&str; 4] = ["open_roof", "shaded_roof", "east_west", "rack_field"];

/// How far each plant's yearly energy may stand from pvlib's, as a share of it (ADR 17).
fn tolerance(plant: &str) -> f64 {
    match plant {
        "open_roof" | "east_west" => 0.001,
        "shaded_roof" | "rack_field" => 0.01,
        _ => panic!("unknown plant {plant}"),
    }
}

fn weather() -> Vec<Weather> {
    rows(include_str!("../../fixtures/proof-weather.csv"))
        .iter()
        .map(|row| Weather {
            unix: row.get("unix"),
            ghi: row.get("ghi"),
            dni: row.get("dni"),
            dhi: row.get("dhi"),
            temperature: row.get("temperature"),
            wind: Some(row.get("wind")),
        })
        .collect()
}

fn one_input(
    strings: Vec<PvString>,
    limits: Option<MpptLimits>,
    occluders: Vec<Occluder>,
) -> Layout {
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![Input { limits, strings }],
            ac: None,
        }],
        occluders,
    }
}

/// 16 modules facing south at 35°, nothing around them.
fn open_roof() -> Layout {
    let plane = Plane {
        tilt: 35.0,
        azimuth: 0.0,
    };
    one_input(
        vec![PvString::on_one_plane(MODULE, plane, 16, 0, 0.0)],
        None,
        Vec::new(),
    )
}

/// 10 modules facing east and 10 facing west at 20°, in parallel on one input.
fn east_west() -> Layout {
    let string = |azimuth| {
        let plane = Plane {
            tilt: 20.0,
            azimuth,
        };
        PvString::on_one_plane(MODULE, plane, 10, 0, 0.0)
    };
    let limits = MpptLimits {
        max_current: 30.0,
        min_voltage: 150.0,
        max_voltage: 850.0,
        start_voltage: 180.0,
    };
    one_input(vec![string(-90.0), string(90.0)], Some(limits), Vec::new())
}

/// An endless rectangle along x: its foot on the ground at `y`, its top `top` metres up and
/// `lean` metres north of its foot.
fn panel(y: f64, lean: f64, top: f64) -> [Occluder; 2] {
    let at = |x: f64, up: bool| -> Point { if up { [x, y + lean, top] } else { [x, y, 0.0] } };
    [
        Occluder::Triangle([at(-ENDLESS, false), at(ENDLESS, false), at(ENDLESS, true)]),
        Occluder::Triangle([at(-ENDLESS, false), at(ENDLESS, true), at(-ENDLESS, true)]),
    ]
}

/// Modules in a row along x on `plane`, their lower edge at `foot` metres up the slope from the
/// origin.
fn row(plane: Plane, count: u16, landscape: bool, foot: f64) -> Vec<Module> {
    let (across, up) = if landscape {
        (MODULE.height, MODULE.width)
    } else {
        (MODULE.width, MODULE.height)
    };
    let (rise, run) = (plane.tilt.to_radians().sin(), plane.tilt.to_radians().cos());
    let middle = foot + up / 2.0;
    (0..count)
        .map(|m| Module {
            plane,
            optimized: false,
            place: Some(Place {
                centre: [(across + GAP) * f64::from(m), middle * run, middle * rise],
                landscape,
            }),
        })
        .collect()
}

const WALL_HEIGHT: f64 = 4.0;
const WALL_DISTANCE: f64 = 8.0;

/// 16 modules facing south at 35° in portrait, two rows of 8 in one string, and a wall 4 m tall
/// 8 m south of the lower row's edge. It shades the lower row's every substring at once through
/// the winter, the upper row less.
fn shaded_roof() -> Layout {
    let plane = Plane {
        tilt: 35.0,
        azimuth: 0.0,
    };
    let modules = [
        row(plane, 8, false, 0.0),
        row(plane, 8, false, MODULE.height),
    ]
    .concat();
    let string = PvString {
        module: MODULE,
        modules,
        loss: 0.0,
    };
    one_input(
        vec![string],
        None,
        panel(-WALL_DISTANCE, 0.0, WALL_HEIGHT).into(),
    )
}

const RACK_TILT: f64 = 25.0;
const PITCH: f64 = 2.5;

/// 16 modules facing south at 25° in landscape, one row of a field of rows 2.5 m apart: the row in
/// front shades its lowest substrings first.
fn rack_field() -> Layout {
    let plane = Plane {
        tilt: RACK_TILT,
        azimuth: 0.0,
    };
    let string = PvString {
        module: MODULE,
        modules: row(plane, 16, true, 0.0),
        loss: 0.0,
    };
    let (rise, run) = (RACK_TILT.to_radians().sin(), RACK_TILT.to_radians().cos());
    let front = panel(-PITCH, MODULE.width * run, MODULE.width * rise);
    one_input(vec![string], None, front.into())
}

fn layout(plant: &str) -> Layout {
    match plant {
        "open_roof" => open_roof(),
        "shaded_roof" => shaded_roof(),
        "east_west" => east_west(),
        "rack_field" => rack_field(),
        _ => panic!("unknown plant {plant}"),
    }
}

/// pvlib's energy of one series: `input`, or `string<n>` on it.
fn pvlib(plant: &str, series: &str) -> Energy {
    let fixture = rows(include_str!("../../fixtures/proof.csv"));
    let row = fixture
        .iter()
        .find(|row| row.get::<String>("plant") == plant && row.get::<String>("series") == series)
        .unwrap_or_else(|| panic!("no {plant} {series} in proof.csv"));
    Energy {
        months: std::array::from_fn(|m| row.get(&(m + 1).to_string())),
        total: row.get("total"),
    }
}

fn deviation(crate_wh: f64, pvlib_wh: f64) -> f64 {
    crate_wh / pvlib_wh - 1.0
}

#[expect(
    clippy::print_stdout,
    reason = "the deviations `docs/pv-proof.md` quotes, read with --nocapture"
)]
fn check(plant: &str, weather: &[Weather]) {
    let run = year(&layout(plant), weather, HOUR);
    let input = &run.inverters[0].inputs[0];
    let series = std::iter::once(("input".to_owned(), input.energy)).chain(
        input
            .strings
            .iter()
            .enumerate()
            .map(|(s, energy)| (format!("string{s}"), *energy)),
    );
    for (name, energy) in series {
        let expected = pvlib(plant, &name);
        let months: Vec<String> = energy
            .months
            .iter()
            .zip(expected.months)
            .map(|(&ours, theirs)| format!("{:+.2}", 100.0 * deviation(ours, theirs)))
            .collect();
        let off = deviation(energy.total, expected.total);
        println!(
            "{plant} {name}: {:.1} kWh, pvlib {:.1} kWh, {:+.3} %; by month % {}",
            energy.total / 1000.0,
            expected.total / 1000.0,
            100.0 * off,
            months.join(" ")
        );
        assert!(
            off.abs() <= tolerance(plant),
            "{plant} {name}: {:.1} Wh against pvlib's {:.1} Wh, {:+.3} %",
            energy.total,
            expected.total,
            100.0 * off
        );
    }
}

#[test]
fn an_open_roofs_year_matches_pvlib() {
    check("open_roof", &weather());
}

#[test]
fn a_shaded_roofs_year_matches_pvlib() {
    check("shaded_roof", &weather());
}

#[test]
fn two_orientations_on_one_input_match_pvlib_over_a_year() {
    check("east_west", &weather());
}

#[test]
fn a_rack_fields_year_matches_pvlib() {
    check("rack_field", &weather());
}

#[test]
fn the_fixture_holds_every_plant() {
    let fixture = rows(include_str!("../../fixtures/proof.csv"));
    for plant in PLANTS {
        assert!(
            fixture
                .iter()
                .any(|row| row.get::<String>("plant") == plant),
            "{plant}"
        );
    }
}
