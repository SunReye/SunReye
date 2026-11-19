//! Openings as the builder edits them (ADR 20 Openings, Editing): a change kept on its wall and
//! under its eave, and a new opening's first free place.

use serde::Serialize;

use crate::{Light, Opening, OpeningKind, Scene, Wall};

/// Metres: the smallest opening, the steps a new one's place is sought in, and a new one's
/// distance from a corner.
const SMALLEST: f64 = 0.4;
const STEP: f64 = 0.1;
const CLEAR: f64 = 0.5;
/// Metres a new opening keeps from its neighbours.
const APART: f64 = STEP * 2.0;

/// Why an opening cannot be as asked: it lies over another, or its wall has no room for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unfit {
    Overlap,
    Room,
}

/// `value` on the nearest `step`, float noise off: never further than a micrometre, never −0.
pub fn snap(value: f64, step: f64) -> f64 {
    // Halves round up, as the browser's numbers do.
    let nearest = |value: f64| (value + 0.5).floor();
    nearest(nearest(value / step) * step * 1e6) / 1e6 + 0.0
}

impl Scene {
    /// Opening `index` as `opening`, kept on its wall and under its eave, a door on the ground.
    ///
    /// # Errors
    /// Why it cannot be: there is no such opening, its wall is too short or too low for it or
    /// stands on no walled block, or kept there it lies over another opening.
    pub fn refit(&self, index: usize, opening: Opening) -> Result<Opening, Unfit> {
        let kept = self
            .openings
            .get(index)
            .and_then(|_| self.kept(opening))
            .ok_or(Unfit::Room)?;
        if self.clear(&kept, Some(index)) {
            Ok(kept)
        } else {
            Err(Unfit::Overlap)
        }
    }

    /// A new opening of `kind`, `width` by `height` over `sill`, in the first free place on a
    /// walled block: a wall at a time from the front, each from its left end. None takes it
    /// where every wall is too short or full.
    #[must_use]
    pub fn place(&self, kind: OpeningKind, width: f64, height: f64, sill: f64) -> Option<Opening> {
        let walled = self.blocks.iter().enumerate().filter(|(_, b)| !b.open);
        walled
            .flat_map(|(block, _)| Wall::ALL.map(|wall| (block, wall)))
            .find_map(|(block, wall)| {
                self.free(self.kept(Opening {
                    kind,
                    block,
                    wall,
                    along: 0.0,
                    width,
                    height,
                    sill,
                    light: Light::Auto,
                })?)
            })
    }

    /// `opening` on its wall: no smaller than the smallest, a door on the ground, under the
    /// eave, between the wall's ends, in centimetres.
    fn kept(&self, opening: Opening) -> Option<Opening> {
        let block = self.blocks.get(opening.block).filter(|b| !b.open)?;
        let length = opening.wall.run(block.width, block.depth).length;
        let sill = if opening.kind.door() {
            0.0
        } else {
            opening.sill.max(0.0).min(block.eave - SMALLEST)
        };
        let width = opening.width.max(SMALLEST);
        let height = opening.height.max(SMALLEST);
        (width <= length && sill >= 0.0).then(|| Opening {
            sill,
            width: snap(width, 0.01),
            height: snap(height.min(block.eave - sill), 0.01),
            along: snap(opening.along.max(0.0).min(length - width), 0.01),
            ..opening
        })
    }

    /// Whether `opening` shares no wall with another, the one at `but` aside.
    fn clear(&self, opening: &Opening, but: Option<usize>) -> bool {
        let others = self.openings.iter().enumerate();
        others
            .filter(|(at, _)| Some(*at) != but)
            .all(|(_, other)| !opening.overlaps(other))
    }

    /// `sized` in the first place from its wall's left end that keeps clear of its corners and
    /// apart from every other opening.
    fn free(&self, sized: Opening) -> Option<Opening> {
        let block = self.blocks.get(sized.block)?;
        let last = sized.wall.run(block.width, block.depth).length - CLEAR - sized.width;
        std::iter::successors(Some(0.0), |step| Some(step + 1.0))
            .map(|step: f64| snap(step.mul_add(STEP, CLEAR), STEP))
            .take_while(|along| *along <= last + 1e-9)
            .find(|along| {
                let roomy = Opening {
                    along: along - APART,
                    width: APART.mul_add(2.0, sized.width),
                    ..sized
                };
                self.clear(&roomy, None)
            })
            .map(|along| Opening { along, ..sized })
    }
}
