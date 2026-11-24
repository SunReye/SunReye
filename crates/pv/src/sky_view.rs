//! Diffuse shading (ADR 17): the share of the isotropic sky each substring sees over the shading
//! table's grid, above the horizon profile the caller supplies and past the scene.

use crate::shading::{AZIMUTHS, ELEVATIONS, STEP, sun_at};
use crate::string::Open;
use crate::{Horizon, Layout, Plane, ShadingTable, Sun};

/// Each substring's sky view, in layout order, computed once for every instant run under one
/// scene and horizon.
#[derive(Debug, Clone)]
pub struct SkyViews<'a> {
    horizon: Option<&'a Horizon>,
    views: Vec<f64>,
    /// Each substring's plane's view above the horizon alone, which its cells warm by.
    warming: Vec<f64>,
    /// Where each string's substrings start in `views`, and where the last ends.
    starts: Vec<usize>,
}

impl<'a> SkyViews<'a> {
    /// Refreshes `table` for `layout` first: a node a substring's beam is shaded at is closed to
    /// its diffuse light too.
    pub fn new(layout: &Layout, table: &mut ShadingTable, horizon: Option<&'a Horizon>) -> Self {
        table.refresh(layout);
        let strings = layout
            .inverters
            .iter()
            .flat_map(|inverter| &inverter.inputs)
            .flat_map(|input| &input.strings);
        let mut planes: Vec<(Plane, Weights)> = Vec::new();
        // Each substring's plane's weights, as an index into `planes`.
        let mut of_plane = Vec::new();
        let mut starts = vec![0];
        for string in strings {
            let parts = usize::from(string.module.bypass_diodes.max(1));
            for module in &string.modules {
                let k = weights_of(&mut planes, module.plane, horizon);
                of_plane.extend(std::iter::repeat_n(k, parts));
            }
            starts.push(of_plane.len());
        }
        let weights: Vec<&Weights> = of_plane
            .iter()
            .filter_map(|&k| planes.get(k).map(|(_, weights)| weights))
            .collect();
        let mut closed = vec![0.0; weights.len()];
        for (node, row) in table.rows().enumerate() {
            let shut = closed
                .iter_mut()
                .zip(&weights)
                .zip(row)
                .filter(|(_, s)| **s);
            for ((closed, weights), _) in shut {
                *closed += weights.open.get(node).copied().unwrap_or(0.0);
            }
        }
        let views = weights
            .iter()
            .zip(&closed)
            .map(|(w, &c)| w.view(c))
            .collect();
        let warming = weights.iter().map(|w| w.view(0.0)).collect();
        Self {
            horizon,
            views,
            warming,
            starts,
        }
    }

    /// What the horizon and the scene leave the layout's `string`th string under `sun`.
    pub(crate) fn open(&self, sun: Sun, string: usize) -> Open<'_> {
        Open {
            sun: self
                .horizon
                .is_none_or(|h| 90.0 - sun.zenith >= h.elevation(sun.azimuth)),
            views: self.of(string),
            warming: self.part(&self.warming, string),
        }
    }

    /// The `string`th string's substrings' views, module by module.
    pub(crate) fn of(&self, string: usize) -> &[f64] {
        self.part(&self.views, string)
    }

    fn part<'b>(&self, all: &'b [f64], string: usize) -> &'b [f64] {
        match (self.starts.get(string), self.starts.get(string + 1)) {
            (Some(&start), Some(&stop)) => all.get(start..stop).unwrap_or_default(),
            _ => &[],
        }
    }
}

/// Where `plane`'s weights under `horizon` stand in `planes`, computed once per plane: most
/// modules share a few.
fn weights_of(
    planes: &mut Vec<(Plane, Weights)>,
    plane: Plane,
    horizon: Option<&Horizon>,
) -> usize {
    if let Some(k) = planes.iter().position(|(known, _)| *known == plane) {
        return k;
    }
    let open_above = |_, sun: Sun| horizon.map_or(0.0, |h| h.elevation(sun.azimuth));
    planes.push((plane, Weights::of(plane, open_above)));
    planes.len() - 1
}

/// The share of the isotropic sky `plane` sees: each node's band of elevation, a node wide,
/// weighted by its cosine onto the plane and by the part of it above `open_above` at that node
/// (its index and direction), over the same sum under an open sky. A horizon opens a node above
/// its elevation there; the scene's diffuse shade closes a node whole, at 90.
#[cfg(test)]
pub fn sky_view(plane: Plane, open_above: impl Fn(usize, Sun) -> f64) -> f64 {
    Weights::of(plane, open_above).view(0.0)
}

/// What each node adds to a plane's sky view.
#[derive(Debug, Clone)]
struct Weights {
    /// Each node's open part, by node.
    open: Vec<f64>,
    /// Their sum.
    sum: f64,
    /// The same under an open sky.
    whole: f64,
}

impl Weights {
    fn of(plane: Plane, open_above: impl Fn(usize, Sun) -> f64) -> Self {
        let (tilt, facing) = (plane.tilt.to_radians(), plane.azimuth);
        let half = f64::from(STEP) / 2.0;
        let mut open = vec![0.0; ELEVATIONS * AZIMUTHS];
        let (mut sum, mut whole) = (0.0, 0.0);
        for (node, open) in open.iter_mut().enumerate() {
            let sun = sun_at(node);
            let elevation = 90.0 - sun.zenith;
            let low = (elevation - half).max(0.0);
            let high = (elevation + half).min(90.0);
            let across = (sun.azimuth - facing).to_radians().cos();
            let band =
                |from: f64| cosine_weight(tilt, across, from.to_radians(), high.to_radians());
            let of_node = band(low);
            if of_node <= 0.0 {
                continue;
            }
            whole += of_node;
            let above = open_above(node, sun).max(low);
            if above < high {
                // Where the plane's own horizon crosses the band, cutting off its lower part can
                // drop light the plane never saw: never more than the whole band.
                *open = band(above).clamp(0.0, of_node);
                sum += *open;
            }
        }
        Self { open, sum, whole }
    }

    /// The view with `closed` of the open sum taken away.
    fn view(&self, closed: f64) -> f64 {
        if self.whole > 0.0 {
            (self.sum - closed).max(0.0) / self.whole
        } else {
            1.0
        }
    }
}

/// ∫ cos(incidence) · cos(elevation) d(elevation) from `low` to `high`, in radians, for a plane
/// tilted `tilt` and a direction whose azimuth is `across` (its cosine) from the plane's.
fn cosine_weight(tilt: f64, across: f64, low: f64, high: f64) -> f64 {
    let (top, bottom) = (high.sin(), low.sin());
    let up = top.mul_add(top, -bottom * bottom) / 2.0;
    let level = (high - low) / 2.0 + ((2.0 * high).sin() - (2.0 * low).sin()) / 4.0;
    tilt.cos().mul_add(up, tilt.sin() * across * level)
}
