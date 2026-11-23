//! What is known of a roof face beyond its shape (ADR 20): its covering and whether its pitch is
//! confirmed. Nothing in the yield reads them.

use serde::{Deserialize, Serialize};

use crate::Scene;

/// What a roof face is covered with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum Covering {
    Tiles,
    Slate,
    /// Sheet metal.
    Metal,
    Bitumen,
}

/// A roof face's covering and pitch, named by block and face as a module grid names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct FaceDetail {
    /// The block's index in the scene.
    pub block: usize,
    /// The roof face's index in its block, as module grids name it.
    pub face: usize,
    /// Unknown without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub covering: Option<Covering>,
    /// Its pitch was confirmed, not estimated.
    #[serde(
        default,
        rename = "pitchConfirmed",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub pitch_confirmed: bool,
}

impl Scene {
    /// Whether every face detail names a roof face, and no face has two.
    ///
    /// # Errors
    /// The index of the first that does not, or of the second for one face.
    pub fn check_details(&self) -> Result<(), usize> {
        let faces: Vec<(usize, usize)> = self.roof_faces().map(|(b, f, _, _)| (b, f)).collect();
        self.face_details
            .iter()
            .enumerate()
            .position(|(at, detail)| {
                let named = (detail.block, detail.face);
                let before = self.face_details.iter().take(at);
                !faces.contains(&named) || before.into_iter().any(|d| (d.block, d.face) == named)
            })
            .map_or(Ok(()), Err)
    }
}
