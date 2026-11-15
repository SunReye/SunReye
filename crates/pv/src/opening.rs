//! Windows and doors on a block's walls (ADR 20). They are drawn only and never shade:
//! `Scene::fitted` fits each on its wall, and the browser lights the windows at night.

use serde::{Deserialize, Serialize};

use crate::{Point, Scene, Wall};

/// A window or a door in a block's wall.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Opening {
    pub kind: OpeningKind,
    /// The block's index in the scene.
    pub block: usize,
    pub wall: Wall,
    /// Metres from the wall's left end to the opening's left edge, seen from outside.
    pub along: f64,
    pub width: f64,
    pub height: f64,
    /// Metres from the ground to its lower edge; a door's is 0.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub sill: f64,
}

#[expect(
    clippy::trivially_copy_pass_by_ref,
    reason = "serde hands the field by reference"
)]
fn is_zero(metres: &f64) -> bool {
    *metres == 0.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum OpeningKind {
    Window,
    /// From the floor to near the ceiling.
    FrenchWindow,
    FrontDoor,
    GarageDoor,
}

impl OpeningKind {
    /// A door stands on the ground.
    pub(crate) const fn door(self) -> bool {
        matches!(self, Self::FrontDoor | Self::GarageDoor)
    }
}

/// An opening as drawn, in the shading frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fitted {
    pub kind: OpeningKind,
    /// On the wall, seen from outside: low left, low right, high right, high left.
    pub corners: [Point; 4],
    /// The wall's outward normal, level.
    pub out: Point,
}

impl Opening {
    /// Whether both lie on one wall and share some of it.
    pub(crate) fn overlaps(&self, other: &Self) -> bool {
        self.block == other.block
            && self.wall == other.wall
            && self.along < other.along + other.width
            && other.along < self.along + self.width
            && self.sill < other.sill + other.height
            && other.sill < self.sill + self.height
    }
}

impl Scene {
    /// Each opening on its wall, in the order of `openings`.
    ///
    /// # Errors
    /// The index of the first opening that names no walled block, has no positive size, lies
    /// past its wall's ends or above the eave, is a door off the ground, or overlaps an earlier
    /// opening on its wall.
    pub fn fitted(&self) -> Result<Vec<Fitted>, usize> {
        self.openings
            .iter()
            .enumerate()
            .map(|(index, opening)| {
                let earlier = self.openings.iter().take(index);
                self.fit(opening)
                    .filter(|_| !earlier.clone().any(|other| opening.overlaps(other)))
                    .ok_or(index)
            })
            .collect()
    }

    fn fit(&self, opening: &Opening) -> Option<Fitted> {
        let block = self.blocks.get(opening.block).filter(|block| !block.open)?;
        let Opening {
            along,
            width,
            height,
            sill,
            ..
        } = *opening;
        let run = opening.wall.run(block.width, block.depth);
        let sized = width > 0.0 && height > 0.0 && sill >= 0.0;
        let on_wall = along >= 0.0 && along + width <= run.length && sill + height <= block.eave;
        if !sized || !on_wall || (opening.kind.door() && sill != 0.0) {
            return None;
        }
        let frame = self.prism(block.x, block.z, block.rotation);
        let at = |across: f64, up: f64| {
            frame.place([
                run.across.mul_add(across, run.left[0]),
                up,
                run.deep.mul_add(across, run.left[1]),
            ])
        };
        let [east, north, _] = frame.place([run.out[0], 0.0, run.out[1]]);
        let [east0, north0, _] = frame.place([0.0; 3]);
        Some(Fitted {
            kind: opening.kind,
            corners: [
                at(along, sill),
                at(along + width, sill),
                at(along + width, sill + height),
                at(along, sill + height),
            ],
            out: [east - east0, north - north0, 0.0],
        })
    }
}
