//! Roof windows (ADR 20): windows lying flush in roof faces. They are drawn and never shade, and
//! no module may overlap one. The builder strikes them, drags them along their face and finds a
//! new one's place.

use serde::{Deserialize, Serialize};

use crate::fitting::snap;
use crate::gliding::glided;
use crate::grid::{Area, overlap};
use crate::{Point, RoofFace, Scene, Size};

/// A window lying flush in a block's roof face, placed in the face's outline like a chimney:
/// metres across the slope and up it from the face's lowest corner on the left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoofWindow {
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

/// Metres a new roof window keeps from its face's edges.
const CLEAR: f64 = 0.3;
/// Metres between the places a new roof window is tried at across its face.
const APART: f64 = 0.5;
/// How far up its face a new roof window is tried, the first first.
const HEIGHTS: [f64; 4] = [0.6, 0.4, 0.75, 0.25];
/// Places tried to either side of a face's middle.
const TRIES: u8 = 60;

impl RoofWindow {
    /// Its pane on its face: the lower left and upper right corner in the face's outline.
    pub(crate) fn area(&self) -> Area {
        let (half_across, half_up) = (self.width / 2.0, self.length / 2.0);
        [
            [self.across - half_across, self.up - half_up],
            [self.across + half_across, self.up + half_up],
        ]
    }

    fn face<'a>(&self, roofs: &'a [RoofFace]) -> Option<&'a RoofFace> {
        roofs
            .iter()
            .find(|r| (r.block, r.face) == (self.block, self.face))
    }

    /// Whether it has a size and lies wholly on `face`, `clear` metres inside its edges.
    fn lies(&self, face: &RoofFace, clear: f64) -> bool {
        let sized = [self.width, self.length]
            .iter()
            .all(|size| size.is_finite() && *size > 0.0);
        sized && face.holds(self.area(), clear)
    }

    /// Whether it lies on `face` off its chimneys, its existing PV and `others`, the face's other
    /// windows.
    fn fits(&self, face: &RoofFace, others: &[Area]) -> bool {
        let area = self.area();
        let free = |taken: &[Area]| !taken.iter().any(|other| overlap(area, *other, 0.0));
        self.lies(face, 0.0) && free(&face.chimneys) && free(&face.existing) && free(others)
    }
}

impl Scene {
    /// The panes of the windows on roof face `face` of block `block`, but window `except`.
    fn panes_on(&self, block: usize, face: usize, except: Option<usize>) -> Vec<Area> {
        let windows = self.roof_windows.iter().enumerate();
        windows
            .filter(|(index, w)| (w.block, w.face) == (block, face) && Some(*index) != except)
            .map(|(_, w)| w.area())
            .collect()
    }

    /// Each roof window's pane in the shading frame, counter-clockwise from the lower left, seen
    /// from the front.
    ///
    /// # Errors
    /// The index of the first without a positive size, on no face, not wholly on its face, or
    /// overlapping a roof chimney or an earlier roof window.
    pub fn panes(&self) -> Result<Vec<[Point; 4]>, usize> {
        let roofs = self.roofs();
        let windows = self.roof_windows.iter().enumerate();
        windows
            .map(|(index, window)| {
                let face = window.face(&roofs).ok_or(index)?;
                let earlier: Vec<Area> = self
                    .roof_windows
                    .iter()
                    .take(index)
                    .filter(|w| (w.block, w.face) == (window.block, window.face))
                    .map(RoofWindow::area)
                    .collect();
                if window.fits(face, &earlier) {
                    Ok(face.corners(window.area()))
                } else {
                    Err(index)
                }
            })
            .collect()
    }

    /// Each roof window's pane as `panes` gives it, in the order of `roof_windows`, whether or
    /// not it fits there; none for one that names no roof face.
    #[must_use]
    pub fn outlines(&self) -> Vec<Option<[Point; 4]>> {
        let roofs = self.roofs();
        let windows = self.roof_windows.iter();
        windows
            .map(|window| Some(window.face(&roofs)?.corners(window.area())))
            .collect()
    }

    /// The index of the first roof window a strike at `point` lands on.
    #[must_use]
    pub fn roof_window_at(&self, point: Point) -> Option<usize> {
        let roofs = self.roofs();
        self.roof_windows.iter().position(|window| {
            let at = window.face(&roofs).and_then(|face| face.locate(point));
            let [[left, low], [right, high]] = window.area();
            at.is_some_and(|[across, up]| {
                (left..=right).contains(&across) && (low..=high).contains(&up)
            })
        })
    }

    /// Roof window `index` moved by a level `east` and `north` metres, seen from above, along
    /// its face: in 10 cm steps, stopped at the face's edge, a chimney, existing PV or another roof
    /// window and sliding along it. One that does not fit where it is goes where it is moved. None
    /// without the window or its face.
    #[must_use]
    pub fn glide_window(&self, index: usize, shift: [f64; 2]) -> Option<RoofWindow> {
        let window = self.roof_windows.get(index)?;
        let roofs = self.roofs();
        let face = window.face(&roofs)?;
        let others = self.panes_on(window.block, window.face, Some(index));
        let at = |[across, up]: [f64; 2]| RoofWindow {
            across,
            up,
            ..*window
        };
        let fits = |to| at(to).fits(face, &others);
        Some(at(glided(face, [window.across, window.up], shift, fits)))
    }

    /// A new roof window `width` across and `length` up in the free place nearest the middle of
    /// the first roof face with room: off the face's edges, its chimneys, its existing PV, its
    /// roof windows and the modules of the grids whose module type `size` knows. None where no
    /// face has room.
    #[must_use]
    pub fn place_window(
        &self,
        size: impl Fn(u32) -> Option<Size>,
        [width, length]: [f64; 2],
    ) -> Option<RoofWindow> {
        let roofs = self.roofs();
        roofs.iter().find_map(|face| {
            let mut taken = self.panes_on(face.block, face.face, None);
            let grids = self.grids.iter();
            let on = grids.filter(|grid| (grid.block, grid.face) == (face.block, face.face));
            taken.extend(on.flat_map(|grid| {
                let size = size(grid.module_type);
                let laid = grid.modules.iter();
                laid.filter_map(move |module| Some(grid.footprint(size?, module.spot)))
            }));
            let far = |axis: usize| {
                let along = face.outline.iter().filter_map(|p| p.get(axis));
                along.copied().fold(0.0, f64::max)
            };
            let (wide, high) = (far(0), far(1));
            let beside = (0..TRIES).flat_map(|step| {
                let off = f64::from(step) * APART;
                [off, -off]
            });
            let places = HEIGHTS
                .iter()
                .flat_map(|share| beside.clone().map(move |off| (off, share * high)));
            places
                .map(|(off, up)| RoofWindow {
                    block: face.block,
                    face: face.face,
                    across: snap(wide / 2.0 + off, 0.1),
                    up: snap(up, 0.1),
                    width,
                    length,
                })
                .find(|window| window.lies(face, CLEAR) && window.fits(face, &taken))
        })
    }
}
