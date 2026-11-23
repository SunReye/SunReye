//! A layout's run over a year of weather (ADR 17): each step's estimate, held for the step, summed
//! by UTC month and over the run.

use crate::estimate::{SECONDS_PER_DAY, month};
use crate::{Estimate, Layout, Weather, estimate};

/// Watt-hours by UTC month, January first, and over the whole run.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Energy {
    pub months: [f64; 12],
    pub total: f64,
}

impl Energy {
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

#[derive(Debug, Clone, PartialEq)]
pub struct InverterYear {
    /// The sum of its inputs, on the DC side.
    pub dc: Energy,
    pub inputs: Vec<InputYear>,
}

/// An MPPT input's energy and each of its strings' share of it.
#[derive(Debug, Clone, PartialEq)]
pub struct InputYear {
    pub energy: Energy,
    pub strings: Vec<Energy>,
}

/// The energy of every string, MPPT input and inverter over `weather`, each sample's power held
/// for `step` seconds and counted in the UTC month of its instant.
#[must_use]
pub fn year(layout: &Layout, weather: &[Weather], step: i64) -> Year {
    let mut run = empty(layout);
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
        let month = month(sample.unix.div_euclid(SECONDS_PER_DAY));
        add(&mut run, &estimate(layout, sample), month, hours);
    }
    run
}

fn empty(layout: &Layout) -> Year {
    let inverters = layout
        .inverters
        .iter()
        .map(|inverter| InverterYear {
            dc: Energy::default(),
            inputs: inverter
                .inputs
                .iter()
                .map(|input| InputYear {
                    energy: Energy::default(),
                    strings: vec![Energy::default(); input.strings.len()],
                })
                .collect(),
        })
        .collect();
    Year { inverters }
}

fn add(run: &mut Year, estimate: &Estimate, month: usize, hours: f64) {
    for (inverter, at) in run.inverters.iter_mut().zip(&estimate.inverters) {
        inverter.dc.add(month, at.power * hours);
        for (input, at) in inverter.inputs.iter_mut().zip(&at.inputs) {
            input.energy.add(month, at.power * hours);
            for (string, watts) in input.strings.iter_mut().zip(&at.strings) {
                string.add(month, watts * hours);
            }
        }
    }
}
