//! Free-form roofs (ADR 20): a block on a polygon footprint under flat faces given by their
//! corners, drawn by hand or taken from a surveyed building model.

use serde::{Deserialize, Serialize};

use crate::Point;
use crate::polygon::{Plan, overlap, simple};
use crate::shade::{dot, sub};

/// Below this a face has no area or does not face up.
const EPSILON: f64 = 1e-9;

/// A footprint and the faces over it, in the scene's frame before the compass turns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct FreeForm {
    /// Corners as x and z, in metres.
    pub footprint: Vec<[f64; 2]>,
    /// Each face's corners as x, y and z, in metres, counter-clockwise seen from above.
    pub faces: Vec<Vec<[f64; 3]>>,
}

/// Metres a corner may lie off its face's plane (ADR 20).
pub const FLATNESS: f64 = 0.02;

impl FreeForm {
    /// Whether its footprint is a polygon and every face flat, simple, facing up and over it.
    pub(crate) fn valid(&self) -> bool {
        simple(&self.footprint) && self.faces.iter().all(|face| self.holds(face))
    }

    fn holds(&self, face: &[[f64; 3]]) -> bool {
        let plan: Vec<Plan> = face.iter().map(|&[x, _, z]| [x, z]).collect();
        let Some(normal) = facing(face) else {
            return false;
        };
        let count = f64::from(u32::try_from(face.len()).unwrap_or(u32::MAX));
        let mean = face.iter().fold([0.0; 3], |[x, y, z], [px, py, pz]| {
            [x + px / count, y + py / count, z + pz / count]
        });
        let flat = face
            .iter()
            .all(|&p| dot(sub(p, mean), normal).abs() <= FLATNESS);
        simple(&plan) && flat && overlap(&plan, &self.footprint)
    }
}

/// A face's unit normal in the scene's frame, by Newell's method, while its corners run
/// counter-clockwise seen from above; none for one facing down, upright or without area.
fn facing(face: &[[f64; 3]]) -> Option<Point> {
    let next = face.iter().cycle().skip(1);
    let n = face.iter().zip(next).fold([0.0; 3], |n, (a, b)| {
        [
            (a[1] - b[1]).mul_add(a[2] + b[2], n[0]),
            (a[2] - b[2]).mul_add(a[0] + b[0], n[1]),
            (a[0] - b[0]).mul_add(a[1] + b[1], n[2]),
        ]
    });
    let length = dot(n, n).sqrt();
    // y is up, and x then z turn clockwise seen from above.
    (face.len() >= 3 && length > EPSILON && n[1] / length > EPSILON).then(|| n.map(|v| v / length))
}
