//! One string's current-voltage curve: its substrings in series behind bypass diodes, plus the
//! power its optimizers deliver whatever the current.

use crate::diode::{BYPASS_DROP, Diode, fit};
use crate::perez::{Light, cos_incidence, plane_irradiance_in};
use crate::shade::Casters;
use crate::{Module, ModuleType, PvString, Sky, cell_temperature};

/// Martin and Ruiz 2001, pvlib's default for glass-fronted modules.
const MARTIN_RUIZ_AR: f64 = 0.16;
/// pvlib's `martin_ruiz_diffuse` sky factor stays within 0.951–0.957 from 0° to 90° tilt.
const DIFFUSE_IAM: f64 = 0.95;
/// ADR 17: an optimized module delivers its own maximum power less 1 %.
const OPTIMIZER: f64 = 0.99;
/// Points per curve before refining; a shaded curve has one peak per shade level.
const SAMPLES: u32 = 128;
/// Powers this close are equal: an optimized string delivers the same at any current.
const TIE: f64 = 1e-12;

/// Equal substrings and how many of them.
type Group = (Diode, u32);

/// A string under one sky.
pub struct Curve {
    /// Lit substrings by their circuit.
    groups: Vec<Group>,
    /// Substrings without light, bypassed at any current.
    dark: u32,
    /// What its optimizers deliver, in watts.
    optimized: f64,
    /// The highest current it carries, before the loss.
    pub top: f64,
    /// What the loss leaves, of 1.
    keep: f64,
    /// Its current and voltage before the loss at each sample, from no current up to `top`.
    sampled: Vec<(f64, f64)>,
}

impl Curve {
    #[must_use]
    pub fn new(string: &PvString, sky: &Sky, shade: Shade, open: Open) -> Self {
        let mut curve = Self::empty(1.0 - string.loss / 100.0);
        let Some(reference) = fit(&string.module) else {
            return curve;
        };
        for (k, module) in string.modules.iter().enumerate() {
            let light = open.of(k);
            let groups = substrings(&reference, &string.module, (k, module), (sky, light), shade);
            if module.optimized {
                let mut own = Self::empty(1.0);
                own.add_all(groups);
                let (current, power) = own.peak_of_own();
                curve.optimized = OPTIMIZER.mul_add(power, curve.optimized);
                curve.top = curve.top.max(current);
            } else {
                curve.add_all(groups);
            }
        }
        if curve.top > 0.0 {
            curve.sampled = (0..=SAMPLES)
                .map(|k| sample(curve.top, k))
                .map(|i| (i, curve.voltage(i)))
                .collect();
        }
        curve
    }

    const fn empty(keep: f64) -> Self {
        Self {
            groups: Vec::new(),
            dark: 0,
            optimized: 0.0,
            top: 0.0,
            keep,
            sampled: Vec::new(),
        }
    }

    fn add_all(&mut self, groups: Vec<(Option<Diode>, u32)>) {
        for (diode, count) in groups {
            self.add(diode, count);
        }
    }

    fn add(&mut self, diode: Option<Diode>, count: u32) {
        if count == 0 {
            return;
        }
        let Some(diode) = diode else {
            self.dark += count;
            return;
        };
        self.top = self.top.max(diode.photocurrent);
        match self.groups.iter_mut().find(|(d, _)| same(d, &diode)) {
            Some((_, n)) => *n += count,
            None => self.groups.push((diode, count)),
        }
    }

    /// A module's own maximum power point: its current and power.
    fn peak_of_own(&self) -> (f64, f64) {
        let power = |i: f64| i * self.voltage(i);
        let current = peak(&samples(self.top), &power, |_| true);
        (current, power(current).max(0.0))
    }

    /// Volts at `current` amperes before the loss.
    #[must_use]
    pub fn voltage(&self, current: f64) -> f64 {
        let plain: f64 = self
            .groups
            .iter()
            .map(|(d, n)| f64::from(*n) * d.voltage(current))
            .sum();
        let bypassed = if current > 0.0 {
            f64::from(self.dark) * BYPASS_DROP
        } else {
            0.0
        };
        let optimizers = if self.optimized > 0.0 {
            self.optimized / current
        } else {
            0.0
        };
        plain - bypassed + optimizers
    }

    /// Amperes at `voltage`, after the loss.
    #[must_use]
    pub fn current(&self, voltage: f64) -> f64 {
        let (Some(&open), Some(&short)) = (self.sampled.first(), self.sampled.last()) else {
            return 0.0;
        };
        if voltage >= open.1 {
            return 0.0;
        }
        if voltage <= short.1 {
            return self.top * self.keep;
        }
        // The voltage falls as the current rises: the samples on either side of it hold the
        // current, so the search starts a sample wide.
        let after = self.sampled.partition_point(|(_, v)| *v > voltage);
        let before = after.checked_sub(1).and_then(|k| self.sampled.get(k));
        let low = before.copied().unwrap_or(open);
        let high = self.sampled.get(after).copied().unwrap_or(short);
        let excess = |i: f64| self.voltage(i) - voltage;
        let tolerance = 1e-13 * voltage.abs().max(1.0);
        let ends = [(low.0, low.1 - voltage), (high.0, high.1 - voltage)];
        illinois(&excess, ends, tolerance) * self.keep
    }

    /// Voltages along the curve, from the highest current down.
    pub fn voltages(&self) -> impl Iterator<Item = f64> + '_ {
        self.sampled.iter().skip(1).rev().map(|(_, v)| *v)
    }
}

/// Where the falling `f` crosses zero between two `ends`, each a point and `f` there, by the
/// Illinois method: false position that halves the weight of an end that keeps its place.
fn illinois(f: &impl Fn(f64) -> f64, ends: [(f64, f64); 2], tolerance: f64) -> f64 {
    let [(mut low, mut at_low), (mut high, mut at_high)] = ends;
    if at_high.abs() <= tolerance {
        return high;
    }
    if at_low.abs() <= tolerance {
        return low;
    }
    let top = high;
    let mut moved_low = None;
    let mut x = high;
    for _ in 0..100 {
        let secant = high.mul_add(at_low, -low * at_high) / (at_low - at_high);
        x = if secant > low && secant < high {
            secant
        } else {
            f64::midpoint(low, high)
        };
        let value = f(x);
        if value.abs() <= tolerance || high - low <= 1e-15 * top {
            break;
        }
        let rising = value > 0.0;
        if rising {
            (low, at_low) = (x, value);
        } else {
            (high, at_high) = (x, value);
        }
        match (moved_low, rising) {
            (Some(true), true) => at_high /= 2.0,
            (Some(false), false) => at_low /= 2.0,
            _ => {}
        }
        moved_low = Some(rising);
    }
    x
}

/// Where a string's shaded substrings come from.
#[derive(Clone, Copy)]
pub enum Shade<'a> {
    /// Traced toward the sky's sun.
    Traced(&'a Casters),
    /// Looked up: each of the string's substrings, module by module, shaded or not.
    Looked(&'a [bool]),
}

impl Shade<'_> {
    /// How many substrings of the string's `k`th module lose their beam.
    fn of(self, module_type: &ModuleType, (k, module): (usize, &Module)) -> u8 {
        match self {
            Self::Traced(casters) => module.place.map_or(0, |place| {
                casters.shaded_substrings(module_type, module.plane, place)
            }),
            Self::Looked(shaded) => {
                let parts = usize::from(module_type.bypass_diodes.max(1));
                let of_module = shaded.get(k * parts..(k + 1) * parts).unwrap_or_default();
                let count = of_module.iter().filter(|&&s| s).count();
                u8::try_from(count).unwrap_or(u8::MAX)
            }
        }
    }
}

/// What a horizon leaves a string's modules (ADR 17).
#[derive(Clone, Copy)]
pub struct Open<'a> {
    /// The sun stands above the horizon.
    pub sun: bool,
    /// Each module's sky view; empty for the whole sky.
    pub views: &'a [f64],
}

impl Open<'_> {
    /// No horizon.
    pub const SKY: Open<'static> = Open {
        sun: true,
        views: &[],
    };

    fn of(self, k: usize) -> Light {
        Light {
            sun: self.sun,
            view: self.views.get(k).copied().unwrap_or(1.0),
        }
    }
}

/// A module's substrings under one sky: lit or shaded, by circuit; `None` in the dark.
fn substrings(
    reference: &Diode,
    module_type: &ModuleType,
    (k, module): (usize, &Module),
    (sky, light): (&Sky, Light),
    shade: Shade,
) -> Vec<(Option<Diode>, u32)> {
    let poa = plane_irradiance_in(module.plane, sky, light);
    let diffuse_light = poa.sky_diffuse + poa.ground_diffuse;
    let beam = poa.beam * incidence_loss(cos_incidence(module.plane, sky.sun));
    let diffuse = diffuse_light * DIFFUSE_IAM;
    let cell = cell_temperature(poa.beam + diffuse_light, sky.temperature, sky.wind);
    let parts = module_type.bypass_diodes.max(1);
    let shaded = if beam > 0.0 {
        shade.of(module_type, (k, module))
    } else {
        0
    };
    let circuit = |effective| reference.substring(module_type, parts, effective, cell);
    vec![
        (circuit(beam + diffuse), u32::from(parts - shaded)),
        (circuit(diffuse), u32::from(shaded)),
    ]
}

/// The fraction of beam light the glass lets through.
fn incidence_loss(cos_aoi: f64) -> f64 {
    if cos_aoi <= 0.0 {
        return 0.0;
    }

    (1.0 - (-cos_aoi / MARTIN_RUIZ_AR).exp()) / (1.0 - (-1.0 / MARTIN_RUIZ_AR).exp())
}

const fn same(a: &Diode, b: &Diode) -> bool {
    a.photocurrent.to_bits() == b.photocurrent.to_bits()
        && a.saturation_current.to_bits() == b.saturation_current.to_bits()
        && a.shunt_resistance.to_bits() == b.shunt_resistance.to_bits()
        && a.ideality.to_bits() == b.ideality.to_bits()
}

/// The `k`th of the evenly spaced currents from zero up to `top`.
fn sample(top: f64, k: u32) -> f64 {
    top * f64::from(k) / f64::from(SAMPLES)
}

/// Evenly spaced currents above zero up to `top`.
fn samples(top: f64) -> Vec<f64> {
    (1..=SAMPLES).map(|k| sample(top, k)).collect()
}

/// Where `f` peaks among ascending `points` admitted by `admit`, each local peak refined by
/// golden section between its neighbours. Ties go to the first point.
pub fn peak(points: &[f64], f: &impl Fn(f64) -> f64, admit: impl Fn(f64) -> bool) -> f64 {
    let mut points: Vec<f64> = points.iter().copied().filter(|p| admit(*p)).collect();
    // Equal strings in parallel offer each point twice, and each pair would pass for a peak.
    points.dedup();
    let values: Vec<f64> = points.iter().map(|p| f(*p)).collect();
    let mut best = (f64::NAN, f64::NEG_INFINITY);
    for (k, (&x, &y)) in points.iter().zip(&values).enumerate() {
        let before = k.checked_sub(1).and_then(|k| values.get(k)).copied();
        let after = values.get(k + 1).copied();
        if [before, after]
            .into_iter()
            .flatten()
            .any(|n| n > y * (1.0 + TIE))
        {
            continue;
        }
        let low = k
            .checked_sub(1)
            .and_then(|k| points.get(k))
            .copied()
            .unwrap_or(x);
        let high = points.get(k + 1).copied().unwrap_or(x);
        let refined = golden(f, low, high);
        let (x, y) = if f(refined) > y * (1.0 + TIE) {
            (refined, f(refined))
        } else {
            (x, y)
        };
        if y > best.1 * (1.0 + TIE) || best.0.is_nan() {
            best = (x, y);
        }
    }
    best.0
}

/// The maximum of a unimodal `f` on `[low, high]`.
fn golden(f: &impl Fn(f64) -> f64, mut low: f64, mut high: f64) -> f64 {
    let ratio = (5.0f64.sqrt() - 1.0) / 2.0;
    let mut a = ratio.mul_add(-(high - low), high);
    let mut b = ratio.mul_add(high - low, low);
    let (mut fa, mut fb) = (f(a), f(b));
    for _ in 0..100 {
        if (high - low).abs() <= 1e-13 * high.abs().max(1.0) {
            break;
        }
        if fa < fb {
            low = a;
            a = b;
            fa = fb;
            b = ratio.mul_add(high - low, low);
            fb = f(b);
        } else {
            high = b;
            b = a;
            fb = fa;
            a = ratio.mul_add(-(high - low), high);
            fa = f(a);
        }
    }
    f64::midpoint(low, high)
}
