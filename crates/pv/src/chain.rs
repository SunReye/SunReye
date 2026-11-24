//! The loss chain (ADR 17): the energy left after each loss, from irradiation on the planes to
//! what an inverter delivers. A loss is the energy before it less the energy after it, so the
//! losses sum, and their factors multiply, to the whole.

use crate::Energy;

/// A named loss, in the order the chain applies it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loss {
    /// The far horizon: beam and circumsolar light with the sun below it, and the sky it hides.
    Horizon,
    /// The scene's shade on beam light, with the circumsolar light from the same patch of sky.
    BeamShading,
    /// The isotropic sky the scene closes.
    DiffuseShading,
    /// Reflection at the glass.
    Incidence,
    Soiling,
    /// The cells' efficiency away from 1000 W/m², at 25 °C.
    IrradianceLevel,
    /// The cells' temperature away from 25 °C.
    Temperature,
    /// A string's own loss from its layout, on its current.
    String,
    /// Substrings in series and strings in parallel off their own maximum power points, bypass
    /// diodes' drops and optimizers.
    Mismatch,
    /// An MPPT input's voltage window, start voltage and current limit.
    MpptLimits,
    DcCable,
    /// The inverter's efficiency curve.
    Inverter,
    /// What the inverter's AC rating cuts. Not feed-in curtailment, which an export cap makes.
    Clipping,
    AcCable,
}

impl Loss {
    pub const ALL: [Self; 14] = [
        Self::Horizon,
        Self::BeamShading,
        Self::DiffuseShading,
        Self::Incidence,
        Self::Soiling,
        Self::IrradianceLevel,
        Self::Temperature,
        Self::String,
        Self::Mismatch,
        Self::MpptLimits,
        Self::DcCable,
        Self::Inverter,
        Self::Clipping,
        Self::AcCable,
    ];

    /// Stable: a consumer keys on it.
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Horizon => "horizon",
            Self::BeamShading => "beam_shading",
            Self::DiffuseShading => "diffuse_shading",
            Self::Incidence => "incidence",
            Self::Soiling => "soiling",
            Self::IrradianceLevel => "irradiance_level",
            Self::Temperature => "temperature",
            Self::String => "string",
            Self::Mismatch => "mismatch",
            Self::MpptLimits => "mppt_limits",
            Self::DcCable => "dc_cable",
            Self::Inverter => "inverter",
            Self::Clipping => "clipping",
            Self::AcCable => "ac_cable",
        }
    }

    #[must_use]
    pub const fn en(self) -> &'static str {
        match self {
            Self::Horizon => "Horizon",
            Self::BeamShading => "Beam shading",
            Self::DiffuseShading => "Diffuse shading",
            Self::Incidence => "Incidence angle",
            Self::Soiling => "Soiling",
            Self::IrradianceLevel => "Irradiance level",
            Self::Temperature => "Temperature",
            Self::String => "String loss",
            Self::Mismatch => "Mismatch",
            Self::MpptLimits => "MPPT limits",
            Self::DcCable => "DC cable",
            Self::Inverter => "Inverter efficiency",
            Self::Clipping => "Clipping",
            Self::AcCable => "AC cable",
        }
    }

    #[must_use]
    pub const fn de(self) -> &'static str {
        match self {
            Self::Horizon => "Horizont",
            Self::BeamShading => "Verschattung direkt",
            Self::DiffuseShading => "Verschattung diffus",
            Self::Incidence => "Einfallswinkel",
            Self::Soiling => "Verschmutzung",
            Self::IrradianceLevel => "Einstrahlungsniveau",
            Self::Temperature => "Temperatur",
            Self::String => "Strangverlust",
            Self::Mismatch => "Fehlanpassung",
            Self::MpptLimits => "MPPT-Grenzen",
            Self::DcCable => "DC-Leitung",
            Self::Inverter => "Wechselrichter-Wirkungsgrad",
            Self::Clipping => "Kappung am Wechselrichter",
            Self::AcCable => "AC-Leitung",
        }
    }
}

/// The energy left after a loss.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Step {
    pub loss: Loss,
    pub after: Energy,
}

/// Irradiation on the planes as energy at the datasheet's efficiency, and the energy after each
/// loss the run computed. A loss it did not compute is absent.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Chain {
    /// Each module's plane irradiation in kWh/m² times its datasheet kWp (Vmp × Imp), in Wh.
    pub planes: Energy,
    pub steps: Vec<Step>,
}

impl Chain {
    /// The energy after the last loss.
    #[must_use]
    pub fn end(&self) -> Energy {
        self.steps.last().map_or(self.planes, |step| step.after)
    }

    /// Each loss's energy: the energy before it less the energy after it.
    #[must_use]
    pub fn losses(&self) -> Vec<(Loss, Energy)> {
        self.pairs()
            .map(|(before, step)| {
                let lost = Energy {
                    months: std::array::from_fn(|m| {
                        before.months.get(m).copied().unwrap_or(0.0)
                            - step.after.months.get(m).copied().unwrap_or(0.0)
                    }),
                    total: before.total - step.after.total,
                };
                (step.loss, lost)
            })
            .collect()
    }

    /// Each loss as what it leaves over the year, of 1; 1 where nothing reached it.
    #[must_use]
    pub fn factors(&self) -> Vec<(Loss, f64)> {
        self.pairs()
            .map(|(before, step)| {
                let factor = if before.total == 0.0 {
                    1.0
                } else {
                    step.after.total / before.total
                };
                (step.loss, factor)
            })
            .collect()
    }

    fn pairs(&self) -> impl Iterator<Item = (Energy, &Step)> {
        let befores = std::iter::once(self.planes).chain(self.steps.iter().map(|s| s.after));
        befores.zip(&self.steps)
    }

    /// The chains of several inverters added, over the losses all of them have in the same
    /// order from the planes: an inverter without an AC side ends the sum at DC.
    #[must_use]
    pub fn sum<'a>(chains: impl IntoIterator<Item = &'a Self>) -> Self {
        let mut chains = chains.into_iter();
        let Some(first) = chains.next() else {
            return Self::default();
        };
        let mut sum = first.clone();
        for chain in chains {
            let common = sum
                .steps
                .iter()
                .zip(&chain.steps)
                .take_while(|(a, b)| a.loss == b.loss)
                .count();
            sum.steps.truncate(common);
            sum.planes = sum.planes.plus(&chain.planes);
            for (step, other) in sum.steps.iter_mut().zip(&chain.steps) {
                step.after = step.after.plus(&other.after);
            }
        }
        sum
    }
}
