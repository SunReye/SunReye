//! Markers for inverters and batteries on a block's wall (ADR 20). They cast no shade: the
//! browser draws them and hangs each device's live label above them.

use serde::{Deserialize, Serialize};

use crate::grid::TOLERANCE;
use crate::polygon::{self, Plan};
use crate::scene::Frame;
use crate::{Block, FreeForm, Point, Scene};

/// Metres above the ground a marker hangs, at most half its wall's height.
const HEAD: f64 = 1.5;
/// Metres a marker stands off its wall, outside or inside.
const OFF: f64 = 0.1;
/// Metres a label floats above its block's highest point.
const CLEAR: f64 = 1.0;

/// A marker linked to its device, placed on a block's wall.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Equipment {
    /// The device's id.
    pub device: u32,
    pub kind: EquipmentKind,
    /// The block's index in the scene.
    pub block: usize,
    pub wall: EquipmentWall,
    /// Metres from the wall's left end, seen from outside.
    pub along: f64,
    /// Behind the wall, in the building.
    pub inside: bool,
}

/// What a marker stands for; a hybrid inverter may carry one of each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum EquipmentKind {
    Inverter,
    Battery,
}

/// A side of a block's footprint: the front along +z, the right along +x.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum Wall {
    Front,
    Right,
    Back,
    Left,
}

/// The wall a marker hangs on: one of a block's four, or a side of a free-form block's footprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum EquipmentWall {
    Named(Wall),
    Side(FootprintSide),
}

/// A side of a free-form block's footprint: from its corner `side` to the next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct FootprintSide {
    pub side: usize,
}

impl From<Wall> for EquipmentWall {
    fn from(wall: Wall) -> Self {
        Self::Named(wall)
    }
}

/// A wall in its block's own frame, x across the width and z along the depth.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Run {
    /// Its left end, seen from outside.
    pub left: [f64; 2],
    /// How far a metre along it leads across and deep.
    pub across: f64,
    pub deep: f64,
    /// Its outward normal.
    pub out: [f64; 2],
    pub length: f64,
}

impl Wall {
    /// A block's walls, in the order the builder goes round them.
    pub const ALL: [Self; 4] = [Self::Front, Self::Right, Self::Back, Self::Left];

    /// This wall of a block `width` across and `depth` deep.
    #[must_use]
    pub const fn run(self, width: f64, depth: f64) -> Run {
        let (left, [across, deep], out, length) = match self {
            Self::Front => ([0.0, depth], [1.0, 0.0], [0.0, 1.0], width),
            Self::Right => ([width, depth], [0.0, -1.0], [1.0, 0.0], depth),
            Self::Back => ([width, 0.0], [-1.0, 0.0], [0.0, -1.0], width),
            Self::Left => ([0.0, 0.0], [0.0, 1.0], [-1.0, 0.0], depth),
        };
        Run {
            left,
            across,
            deep,
            out,
            length,
        }
    }
}

/// A block's wall in the shading frame, for what the browser hangs on it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallFrame {
    /// Its left end on the ground, seen from outside.
    pub left: Point,
    /// A metre along it to the right, and its outward normal, both level.
    pub right: Point,
    pub out: Point,
}

/// Where a marker is drawn, in the shading frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mount {
    pub at: Point,
    /// Its label's anchor, straight above it and clear of its block.
    pub above: Point,
    /// A metre out of its wall, level: the way its body faces, so it turns with its house.
    pub out: Point,
}

impl Scene {
    /// Each marker's mount, in the order of `equipment`.
    ///
    /// # Errors
    /// The index of the first marker that names no wall of its block (one of four walls, or a
    /// free-form block's footprint side carrying a wall), or lies past its wall's ends.
    pub fn mounts(&self) -> Result<Vec<Mount>, usize> {
        self.equipment
            .iter()
            .enumerate()
            .map(|(index, marker)| self.mount(marker).ok_or(index))
            .collect()
    }

    /// Every block's walls, in the order of `Wall::ALL`.
    #[must_use]
    pub fn walls(&self) -> Vec<[WallFrame; 4]> {
        self.blocks
            .iter()
            .map(|block| {
                let frame = self.prism(block.x, block.z, block.rotation);
                let [east0, north0, _] = frame.place([0.0; 3]);
                // Never −0, which JSON keeps.
                let level = |[across, deep]: [f64; 2]| {
                    let [east, north, _] = frame.place([across, 0.0, deep]);
                    [east - east0 + 0.0, north - north0 + 0.0, 0.0]
                };
                Wall::ALL.map(|wall| {
                    let run = wall.run(block.width, block.depth);
                    WallFrame {
                        left: frame.place([run.left[0], 0.0, run.left[1]]),
                        right: level([run.across, run.deep]),
                        out: level(run.out),
                    }
                })
            })
            .collect()
    }

    /// Each free-form block's footprint sides, in their order, `None` for one without length;
    /// none for a block of four walls.
    #[must_use]
    pub fn sides(&self) -> Vec<Vec<Option<WallFrame>>> {
        self.blocks
            .iter()
            .map(|block| {
                let Some(free) = &block.free_form else {
                    return Vec::new();
                };
                let frame = self.prism(0.0, 0.0, 0.0);
                let [east0, north0, _] = frame.place([0.0; 3]);
                let level = |[across, deep]: [f64; 2]| {
                    let [east, north, _] = frame.place([across, 0.0, deep]);
                    [east - east0 + 0.0, north - north0 + 0.0, 0.0]
                };
                (0..free.footprint.len())
                    .map(|side| {
                        side_run(free, side).map(|run| WallFrame {
                            left: frame.place([run.left[0], 0.0, run.left[1]]),
                            right: level([run.across, run.deep]),
                            out: level(run.out),
                        })
                    })
                    .collect()
            })
            .collect()
    }

    fn mount(&self, marker: &Equipment) -> Option<Mount> {
        let block = self.blocks.get(marker.block)?;
        let (run, frame, height) = match (marker.wall, &block.free_form) {
            (EquipmentWall::Named(wall), None) => (
                wall.run(block.width, block.depth),
                self.prism(block.x, block.z, block.rotation),
                block.eave,
            ),
            (EquipmentWall::Side(FootprintSide { side }), Some(free)) => {
                let run = side_run(free, side)?;
                let foot = along(&run, marker.along, 0.0);
                (run, self.prism(0.0, 0.0, 0.0), free.height(foot))
            }
            _ => return None,
        };
        if !(0.0..=run.length).contains(&marker.along) || height <= TOLERANCE {
            return None;
        }
        Some(hang(block, marker, &run, &frame, height))
    }
}

/// Where `marker` hangs on `run` of `block`, its wall `height` tall there.
fn hang(block: &Block, marker: &Equipment, run: &Run, frame: &Frame, height: f64) -> Mount {
    let off = if marker.inside { -OFF } else { OFF };
    let [across, deep] = along(run, marker.along, off);
    let at = frame.place([across, HEAD.min(height / 2.0), deep]);
    let [east, north, _] = at;
    let [east0, north0, _] = frame.place([0.0; 3]);
    let [out_east, out_north, _] = frame.place([run.out[0], 0.0, run.out[1]]);
    Mount {
        at,
        above: [east, north, block.top() + CLEAR],
        // Never −0, which JSON keeps.
        out: [out_east - east0 + 0.0, out_north - north0 + 0.0, 0.0],
    }
}

/// The point `along` metres from a run's left end and `off` metres out of it.
const fn along(run: &Run, along: f64, off: f64) -> Plan {
    [
        run.across
            .mul_add(along, run.out[0].mul_add(off, run.left[0])),
        run.deep
            .mul_add(along, run.out[1].mul_add(off, run.left[1])),
    ]
}

/// Side `side` of a free-form block's footprint as a run from its left end seen from outside,
/// whichever way the footprint winds; none past its sides or for one without length.
fn side_run(free: &FreeForm, side: usize) -> Option<Run> {
    let footprint = &free.footprint;
    let a = *footprint.get(side)?;
    let b = *footprint.get((side + 1) % footprint.len())?;
    // Positive area winds so that (−dz, dx) of a side's own direction points in.
    let (left, right) = if polygon::area(footprint) > 0.0 {
        (b, a)
    } else {
        (a, b)
    };
    let length = (right[0] - left[0]).hypot(right[1] - left[1]);
    if length <= TOLERANCE {
        return None;
    }
    let (across, deep) = ((right[0] - left[0]) / length, (right[1] - left[1]) / length);
    Some(Run {
        left,
        across,
        deep,
        out: [-deep, across],
        length,
    })
}
