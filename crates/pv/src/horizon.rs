//! A horizon profile (ADR 17): the far horizon's elevation by azimuth, which the caller supplies
//! to a run and the layout never stores.

use std::fmt;

use crate::shading::sky_view;
use crate::string::Open;
use crate::{Layout, Plane, Sun};

/// One per degree.
const DEGREES: usize = 360;

/// Elevations at each whole degree of azimuth from −180 going east, interpolated between them.
#[derive(Debug, Clone, PartialEq)]
pub struct Horizon {
    elevations: Vec<f64>,
}

/// Why a profile is refused.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HorizonRefused {
    /// It holds this many pairs, not 360.
    Length(usize),
    /// A pair stands at this azimuth, not at its degree.
    Azimuth(f64),
    /// The elevation at an azimuth is outside 0 to 90.
    Elevation { azimuth: f64, elevation: f64 },
}

impl fmt::Display for HorizonRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Length(n) => write!(f, "a horizon holds 360 pairs, one per degree, not {n}"),
            Self::Azimuth(azimuth) => {
                write!(
                    f,
                    "a horizon's pairs run from -180 by one degree, not at {azimuth}"
                )
            }
            Self::Elevation { azimuth, elevation } => {
                write!(
                    f,
                    "a horizon's elevation at {azimuth} is {elevation}, not 0 to 90"
                )
            }
        }
    }
}

impl std::error::Error for HorizonRefused {}

impl Horizon {
    /// From `[azimuth, elevation]` pairs in degrees, one per degree from −180 going east.
    ///
    /// # Errors
    ///
    /// Any other shape, or an elevation outside 0 to 90.
    pub fn new(profile: &[[f64; 2]]) -> Result<Self, HorizonRefused> {
        if profile.len() != DEGREES {
            return Err(HorizonRefused::Length(profile.len()));
        }
        for (&[azimuth, elevation], degree) in profile.iter().zip(-180_i16..) {
            if (azimuth - f64::from(degree)).abs() > 1e-9 {
                return Err(HorizonRefused::Azimuth(azimuth));
            }
            if !(0.0..=90.0).contains(&elevation) {
                return Err(HorizonRefused::Elevation { azimuth, elevation });
            }
        }
        Ok(Self {
            elevations: profile.iter().map(|&[_, elevation]| elevation).collect(),
        })
    }

    /// The elevation at `azimuth`, linear between the degrees on either side, wrapping at north.
    #[must_use]
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "floored within one turn first"
    )]
    pub fn elevation(&self, azimuth: f64) -> f64 {
        let from_north = (azimuth + 180.0).rem_euclid(360.0);
        let below = from_north.floor();
        let k = below as usize % DEGREES;
        let at = |k: usize| self.elevations.get(k % DEGREES).copied().unwrap_or(0.0);
        let share = from_north - below;
        share.mul_add(at(k + 1) - at(k), at(k))
    }
}

/// A horizon laid over a layout for one run: each module's sky view, in layout order.
pub struct Trimmed<'a> {
    horizon: &'a Horizon,
    views: Vec<f64>,
    /// Where each string's modules start in `views`, and where the last ends.
    starts: Vec<usize>,
}

impl<'a> Trimmed<'a> {
    pub fn new(layout: &Layout, horizon: &'a Horizon) -> Self {
        let strings = layout
            .inverters
            .iter()
            .flat_map(|inverter| &inverter.inputs)
            .flat_map(|input| &input.strings);
        let mut planes: Vec<(Plane, f64)> = Vec::new();
        let mut views = Vec::new();
        let mut starts = vec![0];
        for string in strings {
            for module in &string.modules {
                views.push(view_of(&mut planes, module.plane, horizon));
            }
            starts.push(views.len());
        }
        Self {
            horizon,
            views,
            starts,
        }
    }

    /// What the horizon leaves the layout's `string`th string under `sun`.
    pub fn open(&self, sun: Sun, string: usize) -> Open<'_> {
        let views = match (self.starts.get(string), self.starts.get(string + 1)) {
            (Some(&start), Some(&stop)) => self.views.get(start..stop).unwrap_or_default(),
            _ => &[],
        };
        Open {
            sun: 90.0 - sun.zenith >= self.horizon.elevation(sun.azimuth),
            views,
        }
    }
}

/// `plane`'s sky view under `horizon`, computed once per plane: most modules share a few.
fn view_of(planes: &mut Vec<(Plane, f64)>, plane: Plane, horizon: &Horizon) -> f64 {
    if let Some(&(_, view)) = planes.iter().find(|(known, _)| *known == plane) {
        return view;
    }
    let view = sky_view(plane, horizon);
    planes.push((plane, view));
    view
}
