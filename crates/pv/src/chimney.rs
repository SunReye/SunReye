//! Chimneys on roof faces (ADR 20): upright boxes that rise from the roof, shade the modules and
//! keep them off their footprint. The builder strikes them and drags them along their face.

use serde::{Deserialize, Serialize};

use crate::gliding::{along, glided};
use crate::grid::overlap;
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
    /// Degrees it is turned in its face, clockwise seen from above; none stored unturned.
    #[serde(default, skip_serializing_if = "crate::turned::is_zero")]
    pub turn: f64,
}

/// A strike this close to a chimney's sides or top, in metres, still lands on it.
const EDGE: f64 = 0.05;

/// A chimney's foot on its roof face, in the shading frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Footing {
    /// From the lower left, counter-clockwise seen from the front.
    pub foot: [Point; 4],
    /// The height of its level top.
    pub top: f64,
}

impl Footing {
    fn low(&self) -> f64 {
        self.foot
            .iter()
            .map(|[.., up]| *up)
            .fold(f64::MAX, f64::min)
    }
}

impl Chimney {
    /// Half its footprint on `face`, across and up the slope, before its turn.
    fn half(&self, face: &RoofFace) -> [f64; 2] {
        [
            self.width / 2.0,
            self.depth / 2.0 / face.plane.tilt.to_radians().cos(),
        ]
    }

    /// What its footprint covers on `face`: the lower left and upper right corner in the face's
    /// outline, round it however it is turned.
    pub(crate) fn area(&self, face: &RoofFace) -> [[f64; 2]; 2] {
        crate::turned::bounds(&self.corners(face))
    }

    /// Its footprint's corners on `face`, from its own lower left.
    fn corners(&self, face: &RoofFace) -> [[f64; 2]; 4] {
        crate::turned::corners([self.across, self.up], self.half(face), self.turn)
    }

    /// Whether it stands wholly on `face`.
    fn fits(&self, face: &RoofFace) -> bool {
        face.holds(self.area(face), 0.0)
    }

    /// Whether it stands on one of the face's roof windows or existing PV.
    fn glazed(&self, face: &RoofFace) -> bool {
        let area = self.area(face);
        let mut lying = face.windows.iter().chain(&face.existing);
        lying.any(|pane| overlap(area, *pane, 0.0))
    }

    fn footing(&self, face: &RoofFace) -> Footing {
        let foot = self.corners(face).map(|p| face.point(p));
        let highest = foot.iter().map(|[.., up]| *up).fold(f64::MIN, f64::max);
        Footing {
            foot,
            top: highest + self.height,
        }
    }

    fn face<'a>(&self, roofs: &'a [RoofFace]) -> Option<&'a RoofFace> {
        roofs
            .iter()
            .find(|r| (r.block, r.face) == (self.block, self.face))
    }

    /// The face it stands on, while it has a size and stands wholly on it.
    fn standing<'a>(&self, roofs: &'a [RoofFace]) -> Option<&'a RoofFace> {
        let face = self.face(roofs)?;
        let sized = [self.width, self.depth, self.height]
            .iter()
            .all(|size| size.is_finite() && *size > 0.0);
        (sized && self.fits(face)).then_some(face)
    }

    /// Its four sides and its top, while it stands on its face.
    pub(crate) fn faces(&self, roofs: &[RoofFace]) -> Option<Vec<Face>> {
        let Footing { foot, top } = self.footing(self.standing(roofs)?);
        let lid = foot.map(|[east, north, _]| [east, north, top]);
        let next = foot.iter().zip(&lid).cycle().skip(1);
        let sides = foot
            .iter()
            .zip(&lid)
            .zip(next)
            .map(|((a, a_top), (b, b_top))| vec![*a, *b, *b_top, *a_top]);
        Some(
            sides
                .chain([lid.to_vec()])
                .map(|corners| Face {
                    surface: Surface::Chimney,
                    corners,
                    colour: None,
                    obstacle: None,
                })
                .collect(),
        )
    }

    /// Whether a strike at `point` lands on it, standing on `face`.
    fn struck(&self, face: &RoofFace, point: Point) -> bool {
        let footing = self.footing(face);
        let [east, north, up] = point;
        let at = along(face, [east - face.origin[0], north - face.origin[1]]);
        // Up the face, metres along the slope per metre seen from above.
        let edge = EDGE / face.plane.tilt.to_radians().cos();
        let centre = [self.across, self.up];
        crate::turned::within(centre, self.half(face), self.turn, at, [EDGE, edge])
            && (footing.low() - EDGE..=footing.top + EDGE).contains(&up)
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

    /// Each chimney's footing, in the order of `chimneys`; none for one that names no roof face.
    #[must_use]
    pub fn footings(&self) -> Vec<Option<Footing>> {
        let roofs = self.roofs();
        self.chimneys
            .iter()
            .map(|chimney| Some(chimney.footing(chimney.face(&roofs)?)))
            .collect()
    }

    /// The index of the first chimney a strike at `point` lands on, its sides and top with it.
    #[must_use]
    pub fn chimney_at(&self, point: Point) -> Option<usize> {
        let roofs = self.roofs();
        self.chimneys.iter().position(|chimney| {
            chimney
                .face(&roofs)
                .is_some_and(|face| chimney.struck(face, point))
        })
    }

    /// Chimney `index` moved by a level `east` and `north` metres, seen from above, along its
    /// face: in 10 cm steps, stopped at the face's edge, a roof window or existing PV and sliding
    /// along it.
    /// One already off its face goes where it is moved. None without the chimney or its face.
    #[must_use]
    pub fn glide(&self, index: usize, shift: [f64; 2]) -> Option<Chimney> {
        let chimney = self.chimneys.get(index)?;
        let roofs = self.roofs();
        let face = chimney.face(&roofs)?;
        let at = |[across, up]: [f64; 2]| Chimney {
            across,
            up,
            ..*chimney
        };
        let stands = |to| {
            let moved = at(to);
            moved.fits(face) && !moved.glazed(face)
        };
        Some(at(glided(
            face,
            [chimney.across, chimney.up],
            shift,
            stands,
        )))
    }

    /// Whether every block's overhang is at least 0, its colours are `#rrggbb`, and its free-form
    /// roof, if any, is valid with no overhang of its own (ADR 20).
    ///
    /// # Errors
    /// The index of the first block that is not.
    pub fn check_blocks(&self) -> Result<(), usize> {
        let painted = |text: &Option<String>| text.as_deref().is_none_or(crate::parking::colour);
        self.blocks
            .iter()
            .position(|block| {
                let reach = [block.overhang.eave, block.overhang.verge];
                let free = block.free_form.as_ref().is_none_or(|free| {
                    free.valid() && block.overhang == crate::Overhang::default()
                });
                let named = block.name.as_deref().is_none_or(|name| {
                    !name.trim().is_empty() && name.chars().count() <= crate::BLOCK_NAME
                });
                !(reach.iter().all(|m| m.is_finite() && *m >= 0.0)
                    && named
                    && painted(&block.roof_colour)
                    && painted(&block.wall_colour)
                    && free)
            })
            .map_or(Ok(()), Err)
    }
}
