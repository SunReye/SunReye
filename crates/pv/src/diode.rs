//! De Soto's single-diode model, as pvlib's `fit_desoto`, `calcparams_desoto` and `v_from_i`.

use crate::ModuleType;

/// Boltzmann's constant in eV/K, as scipy's.
const BOLTZMANN: f64 = 8.617_333_262_145_179e-5;
/// Silicon's band gap in eV and its change per kelvin, pvlib's defaults.
const BAND_GAP: f64 = 1.121;
const BAND_GAP_DRIFT: f64 = -0.000_267_7;
/// Standard test conditions.
const STC_IRRADIANCE: f64 = 1000.0;
const STC_KELVIN: f64 = 298.15;
const KELVIN: f64 = 273.15;
/// A conducting bypass diode's forward drop, as pvlib's partial-shading example.
pub const BYPASS_DROP: f64 = 0.5;
/// About 0.68 V per cell; only seeds the fit.
const CELL_VOC: f64 = 0.68;
const IDEALITY_SEED: f64 = 1.2;

/// One single-diode circuit: photocurrent, saturation current, series and shunt resistance in
/// amperes and ohms, and the modified ideality factor in volts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Diode {
    pub photocurrent: f64,
    pub saturation_current: f64,
    pub series_resistance: f64,
    pub shunt_resistance: f64,
    pub ideality: f64,
}

/// A module type's circuit at standard test conditions, or `None` when its datasheet has none.
#[must_use]
pub fn fit(module: &ModuleType) -> Option<Diode> {
    let datasheet = Datasheet::from(module);
    let seed = IDEALITY_SEED * BOLTZMANN * STC_KELVIN * module.voc / CELL_VOC;
    let saturation = module.isc * (-module.voc / seed).exp();
    let series = seed.mul_add(
        ((module.isc - module.imp) / saturation).ln_1p(),
        -module.vmp,
    ) / module.imp;
    let mut x = [series, 100.0f64.ln(), seed];
    let mut error = norm(datasheet.residuals(x)?);
    for _ in 0..200 {
        if error < 1e-13 {
            return datasheet.diode(x);
        }
        let step = newton_step(&datasheet, x)?;
        let mut scale = 1.0f64;
        loop {
            let next = [
                scale.mul_add(-step[0], x[0]),
                scale.mul_add(-step[1], x[1]),
                scale.mul_add(-step[2], x[2]),
            ];
            match datasheet.residuals(next) {
                Some(r) if norm(r) < error => {
                    x = next;
                    error = norm(r);
                    break;
                }
                _ if scale < 1e-9 => return (error < 1e-9).then(|| datasheet.diode(x)).flatten(),
                _ => scale /= 2.0,
            }
        }
    }
    None
}

/// The datasheet in the fit's units: amperes, volts and their changes per kelvin.
struct Datasheet {
    isc: f64,
    voc: f64,
    imp: f64,
    vmp: f64,
    beta_voc: f64,
    alpha_sc: f64,
}

impl From<&ModuleType> for Datasheet {
    fn from(m: &ModuleType) -> Self {
        Self {
            isc: m.isc,
            voc: m.voc,
            imp: m.imp,
            vmp: m.vmp,
            beta_voc: m.voltage_coefficient / 100.0 * m.voc,
            alpha_sc: m.current_coefficient / 100.0 * m.isc,
        }
    }
}

impl Datasheet {
    /// The circuit for series resistance, log shunt resistance and ideality: short and open
    /// circuit fix the photocurrent and the saturation current.
    fn diode(&self, [series, log_shunt, ideality]: [f64; 3]) -> Option<Diode> {
        let shunt = log_shunt.exp();
        let saturation = self.isc.mul_add(1.0 + series / shunt, -self.voc / shunt)
            / ((self.voc / ideality).exp_m1() - (self.isc * series / ideality).exp_m1());
        let diode = Diode {
            photocurrent: saturation.mul_add((self.voc / ideality).exp_m1(), self.voc / shunt),
            saturation_current: saturation,
            series_resistance: series,
            shunt_resistance: shunt,
            ideality,
        };
        let physical = series >= 0.0 && ideality > 0.0 && saturation > 0.0;
        (physical && diode.photocurrent.is_finite()).then_some(diode)
    }

    /// De Soto's maximum power point, its zero slope, and open circuit 2 K warmer.
    fn residuals(&self, x: [f64; 3]) -> Option<[f64; 3]> {
        let d = self.diode(x)?;
        let (il, io, rs, rsh, a) = (
            d.photocurrent,
            d.saturation_current,
            d.series_resistance,
            d.shunt_resistance,
            d.ideality,
        );
        let mp = self.imp.mul_add(rs, self.vmp);
        let at_mp = io.mul_add(-(mp / a).exp_m1(), il) - mp / rsh - self.imp;
        let growth = (mp / a).exp();
        let slope = self.imp
            - self.vmp * (io / a).mul_add(growth, 1.0 / rsh)
                / (io * rs / a).mul_add(growth, 1.0 + rs / rsh);
        let warm = STC_KELVIN + 2.0;
        let voc = 2.0f64.mul_add(self.beta_voc, self.voc);
        let a2 = a * warm / STC_KELVIN;
        let il2 = 2.0f64.mul_add(self.alpha_sc, il);
        let io2 = io * saturation_drift(warm);
        let open = io2.mul_add((voc / a2).exp_m1(), voc / rsh) - il2;
        let r = [at_mp, slope, open];
        r.iter().all(|v| v.is_finite()).then_some(r)
    }
}

fn norm(r: [f64; 3]) -> f64 {
    r.iter().map(|v| v * v).sum::<f64>().sqrt()
}

/// Newton's step from a forward-difference Jacobian.
fn newton_step(datasheet: &Datasheet, x: [f64; 3]) -> Option<[f64; 3]> {
    let r = datasheet.residuals(x)?;
    let mut jacobian = [[0.0; 3]; 3];
    for column in 0..3 {
        let mut probe = x;
        let value = probe.get_mut(column)?;
        let h = 1e-7 * value.abs().max(1e-6);
        *value += h;
        let shifted = datasheet.residuals(probe)?;
        for (row, (s, base)) in jacobian.iter_mut().zip(shifted.iter().zip(r)) {
            *row.get_mut(column)? = (s - base) / h;
        }
    }
    solve(jacobian, r)
}

/// Cramer's rule for three unknowns.
fn solve(matrix: [[f64; 3]; 3], rhs: [f64; 3]) -> Option<[f64; 3]> {
    let whole = determinant(matrix);
    if whole.abs() < f64::MIN_POSITIVE {
        return None;
    }
    let replaced = |column: usize| {
        let mut swapped = matrix;
        for (row, value) in swapped.iter_mut().zip(rhs) {
            if let Some(cell) = row.get_mut(column) {
                *cell = value;
            }
        }
        determinant(swapped) / whole
    };
    Some([replaced(0), replaced(1), replaced(2)])
}

#[expect(
    clippy::many_single_char_names,
    reason = "a matrix's cells, as textbooks name them"
)]
fn determinant([[a, b, c], [d, e, f], [g, h, i]]: [[f64; 3]; 3]) -> f64 {
    c.mul_add(
        d.mul_add(h, -e * g),
        a.mul_add(e.mul_add(i, -f * h), -b * d.mul_add(i, -f * g)),
    )
}

/// How the saturation current grows from standard test conditions to `kelvin`.
fn saturation_drift(kelvin: f64) -> f64 {
    let gap = BAND_GAP * BAND_GAP_DRIFT.mul_add(kelvin - STC_KELVIN, 1.0);
    (kelvin / STC_KELVIN).powi(3)
        * (BAND_GAP / (BOLTZMANN * STC_KELVIN) - gap / (BOLTZMANN * kelvin)).exp()
}

impl Diode {
    /// One of `substrings` equal parts of the module this circuit fits, at an effective
    /// irradiance in W/m² and a cell temperature in °C; `None` in the dark.
    #[must_use]
    pub fn substring(
        &self,
        module: &ModuleType,
        substrings: u8,
        effective: f64,
        cell: f64,
    ) -> Option<Self> {
        if effective <= 0.0 {
            return None;
        }
        let kelvin = cell + KELVIN;
        let alpha_sc = module.current_coefficient / 100.0 * module.isc;
        let parts = f64::from(substrings);
        Some(Self {
            photocurrent: effective / STC_IRRADIANCE
                * alpha_sc.mul_add(kelvin - STC_KELVIN, self.photocurrent),
            saturation_current: self.saturation_current * saturation_drift(kelvin),
            series_resistance: self.series_resistance / parts,
            shunt_resistance: self.shunt_resistance * STC_IRRADIANCE / effective / parts,
            ideality: self.ideality * kelvin / STC_KELVIN / parts,
        })
    }

    /// The voltage at `current`, held at the bypass diode's drop below zero.
    #[must_use]
    pub fn voltage(&self, current: f64) -> f64 {
        let (il, io, a) = (self.photocurrent, self.saturation_current, self.ideality);
        let conductance = 1.0 / self.shunt_resistance;
        // Across the diode: x = V + I·Rs, and the current balance falls as x rises.
        let balance = |x: f64| x.mul_add(-conductance, io.mul_add(-(x / a).exp_m1(), il)) - current;
        let mut low = current.mul_add(self.series_resistance, -BYPASS_DROP);
        if balance(low) <= 0.0 {
            return -BYPASS_DROP;
        }
        let mut high = a.mul_add(((il - current).max(0.0) / io).ln_1p(), f64::EPSILON);
        let mut x = high;
        for _ in 0..200 {
            let value = balance(x);
            if value > 0.0 {
                low = x;
            } else {
                high = x;
            }
            let slope = (-io / a).mul_add((x / a).exp(), -conductance);
            let newton = x - value / slope;
            let precision = 1e-14 * x.abs().max(1.0);
            if (newton - x).abs() <= precision {
                x = newton;
                break;
            }
            x = if newton > low && newton < high {
                newton
            } else {
                low.midpoint(high)
            };
            if high - low <= precision {
                break;
            }
        }
        current.mul_add(-self.series_resistance, x)
    }
}
