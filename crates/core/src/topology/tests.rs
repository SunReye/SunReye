//! The balance of a measurement-point tree, worked by hand.

use std::collections::HashMap;

use super::{Balance, Claim, Point, balance, residual};

fn point(id: u32, parent: Option<u32>, claims: &[(u32, &str)]) -> Point {
    Point {
        id,
        name: format!("point {id}"),
        parent,
        claims: claims
            .iter()
            .map(|&(device, role)| Claim {
                device,
                role: role.to_owned(),
            })
            .collect(),
    }
}

/// Balances `points` over the latest values by device and role.
fn balanced(points: &[Point], values: &[(u32, &str, f64)]) -> Balance {
    let values: HashMap<(u32, &str), f64> = values
        .iter()
        .map(|&(device, role, value)| ((device, role), value))
        .collect();
    balance(points, |device, role| values.get(&(device, role)).copied())
}

fn own(balance: &Balance) -> Vec<(u32, f64)> {
    balance
        .own
        .iter()
        .map(|(&id, &watts)| (id, watts))
        .collect()
}

fn total(balance: &Balance, role: &str) -> Option<f64> {
    balance
        .totals
        .iter()
        .find(|(r, _)| *r == role)
        .map(|&(_, value)| value)
}

/// A grid meter (device 2) over the Deye's PV and battery (device 1) and a heat pump meter
/// (device 3).
fn house() -> Vec<Point> {
    vec![
        point(1, None, &[(2, "grid.power")]),
        point(2, Some(1), &[(1, "pv.power")]),
        point(3, Some(1), &[(1, "battery.power")]),
        point(4, Some(1), &[(3, "load.power")]),
    ]
}

#[test]
fn a_points_own_consumption_is_its_power_minus_its_measured_children() {
    let values = [
        (2, "grid.power", 1200.0),
        (1, "pv.power", 3000.0),
        (1, "battery.power", 800.0),
        (3, "load.power", 1500.0),
    ];

    let balance = balanced(&house(), &values);

    // Into the grid point 1200 W; its children take −3000 + 800 + 1500 = −700 W of it, so the
    // 1900 W left is the house no meter explains.
    assert_eq!(
        own(&balance),
        [(1, 1900.0), (2, -3000.0), (3, 800.0), (4, 1500.0)]
    );
}

#[test]
fn the_plant_publishes_its_flows_and_the_house_load() {
    let values = [
        (2, "grid.power", 1200.0),
        (1, "pv.power", 3000.0),
        (1, "battery.power", 800.0),
        (3, "load.power", 1500.0),
    ];

    let balance = balanced(&house(), &values);

    assert_eq!(total(&balance, "grid.power"), Some(1200.0));
    assert_eq!(total(&balance, "pv.power"), Some(3000.0));
    assert_eq!(total(&balance, "battery.power"), Some(800.0));
    // 1200 W bought and 3000 W made, 800 W of it into the battery: 1900 W unmeasured house and
    // 1500 W heat pump.
    assert_eq!(total(&balance, "load.power"), Some(3400.0));
}

/// Behind the grid meter, PV and a garage sub-meter; behind the garage meter, a wallbox.
fn garage() -> Vec<Point> {
    vec![
        point(1, None, &[(2, "grid.power")]),
        point(2, Some(1), &[(1, "pv.power")]),
        point(3, Some(1), &[(4, "load.power")]),
        point(4, Some(3), &[(5, "ev.charge.power")]),
    ]
}

#[test]
fn a_nested_meter_subtracts_only_its_own_children() {
    let values = [
        (2, "grid.power", 500.0),
        (1, "pv.power", 2500.0),
        (4, "load.power", 2000.0),
        (5, "ev.charge.power", 1100.0),
    ];

    let balance = balanced(&garage(), &values);

    // Garage: 2000 − 1100 = 900 W. Grid: 500 − (2000 − 2500) = 1000 W.
    assert_eq!(
        own(&balance),
        [(1, 1000.0), (2, -2500.0), (3, 900.0), (4, 1100.0)]
    );
    assert_eq!(total(&balance, "ev.charge.power"), Some(1100.0));
    // 500 W bought and 2500 W made: 1000 + 900 + 1100.
    assert_eq!(total(&balance, "load.power"), Some(3000.0));
}

#[test]
fn an_unmeasured_point_is_left_in_its_parents_remainder() {
    let values = [
        (2, "grid.power", 500.0),
        (1, "pv.power", 2500.0),
        (5, "ev.charge.power", 1100.0),
    ];

    let balance = balanced(&garage(), &values);

    // The garage meter is silent: the grid point keeps the garage's 900 W and subtracts the
    // wallbox under it, 500 − (1100 − 2500) = 1900 W.
    assert_eq!(own(&balance), [(1, 1900.0), (2, -2500.0), (4, 1100.0)]);
    // The house load needs every point.
    assert_eq!(total(&balance, "load.power"), None);
    assert_eq!(total(&balance, "grid.power"), Some(500.0));
    assert_eq!(total(&balance, "pv.power"), Some(2500.0));
}

#[test]
fn two_devices_claiming_one_point_are_not_summed() {
    let mut points = house();
    points[0].claims.push(Claim {
        device: 1,
        role: "grid.power".to_owned(),
    });
    let values = [
        (2, "grid.power", 1200.0),
        (1, "grid.power", 1180.0),
        (1, "pv.power", 3000.0),
        (1, "battery.power", 800.0),
        (3, "load.power", 1500.0),
    ];

    let balance = balanced(&points, &values);

    assert!(points[0].contested());
    // The first claim's 1200 W, never 2380 W.
    assert_eq!(total(&balance, "grid.power"), Some(1200.0));
    assert_eq!(balance.own.get(&1), Some(&1900.0));
}

#[test]
fn plant_soc_is_weighted_by_battery_capacity() {
    let points = vec![
        point(1, None, &[(2, "grid.power")]),
        point(2, Some(1), &[(1, "battery.power")]),
        point(3, Some(1), &[(6, "battery.power")]),
    ];
    let values = [
        (2, "grid.power", 0.0),
        (1, "battery.power", -400.0),
        (1, "battery.soc", 50.0),
        (1, "battery.capacity", 10.0),
        (6, "battery.power", 200.0),
        (6, "battery.soc", 80.0),
        (6, "battery.capacity", 5.0),
    ];

    let balance = balanced(&points, &values);

    // (50 % · 10 kWh + 80 % · 5 kWh) / 15 kWh = 60 %, where a plain mean says 65 %.
    assert_eq!(total(&balance, "battery.soc"), Some(60.0));
    assert_eq!(total(&balance, "battery.capacity"), Some(15.0));
    assert_eq!(total(&balance, "battery.power"), Some(-200.0));
}

#[test]
fn one_battery_without_a_capacity_gives_its_own_soc() {
    let values = [
        (2, "grid.power", 1200.0),
        (1, "pv.power", 3000.0),
        (1, "battery.power", 800.0),
        (1, "battery.soc", 70.0),
        (3, "load.power", 1500.0),
    ];

    let balance = balanced(&house(), &values);

    assert_eq!(total(&balance, "battery.soc"), Some(70.0));
    assert_eq!(total(&balance, "battery.capacity"), None);
}

#[test]
fn two_batteries_without_capacities_give_no_plant_soc() {
    let points = vec![
        point(1, None, &[(2, "grid.power")]),
        point(2, Some(1), &[(1, "battery.power")]),
        point(3, Some(1), &[(6, "battery.power")]),
    ];
    let values = [
        (2, "grid.power", 0.0),
        (1, "battery.power", 0.0),
        (1, "battery.soc", 50.0),
        (6, "battery.power", 0.0),
        (6, "battery.soc", 80.0),
    ];

    assert_eq!(total(&balanced(&points, &values), "battery.soc"), None);
}

/// The residual of `points` over a day's energies by device and role, in kWh.
fn residual_of(points: &[Point], energies: &[(u32, &str, f64)]) -> Vec<(u32, f64)> {
    let energies: HashMap<(u32, &str), f64> = energies
        .iter()
        .map(|&(device, role, kwh)| ((device, role), kwh))
        .collect();
    residual(points, |device, role| {
        energies.get(&(device, role)).copied()
    })
    .into_iter()
    .collect()
}

#[test]
fn a_tree_whose_consumers_each_take_energy_has_no_residual() {
    let energies = [
        (2, "grid.power", 5.0),
        (1, "pv.power", 20.0),
        (1, "battery.power", 3.0),
        (3, "load.power", 8.0),
    ];

    // The grid point keeps 5 + 20 − 3 − 8 = 14 kWh, the heat pump its 8 kWh.
    assert_eq!(residual_of(&house(), &energies), []);
}

#[test]
fn a_consumer_giving_out_energy_its_children_do_not_explain_is_the_residual() {
    // The PV wrongly placed under the heat pump meter, which never measured it.
    let misplaced = vec![
        point(1, None, &[(2, "grid.power")]),
        point(4, Some(1), &[(3, "load.power")]),
        point(2, Some(4), &[(1, "pv.power")]),
        point(3, Some(1), &[(1, "battery.power")]),
    ];
    let energies = [
        (2, "grid.power", -6.0),
        (1, "pv.power", 20.0),
        (1, "battery.power", 3.0),
        (3, "load.power", 8.0),
    ];

    // The heat pump keeps 8 + 20 = 28 kWh; the grid point −6 − 8 − 3 = −17 kWh, which no
    // consumer can give out.
    assert_eq!(residual_of(&misplaced, &energies), [(1, 17.0)]);
}

#[test]
fn a_missing_source_shows_as_the_residual_of_the_point_above_it() {
    // The PV has no point: its 20 kWh feed the house and the grid unexplained.
    let missing = vec![
        point(1, None, &[(2, "grid.power")]),
        point(3, Some(1), &[(1, "battery.power")]),
        point(4, Some(1), &[(3, "load.power")]),
    ];
    let energies = [
        (2, "grid.power", -6.0),
        (1, "battery.power", 3.0),
        (3, "load.power", 8.0),
    ];

    // −6 − 3 − 8 = −17 kWh.
    assert_eq!(residual_of(&missing, &energies), [(1, 17.0)]);
}
