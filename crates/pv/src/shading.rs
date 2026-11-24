//! Shading as a table (ADR 17): which substrings a scene shades depends on where the sun stands,
//! not on the date, so it is traced once per scene over the sky and a time step looks it up.

use crate::estimate::{Tallies, sky, tallied};
use crate::perez::cos_incidence;
use crate::shade::Casters;
use crate::string::{Open, Shade};
use crate::{Estimate, Layout, Module, ModuleType, Occluder, Place, Plane, Sun, Weather};

/// Degrees between nodes, in elevation and in azimuth.
pub const STEP: u16 = 2;
/// From the horizon to the zenith, both included.
pub const ELEVATIONS: usize = 90 / STEP as usize + 1;
/// From north round to north, which wraps.
pub const AZIMUTHS: usize = 360 / STEP as usize;

/// Each substring's beam shade at every node of a grid over the sky, for one scene and layout.
/// The grid does not depend on the location, so a sky view or a horizon can be laid over it.
#[derive(Debug, Default)]
pub struct ShadingTable {
    /// What it was traced from.
    scene: Scene,
    /// Where each string's substrings start in a node's row, in layout order, and where the
    /// last ends.
    starts: Vec<usize>,
    /// Row by row, elevation by azimuth: each substring shaded or not. Empty with nothing to
    /// shade.
    nodes: Vec<bool>,
}

/// What shading reads of a layout: the shade casters and each string's modules.
#[derive(Debug, Default, PartialEq)]
struct Scene {
    occluders: Vec<Occluder>,
    strings: Vec<Row>,
}

/// What shading reads of a string: its module size, bypass diodes and modules' planes and
/// places.
#[derive(Debug, PartialEq)]
struct Row {
    width: f64,
    height: f64,
    bypass_diodes: u8,
    modules: Vec<(Plane, Option<Place>)>,
}

impl Scene {
    fn of(layout: &Layout) -> Self {
        let strings = layout
            .inverters
            .iter()
            .flat_map(|inverter| &inverter.inputs)
            .flat_map(|input| &input.strings)
            .map(|string| Row {
                width: string.module.width,
                height: string.module.height,
                bypass_diodes: string.module.bypass_diodes,
                modules: string.modules.iter().map(|m| (m.plane, m.place)).collect(),
            });
        Self {
            occluders: layout.occluders.clone(),
            strings: strings.collect(),
        }
    }
}

impl ShadingTable {
    /// Traces the table again when what shading reads of `layout` changed since it was traced,
    /// and says whether it did.
    pub fn refresh(&mut self, layout: &Layout) -> bool {
        let scene = Scene::of(layout);
        if scene == self.scene {
            return false;
        }
        *self = Self::trace(layout, scene);
        true
    }

    fn trace(layout: &Layout, scene: Scene) -> Self {
        let mut starts = vec![0];
        let mut end = 0;
        for string in &scene.strings {
            end += string.modules.len() * usize::from(string.bypass_diodes.max(1));
            starts.push(end);
        }
        let placed = scene
            .strings
            .iter()
            .any(|string| string.modules.iter().any(|(_, place)| place.is_some()));
        if scene.occluders.is_empty() || !placed {
            return Self {
                scene,
                starts,
                nodes: Vec::new(),
            };
        }
        let modules: Vec<_> = layout
            .inverters
            .iter()
            .flat_map(|inverter| &inverter.inputs)
            .flat_map(|input| &input.strings)
            .flat_map(|string| string.modules.iter().map(|m| (&string.module, m)))
            .collect();
        let mut nodes = vec![false; ELEVATIONS * AZIMUTHS * end];
        for (node, row) in nodes.chunks_exact_mut(end).enumerate() {
            mark(&modules, sun_at(node), &scene.occluders, row);
        }
        Self {
            scene,
            starts,
            nodes,
        }
    }

    /// The layout's estimate under what `open` leaves each string by its place in the layout's
    /// order under a sun, each substring's shade looked up at the node nearest the sun, tallying
    /// into `tallies`, if any.
    /// The table must have been refreshed for `layout`.
    pub(crate) fn estimate<'a>(
        &self,
        layout: &Layout,
        weather: &Weather,
        open: impl Fn(Sun, usize) -> Open<'a>,
        tallies: Option<&mut Tallies>,
    ) -> Estimate {
        let sky = sky(layout, weather);
        let row = self.row(sky.sun);
        let shade = |string| {
            let of_string = row.and_then(|row| {
                let (start, stop) = (*self.starts.get(string)?, *self.starts.get(string + 1)?);
                row.get(start..stop)
            });
            (
                Shade::Looked(of_string.unwrap_or_default()),
                open(sky.sun, string),
            )
        };
        tallied(layout, &sky, shade, tallies)
    }

    /// Whether the scene shades anything: without, no shading loss is computed.
    pub(crate) const fn shades(&self) -> bool {
        !self.nodes.is_empty()
    }

    /// Each node's row of substrings, shaded or not, in node order; none with nothing to shade.
    pub(crate) fn rows(&self) -> impl Iterator<Item = &[bool]> {
        let width = self.starts.last().copied().unwrap_or(0);
        self.nodes.chunks_exact(width.max(1))
    }

    /// The substrings at the node nearest `sun`; `None` with the sun down or nothing to shade.
    pub(crate) fn row(&self, sun: Sun) -> Option<&[bool]> {
        let elevation = 90.0 - sun.zenith;
        if self.nodes.is_empty() || elevation < 0.0 {
            return None;
        }
        let width = self.starts.last().copied().unwrap_or(0);
        let node = nearest(elevation, sun.azimuth);
        self.nodes.get(node * width..(node + 1) * width)
    }
}

/// Marks in `row` each substring of `modules`, in their order, that loses its beam under `sun`.
fn mark(modules: &[(&ModuleType, &Module)], sun: Sun, occluders: &[Occluder], row: &mut [bool]) {
    let casters = Casters::under(sun, occluders);
    let mut start = 0;
    for &(module_type, module) in modules {
        let parts = usize::from(module_type.bypass_diodes.max(1));
        let shaded = row.get_mut(start..start + parts);
        start += parts;
        if let (Some(place), Some(shaded)) = (module.place, shaded)
            && cos_incidence(module.plane, sun) > 0.0
        {
            casters.mark(module_type, module.plane, place, shaded);
        }
    }
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "rounded and kept within the grid first"
)]
fn nearest(elevation: f64, azimuth: f64) -> usize {
    let step = f64::from(STEP);
    let up = (elevation / step).round().clamp(0.0, 90.0 / step) as usize;
    let round = ((azimuth + 180.0) / step).round().rem_euclid(360.0 / step) as usize;
    up * AZIMUTHS + round
}

/// The sun at a node: azimuths from north, −180, round through east.
#[expect(
    clippy::cast_precision_loss,
    reason = "a node's index is far below 2^52"
)]
pub fn sun_at(node: usize) -> Sun {
    let (up, round) = (node / AZIMUTHS, node % AZIMUTHS);
    let step = f64::from(STEP);
    Sun {
        zenith: step.mul_add(-(up as f64), 90.0),
        azimuth: step.mul_add(round as f64, -180.0),
    }
}
