//! Auto-stringing (ADR 20): a roof face's modules in no string, run in a serpentine row by row from
//! the lower left and cut into as few new strings as the inverter's limits allow. The builder runs
//! it a face at a time; a consumer that strings a plant without it runs every face, the one with the
//! most modules in no string first. Pure.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::hash::BuildHasher;

use serde::{Deserialize, Serialize};

use crate::{GridModule, InverterLimits, ModuleType, Scene, Spot, longest_string};

/// A string as auto-stringing reads and makes it: its module type, its inverter by device, its MPPT
/// input from 1 and how many modules it holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wiring {
    pub module_type: u32,
    pub device: u32,
    pub input: u32,
    pub modules: u16,
}

/// A face's proposal: the scene with its modules wired into the new strings, which follow the
/// layout's, and how many modules no equal cut could hold.
#[derive(Debug, Clone, PartialEq)]
pub struct Strung {
    pub scene: Scene,
    pub strings: Vec<Wiring>,
    pub left: usize,
}

/// Why a face is not strung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unstrung {
    /// The face's grid holds no module in no string, or there is no such grid.
    Nothing,
    /// The inverter has no MPPT input without a string.
    NoFreeInput,
}

/// Metres up the face within which modules share a row.
const ROW: f64 = 0.4;

/// An MPPT input that carries no string, and what it takes: the most modules in series and how
/// many strings in parallel, `usize::MAX` for no limit.
#[derive(Debug, Clone, Copy)]
struct Free {
    input: u32,
    most: usize,
    parallel: usize,
}

/// Each new string's length and input, in turn.
type Cut = Vec<(usize, u32)>;

/// A module's place on its face, across and up; a cell as stored before places, by its column and
/// row, which keep the same order.
fn place(module: &GridModule) -> (f64, f64) {
    match module.spot {
        Spot::Place { across, up, .. } => (across, up),
        Spot::Cell { row, column } => (f64::from(column), f64::from(row)),
    }
}

/// As the builder sorts: equal where neither is less.
fn by(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

/// The modules in no string, in a serpentine: rows from the lowest, the first from the left, each
/// next the other way.
fn serpentine(modules: &[GridModule]) -> Vec<usize> {
    let mut loose: Vec<(usize, (f64, f64))> = modules
        .iter()
        .enumerate()
        .filter(|(_, module)| module.string.is_none())
        .map(|(at, module)| (at, place(module)))
        .collect();
    loose.sort_by(|(_, a), (_, b)| by(a.1, b.1));
    let mut rows: Vec<Vec<(usize, (f64, f64))>> = Vec::new();
    for cell in loose {
        let low = rows
            .last()
            .and_then(|row| row.first())
            .map(|(_, (_, up))| *up);
        match (rows.last_mut(), low) {
            (Some(row), Some(low)) if cell.1.1 - low <= ROW => row.push(cell),
            _ => rows.push(vec![cell]),
        }
    }
    rows.into_iter()
        .enumerate()
        .flat_map(|(i, mut row)| {
            row.sort_by(|(_, a), (_, b)| by(a.0, b.0));
            if i % 2 == 1 {
                row.reverse();
            }
            row.into_iter().map(|(at, _)| at)
        })
        .collect()
}

/// One string on each of the fewest inputs that hold `count` between them, each no longer than its
/// own input takes and as even as that allows; none where the inputs do not hold them.
fn alone(count: usize, free: &[Free]) -> Option<Cut> {
    // The roomiest inputs first: the fewest strings.
    let mut roomy: Vec<usize> = (0..free.len()).collect();
    roomy.sort_by_key(|at| std::cmp::Reverse(free.get(*at).map_or(0, |f| f.most)));
    let mut held = 0_usize;
    let enough = roomy.iter().position(|at| {
        held = held.saturating_add(free.get(*at).map_or(0, |f| f.most));
        held >= count
    })?;
    let used = roomy.get(..=enough).unwrap_or_default();
    // The tightest input first: what it cannot take, the roomier ones share.
    let mut tightest: Vec<usize> = (0..free.len()).filter(|at| used.contains(at)).collect();
    tightest.sort_by_key(|at| free.get(*at).map_or(0, |f| f.most));
    let mut lengths = vec![0; free.len()];
    let mut rest = count;
    for (i, at) in tightest.iter().enumerate() {
        let most = free.get(*at).map_or(0, |f| f.most);
        let length = most.min(rest.div_ceil(used.len() - i));
        if let Some(slot) = lengths.get_mut(*at) {
            *slot = length;
        }
        rest -= length;
    }
    Some(
        free.iter()
            .zip(lengths)
            .enumerate()
            .filter(|(at, _)| used.contains(at))
            .map(|(_, (input, length))| (length, input.input))
            .collect(),
    )
}

/// `strings` strings of `length` shared out over the inputs that take that length, none carrying
/// more than its current allows; none where they do not carry that many.
fn shared(strings: usize, length: usize, free: &[Free]) -> Option<Cut> {
    let fit: Vec<&Free> = free.iter().filter(|input| input.most >= length).collect();
    let mut carried = vec![0_usize; fit.len()];
    let mut left = strings;
    // In turn, an input at a time, until each is full.
    while left > 0 {
        let open: Vec<usize> = (0..fit.len())
            .filter(|at| {
                let parallel = fit.get(*at).map_or(0, |input| input.parallel);
                carried.get(*at).is_some_and(|carries| *carries < parallel)
            })
            .collect();
        if open.is_empty() {
            return None;
        }
        for at in open.iter().take(left) {
            if let Some(carries) = carried.get_mut(*at) {
                *carries += 1;
            }
        }
        left -= left.min(open.len());
    }
    Some(
        fit.iter()
            .zip(carried)
            .flat_map(|(input, carries)| std::iter::repeat_n((length, input.input), carries))
            .collect(),
    )
}

/// `count` modules cut into strings no longer than each input takes, never unequal in parallel:
/// one on each free input where the inputs suffice; else all of one length, the fewest that leave
/// none over, shared out over the inputs; else the fewest of the longest equal length, the rest
/// left over.
fn cut(count: usize, free: &[Free]) -> Cut {
    if let Some(single) = alone(count, free) {
        return single;
    }
    let roomiest = free.iter().map(|input| input.most).max().unwrap_or(1);
    let fewest = count.div_ceil(roomiest.max(1));
    let even = (fewest..=fewest.saturating_mul(2))
        .filter(|strings| *strings > 0 && count.is_multiple_of(*strings))
        .find_map(|strings| shared(strings, count / strings, free));
    if let Some(even) = even {
        return even;
    }
    // No longer than the tightest input takes, on as many strings as the inputs carry.
    let carried = free
        .iter()
        .fold(0_usize, |sum, input| sum.saturating_add(input.parallel));
    let strings = fewest.min(carried);
    let tightest = free.iter().map(|input| input.most).min().unwrap_or(0);
    let length = tightest.min(count.checked_div(strings).unwrap_or(usize::MAX));
    shared(strings, length, free).unwrap_or_default()
}

/// The place in string `string`'s wiring after its last module's.
fn following(scene: &Scene, string: u32) -> u32 {
    scene
        .grids
        .iter()
        .flat_map(|grid| &grid.modules)
        .filter(|module| module.string == Some(string))
        .map(|module| module.order.map_or(0, |order| order.saturating_add(1)))
        .max()
        .unwrap_or(0)
}

/// The inputs of the inverter that carry no string, each with what it takes of `module`.
fn free_inputs(
    module: Option<&ModuleType>,
    device: u32,
    inverter: &InverterLimits,
    taken: &[Wiring],
) -> Vec<Free> {
    let on: Vec<u32> = taken
        .iter()
        .filter(|wiring| wiring.device == device)
        .map(|wiring| wiring.input)
        .collect();
    // An inverter that lists no inputs has as many as its strings name, and one more.
    let count = inverter.inputs.as_ref().map_or_else(
        || on.iter().max().map_or(1, |most| most.saturating_add(1)),
        |inputs| u32::try_from(inputs.len()).unwrap_or(u32::MAX),
    );
    (1..=count)
        .filter(|input| !on.contains(input))
        .map(|input| {
            let own = inverter.inputs.as_ref().and_then(|inputs| {
                usize::try_from(input - 1)
                    .ok()
                    .and_then(|at| inputs.get(at))
            });
            let Some(module) = module else {
                return Free {
                    input,
                    most: usize::MAX,
                    parallel: usize::MAX,
                };
            };
            let longest = longest_string(module, inverter.max_input_voltage, own);
            Free {
                input,
                // None, or under one, is no limit.
                most: longest
                    .filter(|longest| *longest >= 1)
                    .map_or(usize::MAX, usize::from),
                parallel: own.map_or(usize::MAX, |own| parallel(own.max_current, module.isc)),
            }
        })
        .collect()
}

/// How many strings of a module with short-circuit current `isc` a current of `max_current`
/// carries in parallel: at least one.
fn parallel(max_current: f64, isc: f64) -> usize {
    let carried = (max_current / isc).floor();
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a float cast saturates; one at least is kept below"
    )]
    let carried = carried as usize;
    carried.max(1)
}

/// Grid `grid`'s modules in no string wired into new strings on `device`'s MPPT inputs that carry
/// none of `taken`, the layout's strings, which the new ones follow.
///
/// Each string is no longer than keeps its open-circuit voltage at −10 °C within the inverter's
/// maximum DC input voltage and its maximum-power voltage there within its input's window, and an
/// input carries no more in parallel than its maximum current. Wired modules stay as they are.
///
/// # Errors
/// [`Unstrung::Nothing`] where the grid holds no module in no string, [`Unstrung::NoFreeInput`]
/// where every input carries a string.
#[expect(
    clippy::too_many_arguments,
    reason = "`auto_string`'s arguments and the face: a consumer names each"
)]
pub fn auto_string_face<S: BuildHasher>(
    scene: &Scene,
    grid: usize,
    module_types: &HashMap<u32, ModuleType, S>,
    device: u32,
    inverter: &InverterLimits,
    taken: &[Wiring],
) -> Result<Strung, Unstrung> {
    let laid = scene.grids.get(grid).ok_or(Unstrung::Nothing)?;
    let run = serpentine(&laid.modules);
    if run.is_empty() {
        return Err(Unstrung::Nothing);
    }
    let free = free_inputs(module_types.get(&laid.module_type), device, inverter, taken);
    if free.is_empty() {
        return Err(Unstrung::NoFreeInput);
    }
    let strings = cut(run.len(), &free);
    let first = u32::try_from(taken.len()).unwrap_or(u32::MAX);
    let mut strung = scene.clone();
    let mut wired = 0_usize;
    let mut made = Vec::with_capacity(strings.len());
    for ((length, input), nth) in strings.into_iter().zip(0_u32..) {
        let number = first.saturating_add(nth);
        let to = wired.saturating_add(length).min(run.len());
        for at in run.get(wired..to).unwrap_or_default() {
            let order = following(&strung, number);
            let module = strung
                .grids
                .get_mut(grid)
                .and_then(|grid| grid.modules.get_mut(*at));
            if let Some(module) = module {
                module.string = Some(number);
                module.order = Some(order);
            }
        }
        wired = wired.saturating_add(length);
        made.push(Wiring {
            module_type: laid.module_type,
            device,
            input,
            modules: u16::try_from(length).unwrap_or(u16::MAX),
        });
    }
    Ok(Strung {
        scene: strung,
        strings: made,
        left: run.len().saturating_sub(wired),
    })
}

/// Every roof face's modules in no string wired into new strings, as [`auto_string_face`] does.
///
/// A face at a time: the face with the most such modules first, the first of equals, each on the
/// inputs the faces before left free. With the new strings, how many modules stay in no string,
/// those of a face no free input was left for among them.
#[must_use]
pub fn auto_string<S: BuildHasher>(
    scene: &Scene,
    module_types: &HashMap<u32, ModuleType, S>,
    device: u32,
    inverter: &InverterLimits,
    taken: &[Wiring],
) -> (Scene, Vec<Wiring>, usize) {
    let loose = |grid: usize, scene: &Scene| {
        scene.grids.get(grid).map_or(0, |grid| {
            grid.modules
                .iter()
                .filter(|module| module.string.is_none())
                .count()
        })
    };
    let mut faces: Vec<usize> = (0..scene.grids.len()).collect();
    faces.sort_by_key(|grid| std::cmp::Reverse(loose(*grid, scene)));
    let mut strung = scene.clone();
    let mut wired = taken.to_vec();
    let mut left = 0;
    for grid in faces {
        match auto_string_face(&strung, grid, module_types, device, inverter, &wired) {
            Ok(face) => {
                strung = face.scene;
                wired.extend(face.strings);
                left += face.left;
            }
            Err(Unstrung::NoFreeInput) => left += loose(grid, &strung),
            Err(Unstrung::Nothing) => {}
        }
    }
    let made = wired.split_off(taken.len());
    (strung, made, left)
}
