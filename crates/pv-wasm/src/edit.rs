//! The builder's edits of openings and chimneys (ADR 20), each one call: a drag asks once a step.

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{Opening, OpeningKind, Point, Scene};

/// Opening `index` of a scene as it should be.
#[derive(Deserialize)]
pub struct Refit {
    scene: Scene,
    index: usize,
    opening: Opening,
}

impl Refit {
    /// The opening kept on its wall, or why it cannot be: `overlap` or `room`.
    pub fn reply(&self) -> Value {
        match self.scene.refit(self.index, self.opening) {
            Ok(kept) => json!({ "opening": opening(&kept) }),
            Err(unfit) => json!({ "unfit": unfit }),
        }
    }
}

/// A new opening for a scene, in its kind's usual size.
#[derive(Deserialize)]
pub struct Place {
    scene: Scene,
    kind: OpeningKind,
    width: f64,
    height: f64,
    sill: f64,
}

impl Place {
    /// The opening in the first free place on a wall; null where none takes it.
    pub fn reply(&self) -> Value {
        let placed = self
            .scene
            .place(self.kind, self.width, self.height, self.sill);
        placed.as_ref().map_or(Value::Null, opening)
    }
}

/// Chimney `index` of a scene, moved by a level east and north.
#[derive(Deserialize)]
pub struct Glide {
    scene: Scene,
    index: usize,
    shift: [f64; 2],
}

impl Glide {
    /// The chimney where the move leaves it on its face; null without it or its face.
    pub fn reply(&self) -> Value {
        json!(self.scene.glide(self.index, self.shift))
    }
}

/// A strike on a scene, in the shading frame.
#[derive(Deserialize)]
pub struct Strike {
    scene: Scene,
    point: Point,
}

impl Strike {
    /// The index of the chimney the strike lands on; null for none.
    pub fn reply(&self) -> Value {
        json!(self.scene.chimney_at(self.point))
    }
}

/// With its sill, which a stored opening on the ground leaves out.
fn opening(opening: &Opening) -> Value {
    json!({
        "kind": opening.kind, "block": opening.block, "wall": opening.wall,
        "along": opening.along, "width": opening.width, "height": opening.height,
        "sill": opening.sill,
    })
}
