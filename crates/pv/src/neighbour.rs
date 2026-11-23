//! Neighbours the builder's consumer supplies around the plant (ADR 20): upright bodies on the
//! ground that shade as the scene's obstacles do. The crate turns them into the faces the
//! browser draws and the occluders the clear-sky run shades with. A scene never stores them.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::scene::fan;
use crate::{Face, Occluder, Surface};

/// An upright prism: a footprint on the ground under a level top.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Neighbour {
    /// Its outline's corners, metres east and north of the scene's origin: north up, as the
    /// consumer's map is, whatever the scene's compass.
    pub footprint: Vec<[f64; 2]>,
    /// Its top's height above the ground, in metres.
    pub height: f64,
}

/// Why a neighbour is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NeighbourRefused {
    /// Its footprint has fewer than three corners.
    Corners,
    /// Its height is not above the ground.
    Height,
}

impl fmt::Display for NeighbourRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Corners => "a neighbour's footprint needs three corners",
            Self::Height => "a neighbour's height must be above the ground",
        })
    }
}

impl Neighbour {
    /// Its walls and its top, in the shading frame: east, north, up.
    ///
    /// # Errors
    /// [`NeighbourRefused`] for a footprint of fewer than three corners or a height not above the ground.
    pub fn faces(&self) -> Result<Vec<Face>, NeighbourRefused> {
        if self.footprint.len() < 3 {
            return Err(NeighbourRefused::Corners);
        }
        if self.height.is_nan() || self.height <= 0.0 {
            return Err(NeighbourRefused::Height);
        }
        let at = |[east, north]: [f64; 2], up| [east, north, up];
        let walls = self
            .footprint
            .iter()
            .zip(self.footprint.iter().cycle().skip(1))
            .map(|(&a, &b)| {
                vec![
                    at(a, 0.0),
                    at(b, 0.0),
                    at(b, self.height),
                    at(a, self.height),
                ]
            });
        let top = self
            .footprint
            .iter()
            .map(|&corner| at(corner, self.height))
            .collect();
        Ok(walls
            .chain([top])
            .map(|corners| Face {
                surface: Surface::Obstacle,
                corners,
                colour: None,
            })
            .collect())
    }

    /// What `neighbours` shade with, each face as a fan of triangles as the scene's are.
    ///
    /// # Errors
    /// The first neighbour's [`NeighbourRefused`].
    pub fn occluders(neighbours: &[Self]) -> Result<Vec<Occluder>, NeighbourRefused> {
        let mut occluders = Vec::new();
        for neighbour in neighbours {
            occluders.extend(
                neighbour
                    .faces()?
                    .iter()
                    .flat_map(|face| fan(&face.corners)),
            );
        }
        Ok(occluders)
    }
}
