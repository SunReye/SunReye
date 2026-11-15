//! The document stood in a scene (ADR 20): where the scene puts it, on terrain measured from
//! the ground under the blocks, as the faces and solids that are drawn and that shade.

use super::shape::{self, Spot};
use super::{Building, Hedge, Import, Imported, PatchFinish, Roofing, Terrain};
use crate::scene::{Local, fan, pitched, tree, walls};
use crate::{Face, Occluder, Point, Roof, Scene, Surface};

/// Metres from a block's walls over which the terrain comes back from the block's ground.
const BLEND: f64 = 10.0;
/// Every how many nodes the terrain shades: 10 m.
const SHADE: usize = 2;
/// The hex digits of a document's SHA-256.
const DIGEST: usize = 64;

/// An imported building as it stands; a hidden one is told too, so it can be shown again.
#[derive(Debug, Clone, PartialEq)]
pub struct Standing {
    pub id: u32,
    pub hidden: bool,
    pub faces: Vec<Face>,
}

/// A piece of ground on the terrain: an area inside `points`, or with a `width` a line.
#[derive(Debug, Clone, PartialEq)]
pub struct Draped {
    pub finish: PatchFinish,
    pub width: Option<f64>,
    pub points: Vec<Point>,
}

/// The terrain around the blocks: heights above their ground on a square grid of `side` nodes a
/// side, row by row along `along` from `origin`, each row along `across`.
#[derive(Debug, Clone, PartialEq)]
pub struct Relief {
    pub origin: Point,
    /// From one node to the next in a row, and from one row to the next.
    pub across: Point,
    pub along: Point,
    pub side: u32,
    pub heights: Vec<f64>,
}

/// The imported surroundings of a scene, in the shading frame: east, north, up.
#[derive(Debug, Clone, PartialEq)]
pub struct Around {
    pub buildings: Vec<Standing>,
    pub hedges: Vec<Face>,
    /// Each tree's trunk and crown.
    pub trees: Vec<Occluder>,
    /// Drawn in order, each over the last.
    pub grounds: Vec<Draped>,
    pub terrain: Relief,
}

/// Where the document lies in the shading frame: its centre, and its turn's sine and cosine.
struct Lie {
    centre: Spot,
    sin: f64,
    cos: f64,
}

impl Lie {
    fn new(scene: &Scene, import: &Import) -> Self {
        let [east, north, _] = scene.prism(import.x, import.z, 0.0).place([0.0; 3]);
        let (sin, cos) = import.turn.to_radians().sin_cos();
        Self {
            centre: [east, north],
            sin,
            cos,
        }
    }

    /// A spot of the document, turned clockwise seen from above.
    fn place(&self, [east, north]: Spot) -> Spot {
        [
            east.mul_add(self.cos, north * self.sin) + self.centre[0],
            north.mul_add(self.cos, -(east * self.sin)) + self.centre[1],
        ]
    }
}

/// Where a value falls between two of `side` nodes: the lower node and the share toward the
/// next.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the grid"
)]
fn between(value: f64, side: u32) -> (usize, f64) {
    let last = f64::from(side.saturating_sub(1));
    let value = value.clamp(0.0, last);
    let node = value.floor().min((last - 1.0).max(0.0));
    (node as usize, value - node)
}

/// The height `across` nodes along a row and `along` rows up, between the four nodes around;
/// past the grid, its edge's.
fn height(heights: &[f64], side: u32, across: f64, along: f64) -> f64 {
    let ((column, fx), (row, fy)) = (between(across, side), between(along, side));
    let width = usize::try_from(side).unwrap_or(usize::MAX);
    let node = |row: usize, column: usize| {
        let at = row.min(width - 1) * width + column.min(width - 1);
        heights.get(at).copied().unwrap_or(0.0)
    };
    let low = fx.mul_add(node(row, column + 1) - node(row, column), node(row, column));
    let high = fx.mul_add(
        node(row + 1, column + 1) - node(row + 1, column),
        node(row + 1, column),
    );
    fy.mul_add(high - low, low)
}

impl Terrain {
    /// Metres from the centre to an edge.
    fn half(&self) -> f64 {
        self.step * f64::from(self.side.saturating_sub(1)) / 2.0
    }
}

impl Relief {
    /// The terrain's height above the blocks' ground, `east` and `north` of the scene's origin.
    #[must_use]
    pub fn height(&self, east: f64, north: f64) -> f64 {
        let [ax, ay, _] = self.across;
        let [lx, ly, _] = self.along;
        let (dx, dy) = (east - self.origin[0], north - self.origin[1]);
        let step = ax.mul_add(ax, ay * ay);
        if self.side == 0 || step <= 0.0 {
            return 0.0;
        }
        let across = dx.mul_add(ax, dy * ay) / step;
        let along = dx.mul_add(lx, dy * ly) / step;
        height(&self.heights, self.side, across, along)
    }

    fn on(&self, [east, north]: Spot) -> Point {
        [east, north, self.height(east, north)]
    }

    /// The node `column` along row `row`.
    fn node(&self, row: usize, column: usize) -> Option<Point> {
        let width = usize::try_from(self.side).ok()?;
        let up = *self.heights.get(row * width + column)?;
        let (c, r) = (
            f64::from(u32::try_from(column).ok()?),
            f64::from(u32::try_from(row).ok()?),
        );
        Some([
            r.mul_add(self.along[0], c.mul_add(self.across[0], self.origin[0])),
            r.mul_add(self.along[1], c.mul_add(self.across[1], self.origin[1])),
            up,
        ])
    }

    /// The terrain every 10 m as triangles, without those no higher than the blocks' ground:
    /// nothing above it looks up at them.
    fn triangles(&self) -> Vec<Occluder> {
        let cells = usize::try_from(self.side).unwrap_or(0).saturating_sub(1) / SHADE;
        (0..cells)
            .flat_map(|row| (0..cells).map(move |column| (row * SHADE, column * SHADE)))
            .filter_map(|(row, column)| {
                Some([
                    self.node(row, column)?,
                    self.node(row, column + SHADE)?,
                    self.node(row + SHADE, column + SHADE)?,
                    self.node(row + SHADE, column)?,
                ])
            })
            .flat_map(|[a, b, c, d]| [[a, b, c], [a, c, d]])
            .filter(|corners| corners.iter().any(|[_, _, up]| *up > 0.0))
            .map(Occluder::Triangle)
            .collect()
    }
}

/// How far a spot lies from a footprint; 0 inside it.
fn distance(footprint: &[Spot], at: Spot) -> f64 {
    if shape::encloses(footprint, at) {
        return 0.0;
    }
    shape::edges(footprint)
        .map(|([ax, ay], [bx, by])| {
            let (dx, dy) = (bx - ax, by - ay);
            let length = dx.mul_add(dx, dy * dy);
            let t = if length > 0.0 {
                ((at[0] - ax).mul_add(dx, (at[1] - ay) * dy) / length).clamp(0.0, 1.0)
            } else {
                0.0
            };
            (t.mul_add(dx, ax) - at[0]).hypot(t.mul_add(dy, ay) - at[1])
        })
        .fold(f64::INFINITY, f64::min)
}

/// The terrain as it lies in the scene: above the ground under the blocks' middle, or under the
/// scene's origin without blocks, and level under each block.
fn relief(lie: &Lie, terrain: &Terrain, blocks: &[[Spot; 4]]) -> Relief {
    let half = terrain.half();
    let corners: Vec<Spot> = blocks.iter().flatten().copied().collect();
    let stand = if corners.is_empty() {
        [0.0, 0.0]
    } else {
        shape::centre(&corners)
    };
    let origin = lie.place([-half, -half]);
    let step = |to: Spot| {
        let [east, north] = lie.place(to);
        [east - origin[0], north - origin[1], 0.0]
    };
    let mut relief = Relief {
        origin: [origin[0], origin[1], 0.0],
        across: step([terrain.step - half, -half]),
        along: step([-half, terrain.step - half]),
        side: terrain.side,
        heights: terrain.heights.clone(),
    };
    let ground = relief.height(stand[0], stand[1]);
    let width = usize::try_from(terrain.side).unwrap_or(0).max(1);
    let weights: Vec<f64> = (0..relief.heights.len())
        .map(|at| {
            let Some([east, north, _]) = relief.node(at / width, at % width) else {
                return 1.0;
            };
            let near = blocks.iter().map(|b| distance(b, [east, north]));
            (near.fold(f64::INFINITY, f64::min) / BLEND).min(1.0)
        })
        .collect();
    for (height, weight) in relief.heights.iter_mut().zip(weights) {
        *height = (*height - ground) * weight;
    }
    relief
}

const fn face(surface: Surface, corners: Vec<Point>) -> Face {
    Face {
        surface,
        corners,
        colour: None,
    }
}

/// The walls from `foot` up to `top` under each side of the outline.
fn sides(outline: &[Spot], foot: f64, top: f64, surface: Surface) -> Vec<Face> {
    shape::edges(outline)
        .map(|([ax, ay], [bx, by])| {
            let corners = vec![[ax, ay, foot], [bx, by, foot], [bx, by, top], [ax, ay, top]];
            face(surface, corners)
        })
        .collect()
}

/// A building under a flat roof: its walls and its lid as triangles.
fn extruded(outline: &[Spot], foot: f64, top: f64) -> Vec<Face> {
    let lid = shape::triangles(outline)
        .into_iter()
        .map(|corners| face(Surface::Roof, corners.map(|[e, n]| [e, n, top]).to_vec()));
    sides(outline, foot, top, Surface::Wall)
        .into_iter()
        .chain(lid)
        .collect()
}

/// A rectangle's walls and pitched roof: its width from `a` to `b`, its depth on to `c`, its
/// walls from `foot` up to `eave` over `ground`, the ridge `rise` over the eaves.
fn roofed(
    [start, along, across]: [Spot; 3],
    (foot, ground): (f64, f64),
    (eave, rise): (f64, f64),
    hipped: bool,
) -> Vec<Face> {
    let length = |from: Spot, to: Spot| (to[0] - from[0]).hypot(to[1] - from[1]);
    let (width, depth) = (length(start, along), length(along, across));
    let run = if hipped { width.min(depth) } else { depth } / 2.0;
    let pitch = rise.atan2(run).to_degrees();
    let kind = if hipped {
        Roof::Hip { pitch }
    } else {
        Roof::Gable { pitch }
    };
    let roofs = pitched(width, depth, eave, kind);
    let stand = |[wide, up, deep]: Local| {
        let (wide, deep) = (wide / width, deep / depth);
        let at = |axis: usize| {
            let of = |spot: Spot| if axis == 0 { spot[0] } else { spot[1] };
            deep.mul_add(
                of(across) - of(along),
                wide.mul_add(of(along) - of(start), of(start)),
            )
        };
        // A wall reaches down to the lowest ground at its building.
        [at(0), at(1), if up > 0.0 { ground + up } else { foot }]
    };
    let placed =
        |surface, corners: Vec<Local>| face(surface, corners.into_iter().map(stand).collect());
    let roof = roofs.iter().cloned();
    walls(width, depth, &roofs)
        .into_iter()
        .map(|corners| placed(Surface::Wall, corners))
        .chain(roof.map(|corners| placed(Surface::Roof, corners)))
        .collect()
}

fn standing(lie: &Lie, relief: &Relief, building: &Building, hidden: bool) -> Standing {
    let outline: Vec<Spot> = building.outline.iter().map(|at| lie.place(*at)).collect();
    let [east, north] = shape::centre(&outline);
    let ground = relief.height(east, north);
    let foot = outline
        .iter()
        .map(|[e, n]| relief.height(*e, *n))
        .fold(ground, f64::min);
    let (base, eave) = ((foot, ground), building.eave);
    let faces = match (building.roof, outline.as_slice()) {
        (Roofing::Gable { rise }, &[a, b, c, _]) if rise > 0.0 => {
            roofed([a, b, c], base, (eave, rise), false)
        }
        (Roofing::Hipped { rise }, &[a, b, c, _]) if rise > 0.0 => {
            roofed([a, b, c], base, (eave, rise), true)
        }
        _ => extruded(&outline, foot, ground + eave),
    };
    Standing {
        id: building.id,
        hidden,
        faces,
    }
}

/// A box along each stretch of the hedge's line, from the lower end's ground to the hedge's
/// height over the higher end's.
fn hedge(lie: &Lie, relief: &Relief, hedge: &Hedge) -> Vec<Face> {
    let points: Vec<Spot> = hedge.points.iter().map(|at| lie.place(*at)).collect();
    points
        .windows(2)
        .filter_map(|pair| {
            let (&[ax, ay], &[bx, by]) = (pair.first()?, pair.get(1)?);
            let length = (bx - ax).hypot(by - ay);
            if length <= 0.0 {
                return None;
            }
            let half = hedge.width / 2.0 / length;
            let (nx, ny) = (-(by - ay) * half, (bx - ax) * half);
            let outline = [
                [ax - nx, ay - ny],
                [bx - nx, by - ny],
                [bx + nx, by + ny],
                [ax + nx, ay + ny],
            ];
            let (near, far) = (relief.height(ax, ay), relief.height(bx, by));
            let top = near.max(far) + hedge.height;
            let lid = outline.map(|[e, n]| [e, n, top]).to_vec();
            let mut faces = sides(&outline, near.min(far), top, Surface::Hedge);
            faces.push(face(Surface::Hedge, lid));
            Some(faces)
        })
        .flatten()
        .collect()
}

impl Scene {
    /// Each block's footprint in the shading frame, east and north.
    fn footprints(&self) -> Vec<[Spot; 4]> {
        self.blocks
            .iter()
            .map(|block| {
                let frame = self.prism(block.x, block.z, block.rotation);
                let (width, depth) = (block.width, block.depth);
                [[0.0, 0.0], [width, 0.0], [width, depth], [0.0, depth]].map(|[u, w]| {
                    let [east, north, _] = frame.place([u, 0.0, w]);
                    [east, north]
                })
            })
            .collect()
    }

    /// The scene's imported surroundings from its `document`: where the scene lays it, on
    /// terrain measured from the ground under the blocks and level there. `None` for a scene
    /// that names none.
    #[must_use]
    pub fn around(&self, document: &Imported) -> Option<Around> {
        let import = self.imported.as_ref()?;
        let lie = Lie::new(self, import);
        let terrain = relief(&lie, &document.terrain, &self.footprints());
        let buildings = document.buildings.iter().map(|building| {
            let hidden = import.hidden.contains(&building.id);
            standing(&lie, &terrain, building, hidden)
        });
        let trees = document.trees.iter().flat_map(|t| {
            let foot = terrain.on(lie.place(t.at));
            tree(foot, t.radius, t.height, t.crown)
        });
        let grounds = document.grounds.iter().map(|patch| Draped {
            finish: patch.finish,
            width: patch.width,
            points: patch
                .outline
                .iter()
                .map(|at| terrain.on(lie.place(*at)))
                .collect(),
        });
        Some(Around {
            buildings: buildings.collect(),
            hedges: document
                .hedges
                .iter()
                .flat_map(|h| hedge(&lie, &terrain, h))
                .collect(),
            trees: trees.collect(),
            grounds: grounds.collect(),
            terrain,
        })
    }

    /// What the scene shades with among its imported surroundings: its own occluders, then the
    /// buildings not hidden, the hedges, the trees and the terrain every 10 m. Ground never
    /// shades.
    #[must_use]
    pub fn occluders_among(&self, document: Option<&Imported>) -> Vec<Occluder> {
        let around = document.and_then(|document| self.around(document));
        let imported = around.iter().flat_map(Around::occluders);
        self.occluders().into_iter().chain(imported).collect()
    }

    /// Whether the scene's import, if it has one, names a SHA-256 in hex and a place.
    #[must_use]
    pub fn import_fits(&self) -> bool {
        self.imported.as_ref().is_none_or(|import| {
            let digest = import.document.len() == DIGEST
                && import
                    .document
                    .bytes()
                    .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
            digest
                && [import.x, import.z, import.turn]
                    .iter()
                    .all(|v| v.is_finite())
        })
    }
}

impl Around {
    /// What shades: each building not hidden and each hedge as triangles, the trees, and the
    /// terrain.
    #[must_use]
    pub fn occluders(&self) -> Vec<Occluder> {
        let shown = self.buildings.iter().filter(|b| !b.hidden);
        let faces = shown.flat_map(|b| &b.faces).chain(&self.hedges);
        faces
            .flat_map(|face| fan(&face.corners))
            .chain(self.trees.iter().copied())
            .chain(self.terrain.triangles())
            .collect()
    }
}

impl Import {
    /// The `document` as a scene first draws it: its centre on the scene's origin, true north
    /// kept, and each building hidden that stands where a block does.
    #[must_use]
    pub fn load(document: &str, scene: &Scene, imported: &Imported) -> Self {
        let mut import = Self {
            document: document.to_owned(),
            x: 0.0,
            z: 0.0,
            turn: 0.0,
            hidden: Vec::new(),
        };
        let lie = Lie::new(scene, &import);
        let blocks = scene.footprints();
        let under = |building: &&Building| {
            let outline: Vec<Spot> = building.outline.iter().map(|at| lie.place(*at)).collect();
            blocks.iter().any(|block| {
                shape::encloses(&outline, shape::centre(block))
                    || shape::encloses(block, shape::centre(&outline))
            })
        };
        import.hidden = imported
            .buildings
            .iter()
            .filter(under)
            .map(|b| b.id)
            .collect();
        import
    }
}
