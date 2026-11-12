//! Ground surfaces and fences (ADR 20): stored with the scene and drawn, never shading. The
//! crate places them in the shading frame, so the browser draws what the core accepts.

use serde::{Deserialize, Serialize};

use crate::{Point, Scene};

/// A rectangle on the plot: its width runs along x and its depth along z from its corner,
/// before it turns.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct GroundSurface {
    pub x: f64,
    pub z: f64,
    pub width: f64,
    pub depth: f64,
    /// Degrees clockwise about the corner, seen from above.
    pub rotation: f64,
    pub finish: GroundFinish,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum GroundFinish {
    Lawn,
    Paving,
    Driveway,
    Gravel,
    Path,
}

/// A polyline on the ground through `points`, each `[x, z]` in the scene's frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Fence {
    pub points: Vec<[f64; 2]>,
    pub height: f64,
    pub finish: FenceFinish,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum FenceFinish {
    Wood,
    Metal,
    Wall,
}

/// A ground surface as drawn: its corners on the ground in the shading frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ground {
    pub finish: GroundFinish,
    pub corners: [Point; 4],
}

/// A fence as drawn: its points on the ground in the shading frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Fencing {
    pub finish: FenceFinish,
    pub height: f64,
    pub points: Vec<Point>,
}

impl Scene {
    /// Each ground surface, in the order of `surfaces`.
    ///
    /// # Errors
    /// The index of the first surface without a positive size.
    pub fn ground(&self) -> Result<Vec<Ground>, usize> {
        self.surfaces
            .iter()
            .enumerate()
            .map(|(index, surface)| {
                if surface.width <= 0.0 || surface.depth <= 0.0 {
                    return Err(index);
                }
                let frame = self.prism(surface.x, surface.z, surface.rotation);
                let (width, depth) = (surface.width, surface.depth);
                Ok(Ground {
                    finish: surface.finish,
                    corners: [[0.0, 0.0], [width, 0.0], [width, depth], [0.0, depth]]
                        .map(|[u, w]| frame.place([u, 0.0, w])),
                })
            })
            .collect()
    }

    /// Each fence, in the order of `fences`.
    ///
    /// # Errors
    /// The index of the first fence with fewer than two points or without a positive height.
    pub fn fencing(&self) -> Result<Vec<Fencing>, usize> {
        self.fences
            .iter()
            .enumerate()
            .map(|(index, fence)| {
                if fence.points.len() < 2 || fence.height <= 0.0 {
                    return Err(index);
                }
                let frame = self.prism(0.0, 0.0, 0.0);
                Ok(Fencing {
                    finish: fence.finish,
                    height: fence.height,
                    points: fence
                        .points
                        .iter()
                        .map(|&[x, z]| frame.place([x, 0.0, z]))
                        .collect(),
                })
            })
            .collect()
    }
}
