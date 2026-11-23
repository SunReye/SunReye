//! Modules on roof faces (ADR 20): each at its own place and orientation inside its face's
//! setback, clear of the others and of the roof chimneys, and each takes its face's plane.

use serde::{Deserialize, Serialize};

use crate::polygon;
use crate::shade::{cross, dot, offset, sub};
use crate::{ExistingPv, Module, Place, Plane, Point, RoofWindow, Scene};

/// Metres the builder keeps between neighbouring modules.
pub const GAP: f64 = 0.02;
/// Metres a corner may stray outside the setback by rounding.
const EPSILON: f64 = 1e-9;
/// Metres two footprints may share, or a module cross its setback, by the rounding of a place.
pub const TOLERANCE: f64 = 1e-6;
/// Metres a point may lie off a face's plane and still be on it.
const ON_FACE: f64 = 0.1;

/// A lower left and an upper right corner in a face's outline.
pub type Area = [[f64; 2]; 2];

/// The modules on one roof face, all of one module type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModuleGrid {
    /// The block's index in the scene.
    pub block: usize,
    /// The roof face's index in its block, in the order the `pv` crate lists a block's roof faces.
    pub face: usize,
    /// The id of the module type, which sizes the modules.
    pub module_type: u32,
    /// The orientation a new module takes: its long side across the slope.
    pub landscape: bool,
    /// Metres kept free along every edge of the face.
    pub setback: f64,
    #[cfg_attr(feature = "openapi", schema(value_type = Vec<schema::GridModule>))]
    pub modules: Vec<GridModule>,
}

/// A module on a roof face.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "Stored", into = "Stored")]
pub struct GridModule {
    pub spot: Spot,
    /// The string it is painted into; unassigned, it produces nothing.
    pub string: Option<u32>,
    pub optimized: bool,
    /// Its place along its string's wiring, which runs through the string's modules from the
    /// lowest; a module without one follows them.
    pub order: Option<u32>,
}

/// Where a module lies on its face.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Spot {
    /// Its lower left corner across and up the face's outline, in metres, seen from the front.
    Place {
        across: f64,
        up: f64,
        /// Long side across the slope.
        landscape: bool,
    },
    /// As scenes were stored before modules had places: a cell of the module's size plus the gap,
    /// rows up the slope and columns across it from the setback, in the grid's orientation.
    Cell { row: u32, column: u32 },
}

/// A module as it is stored: with a place, or as scenes stored before with a row and a column.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stored {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    across: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    up: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    landscape: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    column: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    string: Option<u32>,
    #[serde(default)]
    optimized: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    order: Option<u32>,
}

impl TryFrom<Stored> for GridModule {
    type Error = &'static str;

    fn try_from(stored: Stored) -> Result<Self, Self::Error> {
        let Stored {
            string,
            optimized,
            order,
            ..
        } = stored;
        let spot = match stored {
            Stored {
                across: Some(across),
                up: Some(up),
                landscape: Some(landscape),
                row: None,
                column: None,
                ..
            } => Spot::Place {
                across,
                up,
                landscape,
            },
            Stored {
                across: None,
                up: None,
                landscape: None,
                row: Some(row),
                column: Some(column),
                ..
            } => Spot::Cell { row, column },
            _ => return Err("a module needs `across`, `up` and `landscape`"),
        };
        Ok(Self {
            spot,
            string,
            optimized,
            order,
        })
    }
}

impl From<GridModule> for Stored {
    fn from(module: GridModule) -> Self {
        let place = |across, up, landscape, row, column| Self {
            across,
            up,
            landscape,
            row,
            column,
            string: module.string,
            optimized: module.optimized,
            order: module.order,
        };
        match module.spot {
            Spot::Place {
                across,
                up,
                landscape,
            } => place(Some(across), Some(up), Some(landscape), None, None),
            Spot::Cell { row, column } => place(None, None, None, Some(row), Some(column)),
        }
    }
}

/// The API's schema of a module: the core answers and stores places only (ADR 20).
#[cfg(feature = "openapi")]
mod schema {
    /// A module on a roof face.
    #[derive(utoipa::ToSchema)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    #[expect(dead_code, reason = "read by the schema's derive only")]
    pub struct GridModule {
        /// Its lower left corner across and up the face's outline, in metres, seen from the front.
        across: f64,
        up: f64,
        /// Long side across the slope.
        landscape: bool,
        /// The string it is painted into; unassigned, it produces nothing.
        string: Option<u32>,
        #[serde(default)]
        optimized: bool,
        /// Its place along its string's wiring, which runs through the string's modules from the
        /// lowest; a module without one follows them.
        order: Option<u32>,
    }
}

/// A module's outline in metres: `height` is its long side.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Size {
    /// Metres across the slope and up it.
    pub(crate) const fn laid(self, landscape: bool) -> [f64; 2] {
        if landscape {
            [self.height, self.width]
        } else {
            [self.width, self.height]
        }
    }
}

/// A roof face as a module grid sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct RoofFace {
    pub block: usize,
    pub face: usize,
    pub plane: Plane,
    /// Metres across the slope and up it, from the lowest corner on the left seen from the front.
    pub outline: Vec<[f64; 2]>,
    /// The footprints of the chimneys standing on it.
    pub chimneys: Vec<Area>,
    /// The panes of the roof windows lying in it.
    pub windows: Vec<Area>,
    /// The fields of the existing PV on it.
    pub existing: Vec<Area>,
    /// The outlines its dormers cut out of it, seen from above, across and up it (ADR 20).
    pub holes: Vec<Vec<[f64; 2]>>,
    /// The outline's frame: its origin, and the unit directions across the slope and up it.
    pub origin: Point,
    pub across: Point,
    pub up: Point,
}

/// A module the scene places, with the string it is painted into.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placed {
    pub string: Option<u32>,
    pub module: Module,
}

/// Why a scene's modules cannot be placed: `grid` is the grid's index in the scene, `module` the
/// module's in its grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Misplaced {
    /// The grid names no roof face.
    Face { grid: usize },
    /// The grid names no known module type.
    ModuleType { grid: usize },
    /// The module crosses the face's setback.
    Setback { grid: usize, module: usize },
    /// The module overlaps an earlier one on its face.
    Overlap { grid: usize, module: usize },
    /// The module overlaps a roof chimney.
    Chimney { grid: usize, module: usize },
    /// The module overlaps a roof window.
    Window { grid: usize, module: usize },
    /// The module overlaps existing PV.
    Existing { grid: usize, module: usize },
}

/// Why a footprint cannot lie on a face.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blocked {
    Setback,
    Chimney,
    Window,
    Existing,
    Overlap,
}

impl Blocked {
    const fn misplaced(self, grid: usize, module: usize) -> Misplaced {
        match self {
            Self::Setback => Misplaced::Setback { grid, module },
            Self::Chimney => Misplaced::Chimney { grid, module },
            Self::Window => Misplaced::Window { grid, module },
            Self::Existing => Misplaced::Existing { grid, module },
            Self::Overlap => Misplaced::Overlap { grid, module },
        }
    }
}

/// Whether a footprint overlaps none of `others`.
fn apart(area: Area, mut others: impl Iterator<Item = Area>) -> Result<(), Blocked> {
    if others.any(|other| overlap(area, other, 0.0)) {
        Err(Blocked::Overlap)
    } else {
        Ok(())
    }
}

/// Whether two footprints share more than `TOLERANCE`, each grown by `apart` metres between them.
pub fn overlap([[al, ab], [ar, at]]: Area, [[bl, bb], [br, bt]]: Area, apart: f64) -> bool {
    let near = TOLERANCE - apart;
    al < br - near && ar > bl + near && ab < bt - near && at > bb + near
}

impl ModuleGrid {
    /// A module's lower left and upper right corner in its face's outline, whether or not it
    /// fits there.
    #[must_use]
    pub fn footprint(&self, size: Size, spot: Spot) -> Area {
        let ([left, bottom], landscape) = match spot {
            Spot::Place {
                across,
                up,
                landscape,
            } => ([across, up], landscape),
            Spot::Cell { row, column } => {
                let [wide, high] = size.laid(self.landscape);
                let left = (wide + GAP).mul_add(f64::from(column), self.setback);
                let bottom = (high + GAP).mul_add(f64::from(row), self.setback);
                ([left, bottom], self.landscape)
            }
        };
        let [wide, high] = size.laid(landscape);
        [[left, bottom], [left + wide, bottom + high]]
    }

    /// Whether a module lies long side across the slope.
    #[must_use]
    pub const fn landscape(&self, spot: Spot) -> bool {
        match spot {
            Spot::Place { landscape, .. } => landscape,
            Spot::Cell { .. } => self.landscape,
        }
    }

    /// The grid with every module at its place: one stored in a cell at the cell's corner, in the
    /// grid's orientation, so nothing moves.
    #[must_use]
    pub fn settled(&self, size: Size) -> Self {
        let modules = self.modules.iter().map(|module| {
            let [[across, up], _] = self.footprint(size, module.spot);
            GridModule {
                spot: Spot::Place {
                    across,
                    up,
                    landscape: self.landscape(module.spot),
                },
                ..*module
            }
        });
        Self {
            modules: modules.collect(),
            ..self.clone()
        }
    }
}

impl Scene {
    /// Every roof face of every block, block by block.
    #[must_use]
    pub fn roofs(&self) -> Vec<RoofFace> {
        self.roof_faces()
            .map(|(block, face, corners, width)| {
                let mut roof = RoofFace::new(block, face, &corners, width);
                roof.chimneys = self
                    .chimneys
                    .iter()
                    .filter(|c| (c.block, c.face) == (block, face))
                    .map(|c| c.area(&roof))
                    .collect();
                roof.windows = self
                    .roof_windows
                    .iter()
                    .filter(|w| (w.block, w.face) == (block, face))
                    .map(RoofWindow::area)
                    .collect();
                roof.existing = self
                    .existing_pv
                    .iter()
                    .filter(|e| (e.block, e.face) == (block, face))
                    .map(ExistingPv::area)
                    .collect();
                roof.holes = self.holes(block, face, &roof);
                roof
            })
            .collect()
    }

    /// The outlines of the dormers standing on roof face `face` of block `block`, dropped onto it
    /// from above, across and up it.
    fn holes(&self, block: usize, face: usize, roof: &RoofFace) -> Vec<Vec<[f64; 2]>> {
        let Some(on) = self.blocks.get(block) else {
            return Vec::new();
        };
        let frame = self.frame(on);
        on.free_form
            .as_ref()
            .map(|free| free.cuts(face))
            .unwrap_or_default()
            .into_iter()
            .map(|corners| {
                corners
                    .into_iter()
                    .map(|p| roof.project(roof.drop(frame.place(p))))
                    .collect()
            })
            .collect()
    }

    /// Whether roof face `face` of block `block` is a traced one bent off its plane: it carries no
    /// modules (ADR 20).
    pub(crate) fn bent(&self, block: usize, face: usize) -> bool {
        self.blocks
            .get(block)
            .and_then(|block| block.free_form.as_ref())
            .is_some_and(|free| free.bent(face))
    }

    /// Every module the grids hold, grid by grid.
    ///
    /// # Errors
    /// A grid names no roof face, or a bent one, or no module type, or a module crosses the
    /// setback or overlaps a roof chimney, a roof window, existing PV or an earlier module on its
    /// face.
    pub fn modules(&self, size: impl Fn(u32) -> Option<Size>) -> Result<Vec<Placed>, Misplaced> {
        let roofs = self.roofs();
        let mut placed = Vec::new();
        // Each face's footprints so far, whichever grid laid them.
        let mut taken: Vec<((usize, usize), Area)> = Vec::new();
        for (index, grid) in self.grids.iter().enumerate() {
            let bent = self.bent(grid.block, grid.face);
            let face = roofs
                .iter()
                .find(|r| !bent && (r.block, r.face) == (grid.block, grid.face))
                .ok_or(Misplaced::Face { grid: index })?;
            let size = size(grid.module_type).ok_or(Misplaced::ModuleType { grid: index })?;
            for (module, laid) in grid.modules.iter().enumerate() {
                let area = grid.footprint(size, laid.spot);
                let lain = taken
                    .iter()
                    .filter(|(on, _)| *on == (grid.block, grid.face));
                face.clear(area, grid.setback)
                    .and_then(|()| apart(area, lain.map(|(_, other)| *other)))
                    .map_err(|blocked| blocked.misplaced(index, module))?;
                taken.push(((grid.block, grid.face), area));
                placed.push(Placed {
                    string: laid.string,
                    module: Module {
                        plane: face.plane,
                        optimized: laid.optimized,
                        place: Some(face.place(area, grid.landscape(laid.spot))),
                    },
                });
            }
        }
        Ok(placed)
    }

    /// The scene with every module at its place (ADR 20): what is saved. A grid without a face's
    /// module type stays as it is.
    #[must_use]
    pub fn settled(&self, size: impl Fn(u32) -> Option<Size>) -> Self {
        let grids = self.grids.iter().map(|grid| {
            size(grid.module_type).map_or_else(|| grid.clone(), |size| grid.settled(size))
        });
        Self {
            grids: grids.collect(),
            ..self.clone()
        }
    }
}

impl RoofFace {
    fn new(block: usize, face: usize, corners: &[Point], width: Point) -> Self {
        let normal = upward(normal(corners));
        let level = normal[2] > 1.0 - EPSILON;
        let across = if level {
            unit(width)
        } else {
            unit([-normal[1], normal[0], 0.0])
        };
        let up = cross(normal, across);
        let first = corners.first().copied().unwrap_or_default();
        let flat: Vec<[f64; 2]> = corners
            .iter()
            .map(|p| {
                let d = sub(*p, first);
                [dot(d, across), dot(d, up)]
            })
            .collect();
        let low = |i: usize| {
            flat.iter()
                .filter_map(|p| p.get(i).copied())
                .fold(f64::INFINITY, f64::min)
        };
        let (left, bottom) = (low(0), low(1));
        let mut outline: Vec<[f64; 2]> = flat.iter().map(|[u, v]| [u - left, v - bottom]).collect();
        // Counter-clockwise, so every edge's inside lies to its left.
        if area(&outline) < 0.0 {
            outline.reverse();
        }
        let azimuth = up[0].atan2(up[1]).to_degrees();
        Self {
            block,
            face,
            plane: Plane {
                tilt: 0.0 + normal[2].clamp(-1.0, 1.0).acos().to_degrees(),
                // Due north is 180, never −180.
                azimuth: if azimuth <= -180.0 + EPSILON {
                    180.0
                } else {
                    0.0 + azimuth
                },
            },
            outline,
            chimneys: Vec::new(),
            windows: Vec::new(),
            existing: Vec::new(),
            holes: Vec::new(),
            origin: offset(offset(first, across, left), up, bottom),
            across,
            up,
        }
    }

    /// Whether a footprint lies inside the setback and off every chimney, roof window and existing
    /// PV.
    pub(crate) fn clear(&self, area: Area, setback: f64) -> Result<(), Blocked> {
        if !self.holds(area, setback - TOLERANCE) {
            return Err(Blocked::Setback);
        }
        if self.chimneys.iter().any(|c| overlap(area, *c, 0.0)) {
            return Err(Blocked::Chimney);
        }
        if self.windows.iter().any(|w| overlap(area, *w, 0.0)) {
            return Err(Blocked::Window);
        }
        if self.existing.iter().any(|e| overlap(area, *e, 0.0)) {
            return Err(Blocked::Existing);
        }
        if !self
            .holes
            .iter()
            .all(|hole| polygon::apart(hole, area, setback - TOLERANCE))
        {
            return Err(Blocked::Setback);
        }
        Ok(())
    }

    /// The outline `setback` metres in from every edge, corner for corner: the roof modules may
    /// lie on. None where the setback leaves no roof.
    #[must_use]
    pub fn inset(&self, setback: f64) -> Option<Vec<[f64; 2]>> {
        let count = self.outline.len();
        let edges = self.outline.iter().zip(self.outline.iter().cycle().skip(1));
        // Each edge moved in: a point on it and its direction.
        let moved: Vec<([f64; 2], [f64; 2])> = edges
            .map(|([au, av], [bu, bv])| {
                let (du, dv) = (bu - au, bv - av);
                let length = du.hypot(dv).max(EPSILON);
                let (nu, nv) = (-dv / length, du / length);
                (
                    [nu.mul_add(setback, *au), nv.mul_add(setback, *av)],
                    [du, dv],
                )
            })
            .collect();
        let before = moved.iter().cycle().skip(count.saturating_sub(1));
        let inset: Vec<[f64; 2]> = before.zip(&moved).map(|(a, b)| meet(*a, *b)).collect();
        inset
            .iter()
            .all(|p| self.inside(*p, setback - TOLERANCE))
            .then_some(inset)
    }

    /// A footprint's corners in the scene, counter-clockwise from the lower left, seen from the
    /// front.
    #[must_use]
    pub fn corners(&self, area: Area) -> [Point; 4] {
        corners(area).map(|p| self.point(p))
    }

    /// Where a module of footprint `area` sits in the scene.
    const fn place(&self, [[l, b], [r, t]]: Area, landscape: bool) -> Place {
        Place {
            centre: self.point([f64::midpoint(l, r), f64::midpoint(b, t)]),
            landscape,
        }
    }

    /// A point of the scene across and up the outline; none for one off the face.
    pub(crate) fn locate(&self, point: Point) -> Option<[f64; 2]> {
        let at = self.project(point);
        let off = sub(point, self.point(at));
        (dot(off, off).sqrt() <= ON_FACE && self.inside(at, -TOLERANCE)).then_some(at)
    }

    /// A point of the scene moved straight up or down onto the face's plane.
    fn drop(&self, point: Point) -> Point {
        let normal = cross(self.across, self.up);
        let rise = dot(sub(self.origin, point), normal) / normal[2];
        [point[0], point[1], point[2] + rise]
    }

    /// A point of the scene across and up the outline, dropped onto the face's plane.
    pub(crate) fn project(&self, point: Point) -> [f64; 2] {
        let off = sub(point, self.origin);
        [dot(off, self.across), dot(off, self.up)]
    }

    /// Whether `p` lies at least `margin` inside every edge, or with a negative margin no further
    /// than that outside them.
    pub(crate) fn inside(&self, p: [f64; 2], margin: f64) -> bool {
        polygon::inside(&self.outline, p, margin)
    }

    /// Whether a footprint lies wholly on the face, at least `margin` inside every edge, though
    /// the face need not be convex.
    pub(crate) fn holds(&self, area: Area, margin: f64) -> bool {
        polygon::holds(&self.outline, area, margin)
    }

    #[must_use]
    pub const fn point(&self, [u, v]: [f64; 2]) -> Point {
        offset(offset(self.origin, self.across, u), self.up, v)
    }
}

/// Where two lines meet, each a point and a direction; the second's point where they run alike.
fn meet(
    ([au, av], [adu, adv]): ([f64; 2], [f64; 2]),
    (b, [bdu, bdv]): ([f64; 2], [f64; 2]),
) -> [f64; 2] {
    let [bu, bv] = b;
    let cross = adu.mul_add(bdv, -(adv * bdu));
    if cross.abs() < EPSILON {
        return b;
    }
    let along = (bu - au).mul_add(bdv, -((bv - av) * bdu)) / cross;
    [adu.mul_add(along, au), adv.mul_add(along, av)]
}

/// A footprint's corners, counter-clockwise from the lower left.
const fn corners([[l, b], [r, t]]: Area) -> [[f64; 2]; 4] {
    [[l, b], [r, b], [r, t], [l, t]]
}

/// The polygon's unit normal by Newell's method.
fn normal(corners: &[Point]) -> Point {
    let next = corners.iter().cycle().skip(1);
    let n = corners.iter().zip(next).fold([0.0; 3], |n, (a, b)| {
        [
            (a[1] - b[1]).mul_add(a[2] + b[2], n[0]),
            (a[2] - b[2]).mul_add(a[0] + b[0], n[1]),
            (a[0] - b[0]).mul_add(a[1] + b[1], n[2]),
        ]
    });
    unit(n)
}

fn upward(n: Point) -> Point {
    if n[2] < 0.0 { n.map(|x| -x) } else { n }
}

fn unit(v: Point) -> Point {
    let length = dot(v, v).sqrt();
    if length < EPSILON {
        [0.0, 0.0, 1.0]
    } else {
        v.map(|x| x / length)
    }
}

/// Twice the signed area: positive counter-clockwise.
fn area(polygon: &[[f64; 2]]) -> f64 {
    let next = polygon.iter().cycle().skip(1);
    polygon
        .iter()
        .zip(next)
        .map(|([au, av], [bu, bv])| au.mul_add(*bv, -(bu * av)))
        .sum()
}
