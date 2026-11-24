//! A layout's run over a year of weather (ADR 17): each step's estimate, held for the step, summed
//! by UTC month and over the run.

use crate::chain::{Chain, Loss, Step};
use crate::estimate::{SECONDS_PER_DAY, Tallies, month};
use crate::string::{Open, Tally};
use crate::{AcSide, Estimate, Horizon, InverterEstimate, Layout, ShadingTable, SkyViews, Weather};

/// Watt-hours by UTC month, January first, and over the whole run.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Energy {
    pub months: [f64; 12],
    pub total: f64,
}

impl Energy {
    /// Both added, month by month.
    #[must_use]
    pub fn plus(&self, other: &Self) -> Self {
        Self {
            months: std::array::from_fn(|m| {
                self.months.get(m).copied().unwrap_or(0.0)
                    + other.months.get(m).copied().unwrap_or(0.0)
            }),
            total: self.total + other.total,
        }
    }

    fn add(&mut self, month: usize, wh: f64) {
        if let Some(of_month) = self.months.get_mut(month) {
            *of_month += wh;
        }
        self.total += wh;
    }
}

/// A layout's energy over a run, in the layout's order.
#[derive(Debug, Clone, PartialEq)]
pub struct Year {
    pub inverters: Vec<InverterYear>,
}

impl Year {
    /// The plant's loss chain: its inverters' added, over the losses all of them have.
    #[must_use]
    pub fn chain(&self) -> Chain {
        Chain::sum(self.inverters.iter().map(|inverter| &inverter.chain))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct InverterYear {
    /// The sum of its inputs, on the DC side.
    pub dc: Energy,
    /// Only for an inverter with an inverter type.
    pub ac: Option<AcYear>,
    pub inputs: Vec<InputYear>,
    /// From the planes to its DC sum, or with an AC side to what it delivers past its AC cable.
    pub chain: Chain,
}

/// An inverter's output after its efficiency curve, and what its AC rating cut off it.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct AcYear {
    pub energy: Energy,
    pub clipped: Energy,
}

/// An MPPT input's energy and each of its strings' share of it, at the inverter: past each
/// string's DC cable, if any.
#[derive(Debug, Clone, PartialEq)]
pub struct InputYear {
    pub energy: Energy,
    pub strings: Vec<Energy>,
}

/// The energy of every string, MPPT input and inverter over `weather`, each sample's power held
/// for `step` seconds and counted in the UTC month of its instant.
#[must_use]
pub fn year(layout: &Layout, weather: &[Weather], step: i64) -> Year {
    year_with(layout, &mut ShadingTable::default(), None, weather, step)
}

/// The same, its shade looked up in `table`, which is traced again first when the layout's
/// scene changed since, under the horizon profile the caller supplies, if any.
pub fn year_with(
    layout: &Layout,
    table: &mut ShadingTable,
    horizon: Option<&Horizon>,
    weather: &[Weather],
    step: i64,
) -> Year {
    let inputs = RunInputs {
        horizon,
        ..RunInputs::default()
    };
    year_run(layout, table, &inputs, weather, step)
}

/// What a run is given beside its layout and weather, never part of the layout (ADR 17).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunInputs<'a> {
    /// The far horizon.
    pub horizon: Option<&'a Horizon>,
    /// Of the light reaching the cells, in %.
    pub soiling: Option<f64>,
    /// Each string's cable to its inverter, in layout order; none where missing.
    pub dc_cables: Vec<Option<Cable>>,
    /// Each inverter's cable to the grid connection, in layout order; none where missing.
    pub ac_cables: Vec<Option<AcCable>>,
}

/// A copper cable: its length one way, in metres, and each conductor's cross-section, in mm².
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cable {
    pub length: f64,
    pub cross_section: f64,
}

/// Copper's conductivity in m/(Ω·mm²): the electricians' 56, near 30 °C.
const COPPER: f64 = 56.0;
/// The grid's voltage between a phase and neutral, and between two phases, in volts.
const PHASE: f64 = 230.0;
const LINE: f64 = 400.0;

impl Cable {
    /// One conductor's resistance, in ohms.
    fn resistance(self) -> f64 {
        if self.cross_section <= 0.0 {
            return 0.0;
        }
        self.length / (COPPER * self.cross_section)
    }

    /// Watts lost carrying `current` amperes out and back on a DC pair, at most `watts`.
    fn dc_loss(self, current: f64, watts: f64) -> f64 {
        (2.0 * self.resistance() * current * current)
            .min(watts)
            .max(0.0)
    }
}

/// An inverter's cable to the grid connection, single-phase at 230 V or three-phase at 400 V,
/// at a power factor of 1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AcCable {
    pub cable: Cable,
    pub three_phase: bool,
}

impl AcCable {
    /// Watts lost carrying `watts`, at most `watts`.
    fn loss(self, watts: f64) -> f64 {
        let resistance = self.cable.resistance();
        let lost = if self.three_phase {
            // Three conductors each carrying P / (√3 · 400 V).
            resistance * (watts / LINE).powi(2)
        } else {
            // Out and back at P / 230 V.
            2.0 * resistance * (watts / PHASE).powi(2)
        };
        lost.min(watts).max(0.0)
    }
}

/// The same with everything the caller supplies the run: its horizon, soiling and cables.
pub fn year_run(
    layout: &Layout,
    table: &mut ShadingTable,
    inputs: &RunInputs,
    weather: &[Weather],
    step: i64,
) -> Year {
    let views = SkyViews::new(layout, table, inputs.horizon);
    let clean = 1.0 - inputs.soiling.unwrap_or(0.0) / 100.0;
    let open = |sun, string| Open {
        clean,
        ..views.open(sun, string)
    };
    let mut run = empty(layout, &computed(layout, table, inputs), inputs);
    let mut tallies = Tallies::default();
    #[expect(
        clippy::cast_precision_loss,
        reason = "a step is seconds, far below 2^52"
    )]
    let hours = step as f64 / 3600.0;
    for sample in weather {
        // Dark: nothing to model.
        if sample.ghi <= 0.0 && sample.dni <= 0.0 && sample.dhi <= 0.0 {
            continue;
        }
        let mut estimate = table.estimate(layout, sample, open, Some(&mut tallies));
        let before = cabled(&mut estimate, &inputs.dc_cables);
        let at = At {
            month: month(sample.unix.div_euclid(SECONDS_PER_DAY)),
            hours,
            tallies: &tallies,
            before_cables: &before,
        };
        add(&mut run, layout, &estimate, &at, inputs);
    }
    run
}

/// The losses every inverter's chain has, in order: those a plant computes whatever its
/// inverters, and those the run's inputs and scene bring.
fn computed(layout: &Layout, table: &ShadingTable, inputs: &RunInputs) -> Vec<Loss> {
    let mut all_inputs = layout
        .inverters
        .iter()
        .flat_map(|inverter| &inverter.inputs);
    let limits = all_inputs.clone().any(|input| input.limits.is_some());
    let own = all_inputs.any(|input| input.strings.iter().any(|s| s.loss != 0.0));
    let shading = table.shades();
    let with = [
        (Loss::Horizon, inputs.horizon.is_some()),
        (Loss::BeamShading, shading),
        (Loss::DiffuseShading, shading),
        (Loss::Incidence, true),
        (Loss::Soiling, inputs.soiling.is_some()),
        (Loss::IrradianceLevel, true),
        (Loss::Temperature, true),
        (Loss::String, own),
        (Loss::Mismatch, true),
        (Loss::MpptLimits, limits),
        (Loss::DcCable, inputs.dc_cables.iter().any(Option::is_some)),
    ];
    with.into_iter()
        .filter_map(|(loss, computed)| computed.then_some(loss))
        .collect()
}

/// Where a step's model holds the watts `loss` leaves.
const fn stage(loss: Loss) -> Stage {
    match loss {
        Loss::Horizon => Stage::Light(1),
        Loss::BeamShading => Stage::Light(2),
        Loss::DiffuseShading => Stage::Light(3),
        Loss::Incidence => Stage::Light(4),
        Loss::Soiling => Stage::Light(5),
        Loss::IrradianceLevel => Stage::Cool,
        Loss::Temperature => Stage::Warm,
        Loss::String => Stage::Kept,
        Loss::Mismatch => Stage::Free,
        Loss::MpptLimits => Stage::Inputs,
        Loss::DcCable => Stage::Dc,
        Loss::Inverter => Stage::Curve,
        Loss::Clipping => Stage::Ac,
        Loss::AcCable => Stage::Grid,
    }
}

/// Where in a step's model a loss's after-energy is read.
#[derive(Debug, Clone, Copy)]
enum Stage {
    /// An optical stage of the strings' tallies.
    Light(usize),
    Cool,
    Warm,
    Kept,
    /// The inputs' peaks free of their limits.
    Free,
    /// The inputs' watts before the DC cables.
    Inputs,
    /// The inverter's DC sum, past the cables.
    Dc,
    /// Past the efficiency curve, before the AC rating.
    Curve,
    Ac,
    /// Past the AC cable.
    Grid,
}

/// One step's month, length and what its model tallied.
struct At<'a> {
    month: usize,
    hours: f64,
    tallies: &'a Tallies,
    /// Each input's watts before its strings' DC cables, in layout order.
    before_cables: &'a [f64],
}

/// An inverter's watts at each stage of a step.
struct Watts {
    tallies: Tally,
    free: f64,
    before_cables: f64,
    dc: f64,
    /// AC watts and the watts clipped; zero without an AC side.
    ac: f64,
    clipped: f64,
    grid: f64,
}

impl Watts {
    fn at(&self, stage: Stage) -> f64 {
        match stage {
            Stage::Light(n) => self.tallies.light.get(n).copied().unwrap_or(0.0),
            Stage::Cool => self.tallies.cool,
            Stage::Warm => self.tallies.warm,
            Stage::Kept => self.tallies.kept,
            Stage::Free => self.free,
            Stage::Inputs => self.before_cables,
            Stage::Dc => self.dc,
            Stage::Curve => self.ac + self.clipped,
            Stage::Ac => self.ac,
            Stage::Grid => self.grid,
        }
    }
}

/// Takes each string's DC cable loss off its watts, and so off its input's and inverter's, and
/// returns each input's watts before, in layout order. A string's current is its watts over its
/// input's voltage.
fn cabled(estimate: &mut Estimate, cables: &[Option<Cable>]) -> Vec<f64> {
    let mut before = Vec::new();
    let mut first = 0;
    for inverter in &mut estimate.inverters {
        for input in &mut inverter.inputs {
            before.push(input.power);
            let from = first;
            first += input.strings.len();
            if cables.is_empty() || input.voltage <= 0.0 {
                continue;
            }
            let of_input = cables.get(from..).unwrap_or_default();
            let lost = cable_losses(&mut input.strings, of_input, input.voltage);
            if lost > 0.0 {
                input.power -= lost;
                inverter.power -= lost;
            }
        }
    }
    before
}

/// Takes each string's cable loss off its watts and returns their sum.
fn cable_losses(strings: &mut [f64], cables: &[Option<Cable>], voltage: f64) -> f64 {
    let mut lost = 0.0;
    for (watts, cable) in strings.iter_mut().zip(cables) {
        if let Some(cable) = cable {
            let watts_lost = cable.dc_loss(*watts / voltage, *watts);
            *watts -= watts_lost;
            lost += watts_lost;
        }
    }
    lost
}

fn empty(layout: &Layout, computed: &[Loss], inputs: &RunInputs) -> Year {
    let inverters = layout
        .inverters
        .iter()
        .enumerate()
        .map(|(k, inverter)| {
            let ac = inverter.ac.is_some();
            let ac_cable = ac && matches!(inputs.ac_cables.get(k), Some(Some(_)));
            let tail = [
                (Loss::Inverter, ac),
                (Loss::Clipping, ac),
                (Loss::AcCable, ac_cable),
            ];
            let tail = tail
                .into_iter()
                .filter_map(|(loss, computed)| computed.then_some(loss));
            let steps = computed
                .iter()
                .copied()
                .chain(tail)
                .map(|loss| Step {
                    loss,
                    after: Energy::default(),
                })
                .collect();
            InverterYear {
                dc: Energy::default(),
                ac: inverter.ac.map(|_| AcYear::default()),
                inputs: inverter
                    .inputs
                    .iter()
                    .map(|input| InputYear {
                        energy: Energy::default(),
                        strings: vec![Energy::default(); input.strings.len()],
                    })
                    .collect(),
                chain: Chain {
                    planes: Energy::default(),
                    steps,
                },
            }
        })
        .collect();
    Year { inverters }
}

fn add(run: &mut Year, layout: &Layout, estimate: &Estimate, at: &At, inputs: &RunInputs) {
    let (month, hours) = (at.month, at.hours);
    let (mut first_string, mut first_input) = (0, 0);
    let mut inverters = run.inverters.iter_mut().zip(&estimate.inverters);
    for (k, ((inverter, of), wired)) in inverters.by_ref().zip(&layout.inverters).enumerate() {
        let strings: usize = wired.inputs.iter().map(|i| i.strings.len()).sum();
        let count = wired.inputs.len();
        let tallies = at
            .tallies
            .strings
            .get(first_string..first_string + strings)
            .unwrap_or_default();
        let sum_of = |all: &[f64]| -> f64 {
            all.get(first_input..first_input + count)
                .unwrap_or_default()
                .iter()
                .sum()
        };
        let (free, before_cables) = (sum_of(&at.tallies.free), sum_of(at.before_cables));
        first_string += strings;
        first_input += count;

        let (ac, clipped) = add_energy(inverter, of, wired.ac, month, hours);
        let ac_cable = inputs.ac_cables.get(k).copied().flatten();
        let watts = Watts {
            tallies: Tally::sum(tallies),
            free,
            before_cables,
            dc: of.power,
            ac,
            clipped,
            grid: ac_cable.map_or(ac, |cable| ac - cable.loss(ac)),
        };
        let chain = &mut inverter.chain;
        chain.planes.add(month, watts.tallies.light[0] * hours);
        for step in &mut chain.steps {
            step.after.add(month, watts.at(stage(step.loss)) * hours);
        }
    }
}

/// Adds a step's energy to an inverter's DC sum, its inputs and strings, and its AC side, and
/// returns its AC watts and the watts clipped.
fn add_energy(
    inverter: &mut InverterYear,
    of: &InverterEstimate,
    side: Option<AcSide>,
    month: usize,
    hours: f64,
) -> (f64, f64) {
    inverter.dc.add(month, of.power * hours);
    let mut sides = (0.0, 0.0);
    if let (Some(ac), Some(side)) = (&mut inverter.ac, side) {
        sides = side.output(of.power);
        ac.energy.add(month, sides.0 * hours);
        ac.clipped.add(month, sides.1 * hours);
    }
    for (input, of) in inverter.inputs.iter_mut().zip(&of.inputs) {
        input.energy.add(month, of.power * hours);
        for (string, watts) in input.strings.iter_mut().zip(&of.strings) {
            string.add(month, watts * hours);
        }
    }
    sides
}

impl AcSide {
    /// AC watts and the watts the rating clips, for `dc` watts: pvlib's `inverter.pvwatts`, its
    /// nominal efficiency the European weighted one and its DC rating the AC rating over that.
    fn output(self, dc: f64) -> (f64, f64) {
        if dc <= 0.0 {
            return (0.0, 0.0);
        }
        let nominal = self.efficiency / 100.0;
        let load = dc * nominal / self.rating;
        let efficiency = nominal / 0.9637 * (-0.0059 / load + (-0.0162f64).mul_add(load, 0.9858));
        let curve = (efficiency * dc).max(0.0);
        let ac = curve.min(self.rating);
        (ac, curve - ac)
    }
}
