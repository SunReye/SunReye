//! Modules on a grid on each roof face (ADR 20): a cell is the module plus a gap, inside the
//! face's setback, and each placed module takes its face's plane.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::shade::{cross, dot, offset, sub};
use crate::{Module, Place, Plane, Point, Scene};

/// Metres between neighbouring modules.
pub const GAP: f64 = 0.02;
/// Rows and columns a face holds at most, so a huge face cannot stall a caller.
const LIMIT: u32 = 200;
/// Metres a corner may stray outside the setback by rounding.
const EPSILON: f64 = 1e-9;

/// The modules on one roof face.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModuleGrid {
    /// The block's index in the scene.
    pub block: usize,
    /// The roof face's index in its block, in the order the `pv` crate lists a block's roof faces.
    pub face: usize,
    /// The id of the module type, which sizes the cells.
    pub module_type: u32,
    /// Long side across the slope.
    pub landscape: bool,
    /// Metres kept free along every edge of the face.
    pub setback: f64,
    pub modules: Vec<Cell>,
}

/// A module in one cell: rows count up the slope, columns across it, both from 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cell {
    pub row: u32,
    pub column: u32,
    /// The string it is painted into; unassigned, it produces nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub string: Option<u32>,
    #[serde(default)]
    pub optimized: bool,
}

/// A module's outline in metres: `height` is its long side.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

/// A roof face as a module grid sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct RoofFace {
    pub block: usize,
    pub face: usize,
    pub plane: Plane,
    /// Metres across the slope and up it, from the lowest corner on the left seen from the front.
    pub outline: Vec<[f64; 2]>,
    origin: Point,
    across: Point,
    up: Point,
}

/// Where a cell's module sits.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellPlace {
    pub row: u32,
    pub column: u32,
    /// Its lower left and upper right corner in the face's outline.
    pub area: [[f64; 2]; 2],
    /// Counter-clockwise from the lower left, seen from the front.
    pub corners: [Point; 4],
    pub place: Place,
}

/// A module the scene places, with the string it is painted into.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placed {
    pub string: Option<u32>,
    pub module: Module,
}

/// Why a scene's modules cannot be placed; `grid` is the grid's index in the scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Misplaced {
    /// The grid names no roof face.
    Face { grid: usize },
    /// The grid names no known module type.
    ModuleType { grid: usize },
    /// The module crosses the face's setback.
    Setback { grid: usize, row: u32, column: u32 },
    /// Two modules share a cell.
    Overlap { grid: usize, row: u32, column: u32 },
}

impl Scene {
    /// Every roof face of every block, block by block.
    #[must_use]
    pub fn roofs(&self) -> Vec<RoofFace> {
        self.roof_faces()
            .map(|(block, face, corners, width)| RoofFace::new(block, face, &corners, width))
            .collect()
    }

    /// Every module the grids hold, grid by grid.
    ///
    /// # Errors
    /// A grid names no roof face or module type, or a module crosses the setback or shares a cell.
    pub fn modules(&self, size: impl Fn(u32) -> Option<Size>) -> Result<Vec<Placed>, Misplaced> {
        let roofs = self.roofs();
        let mut placed = Vec::new();
        for (index, grid) in self.grids.iter().enumerate() {
            let face = roofs
                .iter()
                .find(|r| (r.block, r.face) == (grid.block, grid.face))
                .ok_or(Misplaced::Face { grid: index })?;
            let size = size(grid.module_type).ok_or(Misplaced::ModuleType { grid: index })?;
            placed.extend(face.place(index, grid, size)?);
        }
        Ok(placed)
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
            origin: offset(offset(first, across, left), up, bottom),
            across,
            up,
        }
    }

    /// Every cell of `grid` whose module fits inside the setback, row by row.
    #[must_use]
    pub fn cells(&self, grid: &ModuleGrid, size: Size) -> Vec<CellPlace> {
        let (wide, high) = if grid.landscape {
            (size.height, size.width)
        } else {
            (size.width, size.height)
        };
        (0..LIMIT)
            .flat_map(|row| (0..LIMIT).map(move |column| (row, column)))
            .filter_map(|(row, column)| {
                let left = (wide + GAP).mul_add(f64::from(column), grid.setback);
                let bottom = (high + GAP).mul_add(f64::from(row), grid.setback);
                let area = [[left, bottom], [left + wide, bottom + high]];
                let [[l, b], [r, t]] = area;
                let square = [[l, b], [r, b], [r, t], [l, t]];
                square
                    .iter()
                    .all(|p| self.inside(*p, grid.setback))
                    .then(|| CellPlace {
                        row,
                        column,
                        area,
                        corners: square.map(|p| self.point(p)),
                        place: Place {
                            centre: self.point([f64::midpoint(l, r), f64::midpoint(b, t)]),
                            landscape: grid.landscape,
                        },
                    })
            })
            .collect()
    }

    /// The modules of the scene's grid `index` on this face.
    fn place(&self, index: usize, grid: &ModuleGrid, size: Size) -> Result<Vec<Placed>, Misplaced> {
        let cells = self.cells(grid, size);
        let mut taken = HashSet::new();
        grid.modules
            .iter()
            .map(|module| {
                let (row, column) = (module.row, module.column);
                if !taken.insert((row, column)) {
                    return Err(Misplaced::Overlap {
                        grid: index,
                        row,
                        column,
                    });
                }
                let cell = cells
                    .iter()
                    .find(|c| (c.row, c.column) == (row, column))
                    .ok_or(Misplaced::Setback {
                        grid: index,
                        row,
                        column,
                    })?;
                Ok(Placed {
                    string: module.string,
                    module: Module {
                        plane: self.plane,
                        optimized: module.optimized,
                        place: Some(cell.place),
                    },
                })
            })
            .collect()
    }

    /// Whether `p` lies at least `margin` inside every edge.
    fn inside(&self, [u, v]: [f64; 2], margin: f64) -> bool {
        let next = self.outline.iter().cycle().skip(1);
        self.outline.iter().zip(next).all(|([au, av], [bu, bv])| {
            let (du, dv) = (bu - au, bv - av);
            let length = du.hypot(dv);
            length < EPSILON || du.mul_add(v - av, -(dv * (u - au))) / length >= margin - EPSILON
        })
    }

    const fn point(&self, [u, v]: [f64; 2]) -> Point {
        offset(offset(self.origin, self.across, u), self.up, v)
    }
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
