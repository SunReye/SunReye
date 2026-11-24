//! One string's current-voltage curve: its substrings in series behind bypass diodes, plus the
//! power its optimizers deliver whatever the current.

use crate::diode::{BYPASS_DROP, Diode, fit};
use crate::perez::{Light, Split, cos_incidence};
use crate::shade::Casters;
use crate::{Module, ModuleType, PvString, Sky, cell_temperature};

/// Martin and Ruiz 2001, pvlib's default for glass-fronted modules.
const MARTIN_RUIZ_AR: f64 = 0.16;
/// pvlib's `martin_ruiz_diffuse` sky factor stays within 0.951–0.957 from 0° to 90° tilt.
const DIFFUSE_IAM: f64 = 0.95;
/// ADR 17: an optimized module delivers its own maximum power less 1 %.
const OPTIMIZER: f64 = 0.99;
/// Substrings at one temperature whose effective irradiance lies within this share above the
/// dimmest of them share one circuit: each distinct circuit costs a diode solve wherever the
/// curve is read.
const MERGE: f64 = 0.02;
/// Points per curve before refining; a shaded curve has one peak per shade level.
const SAMPLES: u32 = 128;
/// Powers this close are equal: an optimized string delivers the same at any current.
const TIE: f64 = 1e-12;

#[cfg(test)]
thread_local! {
    /// Each substring its own circuit: the reference merging is measured against.
    pub static EXACT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

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

/// A string's watts at each stage of the loss chain before its own curve (ADR 17).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Tally {
    /// Light at the datasheet's efficiency: on the planes, past the horizon, past the scene's
    /// beam shade, past its diffuse shade, through the glass, past the dirt.
    pub light: [f64; LIGHT],
    /// Every lit substring at its own maximum power point at 25 °C, then at its cells'
    /// temperature, then after the string's loss.
    pub cool: f64,
    pub warm: f64,
    pub kept: f64,
}

impl Tally {
    /// Several tallies added stage by stage.
    pub fn sum(tallies: &[Self]) -> Self {
        tallies.iter().fold(Self::default(), |sum, t| Self {
            light: std::array::from_fn(|n| {
                sum.light.get(n).copied().unwrap_or(0.0) + t.light.get(n).copied().unwrap_or(0.0)
            }),
            cool: sum.cool + t.cool,
            warm: sum.warm + t.warm,
            kept: sum.kept + t.kept,
        })
    }
}

/// The optical stages a tally holds.
pub const LIGHT: usize = 6;

/// Solves a string's substrings at their own maximum power points for its tally.
struct Owner<'a> {
    reference: &'a Diode,
    module: &'a ModuleType,
    /// Each substring's datasheet watts per W/m².
    nominal: f64,
    keep: f64,
    /// Solved: the own maximum power at 25 °C and at the cells' temperature by effective
    /// irradiance and cell temperature, so substrings alike are solved once.
    owns: Vec<((u64, u64), f64, f64)>,
}

impl Owner<'_> {
    /// Adds a module's substrings' light, `lit`, to `tally`.
    fn light(&self, tally: &mut Tally, lit: &Lit) {
        for part in &lit.parts {
            for (sum, light) in tally.light.iter_mut().zip(part.light) {
                *sum = self.nominal.mul_add(light, *sum);
            }
        }
    }

    /// Adds substrings, by the circuits they share, at their own maximum power points to `tally`.
    fn add(&mut self, tally: Option<&mut Tally>, shared: &[Shared]) {
        let Some(tally) = tally else {
            return;
        };
        for circuit in shared {
            let (cool, warm) = self.own(circuit);
            let count = f64::from(circuit.count);
            tally.cool = count.mul_add(cool, tally.cool);
            tally.warm = count.mul_add(warm, tally.warm);
            tally.kept = (self.keep * count).mul_add(warm, tally.kept);
        }
    }

    /// A shared circuit's own maximum power at 25 °C and at its cells' temperature.
    fn own(&mut self, shared: &Shared) -> (f64, f64) {
        let Some(circuit) = shared.circuit else {
            return (0.0, 0.0);
        };
        let key = (shared.effective.to_bits(), shared.cell.to_bits());
        if let Some(&(_, cool, warm)) = self.owns.iter().find(|(k, _, _)| *k == key) {
            return (cool, warm);
        }
        let parts = self.module.bypass_diodes.max(1);
        let cool = self
            .reference
            .substring(self.module, parts, shared.effective, STC_CELL)
            .map_or(0.0, |d| peak_power(&d));
        let warm = peak_power(&circuit);
        self.owns.push((key, cool, warm));
        (cool, warm)
    }
}

impl Curve {
    #[cfg(test)]
    #[must_use]
    pub fn new(string: &PvString, sky: &Sky, shade: Shade, open: Open) -> Self {
        Self::tallied(string, sky, shade, open, None)
    }

    /// The same, adding the string's stages of the loss chain to `tally`, if any.
    #[must_use]
    pub fn tallied(
        string: &PvString,
        sky: &Sky,
        shade: Shade,
        open: Open,
        mut tally: Option<&mut Tally>,
    ) -> Self {
        let keep = 1.0 - string.loss / 100.0;
        let mut curve = Self::empty(keep);
        let Some(reference) = fit(&string.module) else {
            return curve;
        };
        let parts = string.module.bypass_diodes.max(1);
        let mut owner = Owner {
            reference: &reference,
            module: &string.module,
            nominal: string.module.vmp * string.module.imp / f64::from(parts) / 1000.0,
            keep,
            owns: Vec::new(),
        };
        let circuits = |lights: &mut Vec<(f64, f64)>| {
            circuits(&reference, &string.module, std::mem::take(lights))
        };
        // The string's plain substrings, merged across modules.
        let mut plain = Vec::new();
        for (k, module) in string.modules.iter().enumerate() {
            let lit = substrings(&string.module, (k, module), (sky, open), shade);
            if let Some(tally) = tally.as_deref_mut() {
                owner.light(tally, &lit);
            }
            let mut lights: Vec<_> = lit
                .parts
                .iter()
                .map(|part| (part.effective, lit.cell))
                .collect();
            if module.optimized {
                let shared = circuits(&mut lights);
                owner.add(tally.as_deref_mut(), &shared);
                let mut own = Self::empty(1.0);
                own.add_all(&shared);
                let (current, power) = own.peak_of_own();
                curve.optimized = OPTIMIZER.mul_add(power, curve.optimized);
                curve.top = curve.top.max(current);
            } else {
                plain.append(&mut lights);
            }
        }
        let shared = circuits(&mut plain);
        owner.add(tally, &shared);
        curve.add_all(&shared);
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

    fn add_all(&mut self, shared: &[Shared]) {
        for circuit in shared {
            self.add(circuit.circuit, circuit.count);
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
    /// Looked up: how much of each of the string's substrings, module by module, lies in shade.
    Looked(&'a [u8]),
}

impl Shade<'_> {
    /// Marks each substring of the string's `k`th module, in `shaded`, that loses its beam.
    fn mark(self, module_type: &ModuleType, (k, module): (usize, &Module), shaded: &mut [bool]) {
        match self {
            Self::Traced(casters) => {
                if let Some(place) = module.place {
                    casters.mark(module_type, module.plane, place, shaded);
                }
            }
            Self::Looked(looked) => {
                let parts = shaded.len();
                let of_module = looked.get(k * parts..(k + 1) * parts).unwrap_or_default();
                for (mark, &looked) in shaded.iter_mut().zip(of_module) {
                    *mark = looked > 0;
                }
            }
        }
    }
}

/// What a horizon and the scene leave a string's substrings of the sky (ADR 17).
#[derive(Clone, Copy)]
pub struct Open<'a> {
    /// The sun stands above the horizon.
    pub sun: bool,
    /// Each substring's sky view, module by module; empty for the whole sky.
    pub views: &'a [f64],
    /// Each substring's plane's view above the horizon alone, the same indexing: what its cells
    /// warm by.
    pub warming: &'a [f64],
    /// What soiling leaves of the light reaching the cells, of 1.
    pub clean: f64,
}

impl Open<'_> {
    /// No horizon, and no diffuse shade.
    pub const SKY: Open<'static> = Open {
        sun: true,
        views: &[],
        warming: &[],
        clean: 1.0,
    };

    /// The sky view of each of the `k`th module's `parts` substrings.
    fn of(self, k: usize, parts: usize) -> impl Iterator<Item = f64> {
        let views = self
            .views
            .get(k * parts..(k + 1) * parts)
            .unwrap_or_default();
        (0..parts).map(move |part| views.get(part).copied().unwrap_or(1.0))
    }

    /// The view the `k`th module's cells warm by, which is also its plane's view above the
    /// horizon alone.
    fn warming(self, k: usize, parts: usize) -> f64 {
        self.warming.get(k * parts).copied().unwrap_or(1.0)
    }
}

/// A module's substrings under one sky and their cells' temperature.
struct Lit {
    parts: Vec<Part>,
    cell: f64,
}

/// A substring's effective irradiance and its light at each optical stage of the loss chain, in
/// W/m².
struct Part {
    effective: f64,
    light: [f64; LIGHT],
}

/// Substrings that share one circuit: it, `None` in the dark; how many; and their mean effective
/// irradiance and cells' temperature.
struct Shared {
    circuit: Option<Diode>,
    count: u32,
    effective: f64,
    cell: f64,
}

/// A circuit's own maximum power, in watts. Power is flat at its peak, so a current to 1e-8
/// leaves it within 1e-15.
fn peak_power(circuit: &Diode) -> f64 {
    let power = |i: f64| i * circuit.voltage(i);
    power(golden_within(&power, 0.0, circuit.photocurrent, 1e-8)).max(0.0)
}

/// The cell temperature of standard test conditions, in °C.
const STC_CELL: f64 = 25.0;

/// A module's substrings under one sky, each with its own sky view: the effective irradiance
/// each takes, in W/m², with its light at each optical stage, and its cells' temperature. A
/// shaded substring loses its beam and the circumsolar part of its diffuse light, which come
/// from the same patch of sky.
fn substrings(
    module_type: &ModuleType,
    (k, module): (usize, &Module),
    (sky, open): (&Sky, Open),
    shade: Shade,
) -> Lit {
    let split = Split::of(module.plane, sky);
    let parts = module_type.bypass_diodes.max(1);
    let views: Vec<f64> = open.of(k, usize::from(parts)).collect();
    let beam = split.beam * incidence_loss(cos_incidence(module.plane, sky.sun));
    let mut shaded = vec![false; usize::from(parts)];
    if open.sun && (beam > 0.0 || split.circumsolar > 0.0) {
        shade.mark(module_type, (k, module), &mut shaded);
    }
    // The scene's shade, of beam or of sky, leaves the cells' warmth: modules alike stay alike.
    let open_sky = Light {
        sun: open.sun,
        view: open.warming(k, usize::from(parts)),
    };
    let warming =
        if open.sun { split.beam } else { 0.0 } + split.sky_diffuse(open_sky) + split.ground;
    let cell = cell_temperature(warming, sky.temperature, sky.wind);
    let horizon_view = open_sky.view;
    let parts = views
        .iter()
        .zip(&shaded)
        .map(|(&view, &shaded)| {
            let sun = open.sun && !shaded;
            let diffuse = (split.sky_diffuse(Light { sun, view }) + split.ground) * DIFFUSE_IAM;
            let glass = if sun { beam + diffuse } else { diffuse };
            let effective = glass * open.clean;
            let seen = |sun: bool, view| {
                (if sun { split.beam } else { 0.0 })
                    + split.sky_diffuse(Light { sun, view })
                    + split.ground
            };
            Part {
                effective,
                light: [
                    seen(true, 1.0),
                    seen(open.sun, horizon_view),
                    seen(sun, horizon_view),
                    seen(sun, view),
                    glass,
                    effective,
                ],
            }
        })
        .collect();
    Lit { parts, cell }
}

/// The circuits of substrings, each its effective irradiance and cell temperature: those at one
/// temperature within `MERGE` above the dimmest of them share one at their mean irradiance,
/// which keeps their summed photocurrent and shunt conductance, both proportional to it.
fn circuits(
    reference: &Diode,
    module_type: &ModuleType,
    mut lights: Vec<(f64, f64)>,
) -> Vec<Shared> {
    let parts = module_type.bypass_diodes.max(1);
    let width = merge();
    lights.sort_by(|(a, hot), (b, warm)| hot.total_cmp(warm).then(a.total_cmp(b)));
    let mut merged = Vec::new();
    let mut rest = lights.as_slice();
    while let Some(&(dimmest, cell)) = rest.first() {
        let alike = |&&(effective, at): &&(f64, f64)| {
            at.to_bits() == cell.to_bits() && effective <= width.mul_add(dimmest.abs(), dimmest)
        };
        let n = rest.iter().take_while(alike).count();
        let (these, after) = rest.split_at(n);
        // Summed from the dimmest, so substrings alike keep their irradiance to the bit.
        let above: f64 = these.iter().map(|(effective, _)| effective - dimmest).sum();
        let count = u32::try_from(n).unwrap_or(u32::MAX);
        let mean = above / f64::from(count) + dimmest;
        merged.push(Shared {
            circuit: reference.substring(module_type, parts, mean, cell),
            count,
            effective: mean,
            cell,
        });
        rest = after;
    }
    merged
}

#[cfg(test)]
fn merge() -> f64 {
    if EXACT.get() { 0.0 } else { MERGE }
}

#[cfg(not(test))]
const fn merge() -> f64 {
    MERGE
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
fn golden(f: &impl Fn(f64) -> f64, low: f64, high: f64) -> f64 {
    golden_within(f, low, high, 1e-13)
}

/// The same to within `tolerance` of the current, relative.
fn golden_within(f: &impl Fn(f64) -> f64, mut low: f64, mut high: f64, tolerance: f64) -> f64 {
    let ratio = (5.0f64.sqrt() - 1.0) / 2.0;
    let mut a = ratio.mul_add(-(high - low), high);
    let mut b = ratio.mul_add(high - low, low);
    let (mut fa, mut fb) = (f(a), f(b));
    for _ in 0..100 {
        if (high - low).abs() <= tolerance * high.abs().max(1.0) {
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
