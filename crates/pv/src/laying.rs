//! Laying modules as the builder does (ADR 20 Modules): the ghost under the pointer, the row a
//! drag lays, a module dragged to another place, a face filled, and the modules a roof chimney
//! or a roof window covers. The browser asks once a step and holds no copy of this geometry.

use serde::Deserialize;

use crate::fitting::snap;
use crate::grid::{Area, TOLERANCE, overlap};
use crate::polygon;
use crate::{GAP, ModuleGrid, Point, RoofFace, Scene, Size};

/// Metres: a ghost this close to a module takes its place from it.
const REACH: f64 = 0.2;
/// Metres: the steps a ghost moves in away from every module.
const STEP: f64 = 0.01;
/// Modules a row or a filled face's side holds at most, so a huge face cannot stall a caller.
const LIMIT: u32 = 200;
/// Centimetre steps a filled face's first column or row moves in at most when it holds no module.
const SKEW: u32 = 5;

/// A module that is not laid yet: where it would lie, and whether it fits there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ghost {
    /// Its lower left corner in its face's outline.
    pub across: f64,
    pub up: f64,
    pub landscape: bool,
    /// Inside the setback, off the chimneys, roof windows and existing PV and 2 cm off every other
    /// module.
    pub fits: bool,
    /// Its corners in the scene, counter-clockwise from the lower left, seen from the front.
    pub corners: [Point; 4],
}

/// How "Fill face" lays the free roof (ADR 20 Modules). The default is the builder's own.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct FillRules {
    /// Metres between two modules; under 2 cm it is 2 cm, as every module keeps that apart.
    pub gap: f64,
    pub alignment: Alignment,
    /// Metres kept free round each roof chimney, roof window, existing PV and dormer.
    pub keep_out: f64,
}

impl Default for FillRules {
    fn default() -> Self {
        Self {
            gap: GAP,
            alignment: Alignment::LowerLeft,
            keep_out: 0.0,
        }
    }
}

/// Where the filled rows and columns start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Alignment {
    /// At the setback's lower left.
    #[default]
    LowerLeft,
    /// The roof the rows and columns leave over inside the setback shared out on both sides.
    Centred,
}

/// One grid's face with the footprints of the modules on it, as a new module finds them.
struct Laying<'a> {
    face: &'a RoofFace,
    grid: &'a ModuleGrid,
    size: Size,
    /// Every other module on the face, whichever grid laid it.
    others: Vec<Area>,
}

impl<'a> Laying<'a> {
    /// Grid `index` of `scene` on its face in `roofs`, without its module `moved`.
    fn new(
        scene: &'a Scene,
        roofs: &'a [RoofFace],
        sizes: &impl Fn(u32) -> Option<Size>,
        index: usize,
        moved: Option<usize>,
    ) -> Option<Self> {
        let grid = scene.grids.get(index)?;
        // A bent face carries no modules (ADR 20): nothing is laid on it.
        if scene.bent(grid.block, grid.face) {
            return None;
        }
        let on = |other: &ModuleGrid| (other.block, other.face) == (grid.block, grid.face);
        let face = roofs
            .iter()
            .find(|r| (r.block, r.face) == (grid.block, grid.face))?;
        let others = scene
            .grids
            .iter()
            .enumerate()
            .filter(|(_, other)| on(other));
        let others = others.flat_map(|(at, other)| {
            let size = sizes(other.module_type);
            let laid = other.modules.iter().enumerate();
            laid.filter(move |(module, _)| (at, Some(*module)) != (index, moved))
                .filter_map(move |(_, module)| Some(other.footprint(size?, module.spot)))
        });
        Some(Self {
            face,
            grid,
            size: sizes(grid.module_type)?,
            others: others.collect(),
        })
    }

    fn area(&self, [across, up]: [f64; 2], landscape: bool) -> Area {
        let [wide, high] = self.size.laid(landscape);
        [[across, up], [across + wide, up + high]]
    }

    fn fits(&self, area: Area) -> bool {
        self.face.clear(area, self.grid.setback).is_ok()
            && !self.others.iter().any(|other| overlap(area, *other, GAP))
    }

    fn ghost(&self, [across, up]: [f64; 2], landscape: bool) -> Ghost {
        let area = self.area([across, up], landscape);
        Ghost {
            across,
            up,
            landscape,
            fits: self.fits(area),
            corners: self.face.corners(area),
        }
    }

    /// A module's corner near `wanted`: 2 cm off the edges of the modules within reach or in
    /// line with them, each way on its own; else on whole centimetres.
    fn snapped(&self, wanted: [f64; 2], landscape: bool) -> [f64; 2] {
        let extent = self.size.laid(landscape);
        let near: Vec<Area> = {
            let area = self.area(wanted, landscape);
            let within = |other: &&Area| overlap(area, **other, REACH);
            self.others.iter().filter(within).copied().collect()
        };
        let along = |axis: usize| {
            let (want, extent) = (pick(wanted, axis), pick(extent, axis));
            let lines = near.iter().flat_map(|[low, high]| {
                let (low, high) = (pick(*low, axis), pick(*high, axis));
                [high + GAP, low - GAP - extent, low, high - extent]
            });
            lines
                .map(|line| ((line - want).abs(), line))
                .filter(|(off, _)| *off <= REACH)
                .min_by(|(a, _), (b, _)| a.total_cmp(b))
                .map_or_else(|| snap(want, STEP), |(_, line)| snap(line, TOLERANCE))
        };
        [along(0), along(1)]
    }

    /// The row from the module at `start` along the longer way of `drag`: a module more for every
    /// module and gap the drag is long.
    fn row(&self, start: [f64; 2], drag: [f64; 2], landscape: bool) -> Vec<Ghost> {
        let axis = usize::from(pick(drag, 1).abs() > pick(drag, 0).abs());
        let pitch = pick(self.size.laid(landscape), axis) + GAP;
        let reach = pick(drag, axis);
        (0..LIMIT)
            .map(f64::from)
            .take_while(|step| step * pitch <= reach.abs())
            .map(|step| {
                let mut at = start;
                if let Some(along) = at.get_mut(axis) {
                    *along = snap(reach.signum().mul_add(step * pitch, *along), TOLERANCE);
                }
                self.ghost(at, landscape)
            })
            .collect()
    }
}

/// Where a filled face's first column or row lies under `alignment`, of modules `extent` long and
/// `gap` apart that way on an outline from `low` to `reach`.
fn first(
    alignment: Alignment,
    setback: f64,
    [extent, gap]: [f64; 2],
    (low, reach): (f64, f64),
) -> f64 {
    match alignment {
        Alignment::LowerLeft => setback,
        Alignment::Centred => {
            let pitch = extent + gap;
            let free = 2.0f64.mul_add(-setback, reach - low);
            let count = ((free + gap) / pitch).floor().clamp(0.0, f64::from(LIMIT));
            let spare = pitch.mul_add(-count, free + gap).max(0.0);
            low + setback + spare / 2.0
        }
    }
}

/// A traced face is a few millimetres off square, so a filled face's first column or row on the
/// setback can cross it all along: `start` with each that holds no module a centimetre further
/// in, a few times at most. None where neither moves.
fn nudged(
    start: [f64; 2],
    column: impl Fn([f64; 2]) -> bool,
    row: impl Fn([f64; 2]) -> bool,
) -> Option<[f64; 2]> {
    let step = |at: f64, holds: bool| {
        if holds {
            at
        } else {
            snap(at + STEP, TOLERANCE)
        }
    };
    let mut at = start;
    let mut moved = false;
    for _ in 0..SKEW {
        let (column, row) = (column(at), row(at));
        if column && row {
            break;
        }
        let [across, up] = at;
        at = [step(across, column), step(up, row)];
        moved = true;
    }
    moved.then_some(at)
}

/// `pair`'s across for axis 0, its up for axis 1.
const fn pick([across, up]: [f64; 2], axis: usize) -> f64 {
    if axis == 0 { across } else { up }
}

/// From `from` to `to`, across and up.
fn between(from: [f64; 2], to: [f64; 2]) -> [f64; 2] {
    [pick(to, 0) - pick(from, 0), pick(to, 1) - pick(from, 1)]
}

impl Scene {
    /// What a press at `from` on the face of grid `grid`, dragged to `to`, would lay there: the
    /// ghost module under the pointer, in the grid's orientation and snapped, and with a drag the
    /// row along it. None for a press off the face, or without the grid or its module's size.
    #[must_use]
    pub fn lay(
        &self,
        grid: usize,
        size: impl Fn(u32) -> Option<Size>,
        [from, to]: [Point; 2],
    ) -> Option<Vec<Ghost>> {
        let roofs = self.roofs();
        let laying = Laying::new(self, &roofs, &size, grid, None)?;
        let landscape = laying.grid.landscape;
        let pressed = laying.face.locate(from)?;
        let [wide, high] = laying.size.laid(landscape);
        let corner = [pick(pressed, 0) - wide / 2.0, pick(pressed, 1) - high / 2.0];
        let start = laying.snapped(corner, landscape);
        Some(laying.row(start, between(pressed, laying.face.project(to)), landscape))
    }

    /// Module `module` of grid `grid` dragged from `from` to `to` on its face: where it would lie,
    /// snapped like a ghost, and whether it fits there. None without it or its face.
    #[must_use]
    pub fn slide(
        &self,
        grid: usize,
        module: usize,
        size: impl Fn(u32) -> Option<Size>,
        [from, to]: [Point; 2],
    ) -> Option<Ghost> {
        let roofs = self.roofs();
        let laying = Laying::new(self, &roofs, &size, grid, Some(module))?;
        let spot = laying.grid.modules.get(module)?.spot;
        let landscape = laying.grid.landscape(spot);
        let [[across, up], _] = laying.grid.footprint(laying.size, spot);
        let face = laying.face;
        let [east, north] = between(face.project(from), face.project(to));
        let corner = laying.snapped([across + east, up + north], landscape);
        Some(laying.ghost(corner, landscape))
    }

    /// The places "Fill face" adds to grid `grid` under `rules`: the free roof row by row from
    /// the setback's lower left, or centred in it, in the grid's orientation, each `rules.gap`
    /// off the next and `rules.keep_out` off what stands on the roof; a first column or row that
    /// holds none moved in by centimetres where that lays more. None fits, none.
    #[must_use]
    pub fn fill(
        &self,
        grid: usize,
        size: impl Fn(u32) -> Option<Size>,
        rules: FillRules,
    ) -> Vec<[f64; 2]> {
        let roofs = self.roofs();
        let Some(laying) = Laying::new(self, &roofs, &size, grid, None) else {
            return Vec::new();
        };
        let gap = rules.gap.max(GAP);
        let (landscape, setback) = (laying.grid.landscape, laying.grid.setback);
        let [wide, high] = laying.size.laid(landscape);
        let span = |axis: usize| {
            let along = laying.face.outline.iter().map(|p| pick(*p, axis));
            let low = along.clone().fold(f64::INFINITY, f64::min);
            (low, along.fold(0.0, f64::max))
        };
        let start =
            |extent: f64, axis: usize| first(rules.alignment, setback, [extent, gap], span(axis));
        let lines = |start: f64, extent: f64, axis: usize| {
            let (_, reach) = span(axis);
            (0..LIMIT)
                .map(move |line| (extent + gap).mul_add(f64::from(line), start))
                .take_while(move |near| near + extent <= reach)
        };
        let clear = |area: Area| {
            let face = laying.face;
            let mut taken = face
                .chimneys
                .iter()
                .chain(&face.windows)
                .chain(&face.existing);
            laying.face.clear(area, setback).is_ok()
                && !laying.others.iter().any(|other| overlap(area, *other, gap))
                && !taken.any(|taken| overlap(area, *taken, rules.keep_out))
                && face
                    .holes
                    .iter()
                    .all(|hole| polygon::apart(hole, area, rules.keep_out - TOLERANCE))
        };
        let fits = |at: [f64; 2]| clear(laying.area(at, landscape));
        let lay = |[across, up]: [f64; 2]| -> Vec<[f64; 2]> {
            lines(up, high, 1)
                .flat_map(|up| lines(across, wide, 0).map(move |across| [across, up]))
                .filter(|at| fits(*at))
                .collect()
        };
        let square = [start(wide, 0), start(high, 1)];
        let laid = lay(square);
        let column = |[across, up]: [f64; 2]| lines(up, high, 1).any(|up| fits([across, up]));
        let row = |[across, up]: [f64; 2]| lines(across, wide, 0).any(|across| fits([across, up]));
        nudged(square, column, row)
            .map(lay)
            .filter(|shifted| shifted.len() > laid.len())
            .unwrap_or(laid)
    }

    /// The index of the first grid whose face a strike at `point` lands on, inside its setback.
    #[must_use]
    pub fn grid_at(&self, point: Point) -> Option<usize> {
        let roofs = self.roofs();
        self.grids.iter().position(|grid| {
            let face = roofs
                .iter()
                .find(|r| (r.block, r.face) == (grid.block, grid.face));
            let at = face.and_then(|face| Some((face, face.locate(point)?)));
            at.is_some_and(|(face, at)| face.inside(at, grid.setback))
        })
    }

    /// The modules a roof chimney or a roof window covers, as a grid's index and a module's in
    /// it: what adding or moving one removes. A grid without its module's size has none.
    #[must_use]
    pub fn covered(&self, size: impl Fn(u32) -> Option<Size>) -> Vec<(usize, usize)> {
        let roofs = self.roofs();
        let covered = self.grids.iter().enumerate().flat_map(|(at, grid)| {
            let face = roofs
                .iter()
                .find(|r| (r.block, r.face) == (grid.block, grid.face));
            let size = size(grid.module_type);
            let laid = grid.modules.iter().enumerate();
            laid.filter_map(move |(module, laid)| {
                let area = grid.footprint(size?, laid.spot);
                let on = |taken: &Area| overlap(area, *taken, 0.0);
                let face = face?;
                let mut taken = face
                    .chimneys
                    .iter()
                    .chain(&face.windows)
                    .chain(&face.existing);
                taken.any(on).then_some((at, module))
            })
        });
        covered.collect()
    }
}
