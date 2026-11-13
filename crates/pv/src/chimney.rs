//! Chimneys on roof faces (ADR 20): upright boxes that rise from the roof, shade the modules and
//! keep them off their footprint.

use serde::{Deserialize, Serialize};

use crate::{Face, Point, RoofFace, Scene, Surface};

/// An upright box standing on a block's roof face, placed in the face's outline like its module
/// grid: metres across the slope and up it from the face's lowest corner on the left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chimney {
    /// The block's index in the scene.
    pub block: usize,
    /// The roof face's index in its block, as module grids name it.
    pub face: usize,
    /// Its centre on the face.
    pub across: f64,
    pub up: f64,
    /// Its level size: across the slope, and along the fall line seen from above.
    pub width: f64,
    pub depth: f64,
    /// Its level top stands this high over the roof where its upper side meets it.
    pub height: f64,
}

impl Chimney {
    /// Its footprint on `face`: the lower left and upper right corner in the face's outline.
    pub(crate) fn area(&self, face: &RoofFace) -> [[f64; 2]; 2] {
        let half_up = self.depth / 2.0 / face.plane.tilt.to_radians().cos();
        let half_across = self.width / 2.0;
        [
            [self.across - half_across, self.up - half_up],
            [self.across + half_across, self.up + half_up],
        ]
    }

    /// The face it stands on, while it has a size and stands wholly on it.
    fn standing<'a>(&self, roofs: &'a [RoofFace]) -> Option<&'a RoofFace> {
        let face = roofs
            .iter()
            .find(|r| (r.block, r.face) == (self.block, self.face))?;
        let [[l, b], [r, t]] = self.area(face);
        let sized = [self.width, self.depth, self.height]
            .iter()
            .all(|size| size.is_finite() && *size > 0.0);
        let on = [[l, b], [r, b], [r, t], [l, t]]
            .iter()
            .all(|p| face.inside(*p, 0.0));
        (sized && on).then_some(face)
    }

    /// Its four sides and its top, while it stands on its face.
    pub(crate) fn faces(&self, roofs: &[RoofFace]) -> Option<Vec<Face>> {
        let face = self.standing(roofs)?;
        let [[l, b], [r, t]] = self.area(face);
        let foot: Vec<Point> = [[l, b], [r, b], [r, t], [l, t]]
            .into_iter()
            .map(|p| face.point(p))
            .collect();
        let top = foot.iter().map(|[.., up]| *up).fold(f64::MIN, f64::max) + self.height;
        let lid: Vec<Point> = foot
            .iter()
            .map(|&[east, north, _]| [east, north, top])
            .collect();
        let next = foot.iter().zip(&lid).cycle().skip(1);
        let sides = foot
            .iter()
            .zip(&lid)
            .zip(next)
            .map(|((a, a_top), (b, b_top))| vec![*a, *b, *b_top, *a_top]);
        Some(
            sides
                .chain([lid.clone()])
                .map(|corners| Face {
                    surface: Surface::Chimney,
                    corners,
                    colour: None,
                })
                .collect(),
        )
    }
}

impl Scene {
    /// Whether every chimney stands wholly on a roof face, with a positive size.
    ///
    /// # Errors
    /// The index of the first that does not.
    pub fn check_chimneys(&self) -> Result<(), usize> {
        let roofs = self.roofs();
        self.chimneys
            .iter()
            .position(|chimney| chimney.standing(&roofs).is_none())
            .map_or(Ok(()), Err)
    }

    /// Whether every block's overhang is at least 0 and its colours are `#rrggbb`.
    ///
    /// # Errors
    /// The index of the first block that is not.
    pub fn check_blocks(&self) -> Result<(), usize> {
        let painted = |text: &Option<String>| text.as_deref().is_none_or(crate::parking::colour);
        self.blocks
            .iter()
            .position(|block| {
                let reach = [block.overhang.eave, block.overhang.verge];
                !(reach.iter().all(|m| m.is_finite() && *m >= 0.0)
                    && painted(&block.roof_colour)
                    && painted(&block.wall_colour))
            })
            .map_or(Ok(()), Err)
    }
}
