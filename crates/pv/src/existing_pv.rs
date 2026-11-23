//! Existing PV (ADR 20): modules already on a roof face that stay, as one rectangle on it. They
//! are drawn and never shade, produce nothing, and no new module may overlap them.

use serde::{Deserialize, Serialize};

use crate::grid::{Area, overlap};
use crate::{Point, RoofFace, Scene};

/// Modules already on a block's roof face, placed in the face's outline like a roof window:
/// metres across the slope and up it from the face's lowest corner on the left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExistingPv {
    /// The block's index in the scene.
    pub block: usize,
    /// The roof face's index in its block, as module grids name it.
    pub face: usize,
    /// Its centre on the face.
    pub across: f64,
    pub up: f64,
    /// Its size: across the slope, and up it.
    pub width: f64,
    pub length: f64,
}

impl ExistingPv {
    /// Its field on its face: the lower left and upper right corner in the face's outline.
    pub(crate) fn area(&self) -> Area {
        let (half_across, half_up) = (self.width / 2.0, self.length / 2.0);
        [
            [self.across - half_across, self.up - half_up],
            [self.across + half_across, self.up + half_up],
        ]
    }

    /// Whether it has a size and lies wholly on `face`, off its chimneys, its roof windows and
    /// `others`.
    fn fits(&self, face: &RoofFace, others: &[Area]) -> bool {
        let area = self.area();
        let sized = [self.width, self.length]
            .iter()
            .all(|size| size.is_finite() && *size > 0.0);
        let free = |taken: &[Area]| !taken.iter().any(|other| overlap(area, *other, 0.0));
        sized
            && face.holds(area, 0.0)
            && free(&face.chimneys)
            && free(&face.windows)
            && free(others)
    }
}

impl Scene {
    /// Each existing PV's field in the shading frame, counter-clockwise from the lower left, seen
    /// from the front.
    ///
    /// # Errors
    /// The index of the first without a positive size, on no face, not wholly on its face, or
    /// overlapping a roof chimney, a roof window or an earlier existing PV.
    pub fn existing_fields(&self) -> Result<Vec<[Point; 4]>, usize> {
        let roofs = self.roofs();
        self.existing_pv
            .iter()
            .enumerate()
            .map(|(index, field)| {
                let face = roofs
                    .iter()
                    .find(|r| (r.block, r.face) == (field.block, field.face))
                    .ok_or(index)?;
                let earlier: Vec<Area> = self
                    .existing_pv
                    .iter()
                    .take(index)
                    .filter(|f| (f.block, f.face) == (field.block, field.face))
                    .map(ExistingPv::area)
                    .collect();
                if field.fits(face, &earlier) {
                    Ok(face.corners(field.area()))
                } else {
                    Err(index)
                }
            })
            .collect()
    }
}
