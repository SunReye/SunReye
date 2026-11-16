//! The builder's edits of openings, chimneys, roof windows and modules (ADR 20), each one call: a
//! drag asks once a step.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{Ghost, Opening, OpeningKind, Point, Scene, Size};

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

/// Chimney or roof window `index` of a scene, moved by a level east and north.
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

    /// The roof window where the move leaves it on its face; null without it or its face.
    pub fn window(&self) -> Value {
        json!(self.scene.glide_window(self.index, self.shift))
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

impl Strike {
    /// The index of the roof window the strike lands on; null for none.
    pub fn window(&self) -> Value {
        json!(self.scene.roof_window_at(self.point))
    }

    /// The index of the grid whose face the strike lands on, inside its setback; null for none.
    pub fn grid(&self) -> Value {
        json!(self.scene.grid_at(self.point))
    }
}

/// A scene's grid `grid` and the size of each module type, by id.
#[derive(Deserialize)]
pub struct Laid {
    scene: Scene,
    sizes: HashMap<u32, Size>,
    #[serde(default)]
    grid: usize,
}

impl Laid {
    /// The places "Fill face" adds to the grid, across and up its face.
    pub fn fill(&self) -> Value {
        json!(self.scene.fill(self.grid, sized(&self.sizes)))
    }

    /// The modules a roof chimney stands on, each its grid's index and its own in it.
    pub fn covered(&self) -> Value {
        json!(self.scene.covered(sized(&self.sizes)))
    }
}

/// A new roof window for a scene, `width` across and `length` up its face.
#[derive(Deserialize)]
pub struct Glazed {
    scene: Scene,
    sizes: HashMap<u32, Size>,
    width: f64,
    length: f64,
}

impl Glazed {
    /// The roof window in the free place nearest the middle of the first roof face with room;
    /// null where none has.
    pub fn reply(&self) -> Value {
        json!(
            self.scene
                .place_window(sized(&self.sizes), [self.width, self.length])
        )
    }
}

fn sized(sizes: &HashMap<u32, Size>) -> impl Fn(u32) -> Option<Size> {
    |id| sizes.get(&id).copied()
}

/// A press on a grid's face at `from`, in the shading frame, dragged to `to`.
#[derive(Deserialize)]
pub struct Lay {
    scene: Scene,
    sizes: HashMap<u32, Size>,
    grid: usize,
    from: Point,
    to: Point,
}

impl Lay {
    /// The ghost module under the pointer and, with a drag, the row along it; null for a press
    /// off the face.
    pub fn reply(&self) -> Value {
        let drag = [self.from, self.to];
        let row = self.scene.lay(self.grid, sized(&self.sizes), drag);
        row.map_or(Value::Null, |row| row.iter().map(ghost).collect())
    }
}

/// Module `module` of a grid dragged from `from`, in the shading frame, to `to`.
#[derive(Deserialize)]
pub struct Slide {
    scene: Scene,
    sizes: HashMap<u32, Size>,
    grid: usize,
    module: usize,
    from: Point,
    to: Point,
}

impl Slide {
    /// Where the module would lie and whether it fits there; null without it or its face.
    pub fn reply(&self) -> Value {
        let drag = [self.from, self.to];
        let slid = self
            .scene
            .slide(self.grid, self.module, sized(&self.sizes), drag);
        slid.as_ref().map_or(Value::Null, ghost)
    }
}

fn ghost(ghost: &Ghost) -> Value {
    json!({
        "across": ghost.across, "up": ghost.up, "landscape": ghost.landscape,
        "fits": ghost.fits, "corners": ghost.corners,
    })
}

/// With its sill, which a stored opening on the ground leaves out.
fn opening(opening: &Opening) -> Value {
    json!({
        "kind": opening.kind, "block": opening.block, "wall": opening.wall,
        "along": opening.along, "width": opening.width, "height": opening.height,
        "sill": opening.sill,
    })
}
