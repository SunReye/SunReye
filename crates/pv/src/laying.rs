//! Laying modules as the builder does (ADR 20 Modules): the ghost under the pointer, the row a
//! drag lays, a module dragged to another place, a face filled, and the modules a roof chimney
//! or a roof window covers. The browser asks once a step and holds no copy of this geometry.

use crate::fitting::snap;
use crate::grid::{Area, TOLERANCE, overlap};
use crate::{GAP, ModuleGrid, Point, RoofFace, Scene, Size};

/// Metres: a ghost this close to a module takes its place from it.
const REACH: f64 = 0.2;
/// Metres: the steps a ghost moves in away from every module.
const STEP: f64 = 0.01;
/// Modules a row or a filled face's side holds at most, so a huge face cannot stall a caller.
const LIMIT: u32 = 200;

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

    /// The places "Fill face" adds to grid `grid`: the free roof row by row from the setback's
    /// lower left, in the grid's orientation, each 2 cm off the next. None fits, none.
    #[must_use]
    pub fn fill(&self, grid: usize, size: impl Fn(u32) -> Option<Size>) -> Vec<[f64; 2]> {
        let roofs = self.roofs();
        let Some(laying) = Laying::new(self, &roofs, &size, grid, None) else {
            return Vec::new();
        };
        let landscape = laying.grid.landscape;
        let [wide, high] = laying.size.laid(landscape);
        let reach = |axis: usize| {
            let far = laying.face.outline.iter().map(|p| pick(*p, axis));
            far.fold(0.0, f64::max)
        };
        let lines = |extent: f64, reach: f64| {
            (0..LIMIT)
                .map(move |line| (extent + GAP).mul_add(f64::from(line), laying.grid.setback))
                .take_while(move |low| low + extent <= reach)
        };
        lines(high, reach(1))
            .flat_map(|up| lines(wide, reach(0)).map(move |across| [across, up]))
            .filter(|at| laying.ghost(*at, landscape).fits)
            .collect()
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
