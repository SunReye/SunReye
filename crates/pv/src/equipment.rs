//! Markers for inverters and batteries on a block's wall (ADR 20). They cast no shade: the
//! browser draws them and hangs each device's live label above them.

use serde::{Deserialize, Serialize};

use crate::{Point, Scene};

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
    pub wall: Wall,
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

/// Where a marker is drawn, in the shading frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mount {
    pub at: Point,
    /// Its label's anchor, straight above it and clear of its block.
    pub above: Point,
}

impl Scene {
    /// Each marker's mount, in the order of `equipment`.
    ///
    /// # Errors
    /// The index of the first marker that names no block or lies past its wall's ends.
    pub fn mounts(&self) -> Result<Vec<Mount>, usize> {
        self.equipment
            .iter()
            .enumerate()
            .map(|(index, marker)| self.mount(marker).ok_or(index))
            .collect()
    }

    fn mount(&self, marker: &Equipment) -> Option<Mount> {
        let block = self.blocks.get(marker.block)?;
        let (width, depth) = (block.width, block.depth);
        // Each wall's left end, its run and its outward normal, in the block's own frame.
        let ([u, w], [du, dw], [nu, nw], length): ([f64; 2], [f64; 2], [f64; 2], f64) =
            match marker.wall {
                Wall::Front => ([0.0, depth], [1.0, 0.0], [0.0, 1.0], width),
                Wall::Right => ([width, depth], [0.0, -1.0], [1.0, 0.0], depth),
                Wall::Back => ([width, 0.0], [-1.0, 0.0], [0.0, -1.0], width),
                Wall::Left => ([0.0, 0.0], [0.0, 1.0], [-1.0, 0.0], depth),
            };
        if !(0.0..=length).contains(&marker.along) {
            return None;
        }
        let off = if marker.inside { -OFF } else { OFF };
        let across = du.mul_add(marker.along, nu.mul_add(off, u));
        let deep = dw.mul_add(marker.along, nw.mul_add(off, w));
        let frame = self.prism(block.x, block.z, block.rotation);
        let at = frame.place([across, HEAD.min(block.eave / 2.0), deep]);
        let [east, north, _] = at;
        Some(Mount {
            at,
            above: [east, north, block.top() + CLEAR],
        })
    }
}
