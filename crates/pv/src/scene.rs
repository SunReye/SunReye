//! Blocks, roofs and obstacles as the faces and solids that both draw the scene and shade its
//! modules (ADR 20), so the builder and the forecast never disagree.
//!
//! The scene's frame is metres, y up, origin at the first block's corner; the compass turns it
//! into the shading frame: east, north, up.

use serde::Deserialize;

use crate::{Occluder, Point};

/// A trunk's radius as a share of its crown's.
const TRUNK: f64 = 0.1;
/// Metres within which two corners are one.
const EPSILON: f64 = 1e-9;

/// The geometry of a plant, without its modules.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    /// The compass bearing, in degrees clockwise from true north, of the scene's forward axis, −z.
    pub north: f64,
    pub blocks: Vec<Block>,
    pub obstacles: Vec<Obstacle>,
}

/// A rectangular footprint with one roof. Its width runs along x and its depth along z from its
/// corner, before it turns.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Block {
    pub x: f64,
    pub z: f64,
    pub width: f64,
    pub depth: f64,
    /// The walls' height under the roof.
    pub eave: f64,
    /// Degrees clockwise about the corner, seen from above.
    pub rotation: f64,
    pub roof: Roof,
}

/// Pitches in degrees from horizontal.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Roof {
    Flat,
    /// Rises from the front eave (+z) to the back.
    MonoPitch {
        pitch: f64,
    },
    /// Its ridge runs along the width.
    Gable {
        pitch: f64,
    },
    /// Its ridge runs along the longer side.
    Hip {
        pitch: f64,
    },
}

/// Opaque things that cast shade. Positions are a box's corner, else the foot's centre.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Obstacle {
    /// A neighbour or a wall.
    Box {
        x: f64,
        z: f64,
        width: f64,
        depth: f64,
        height: f64,
        rotation: f64,
    },
    /// A chimney or a pole.
    Cylinder {
        x: f64,
        z: f64,
        radius: f64,
        height: f64,
    },
    /// A trunk under a sphere crown of `radius` whose top is at `height`.
    Tree {
        x: f64,
        z: f64,
        radius: f64,
        height: f64,
    },
}

/// What a face is, so it can be drawn as such.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Wall,
    Roof,
    Obstacle,
}

/// A flat convex polygon in the shading frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Face {
    pub surface: Surface,
    pub corners: Vec<Point>,
}

/// Along the width, up, along the depth: a block's own frame.
type Local = [f64; 3];

impl Scene {
    /// Every wall and roof of the blocks, and every side of the box obstacles.
    #[must_use]
    pub fn faces(&self) -> Vec<Face> {
        let blocks = self.blocks.iter().flat_map(|block| {
            let roofs = roof(block);
            self.prism(block.x, block.z, block.rotation).faces(
                [block.width, block.depth],
                roofs,
                [Surface::Wall, Surface::Roof],
            )
        });
        let boxes = self.obstacles.iter().flat_map(|obstacle| match *obstacle {
            Obstacle::Box {
                x,
                z,
                width,
                depth,
                height,
                rotation,
            } => self.prism(x, z, rotation).faces(
                [width, depth],
                vec![lid(width, depth, height)],
                [Surface::Obstacle; 2],
            ),
            Obstacle::Cylinder { .. } | Obstacle::Tree { .. } => Vec::new(),
        });
        blocks.chain(boxes).collect()
    }

    /// What the scene shades with (ADR 17): each face as a fan of triangles, then the solids.
    #[must_use]
    pub fn occluders(&self) -> Vec<Occluder> {
        let triangles = self.faces().into_iter().flat_map(|face| fan(&face.corners));
        triangles.chain(self.solids()).collect()
    }

    /// The round obstacles: chimneys and poles, and each tree as its trunk and its crown.
    #[must_use]
    pub fn solids(&self) -> Vec<Occluder> {
        self.obstacles
            .iter()
            .flat_map(|obstacle| match *obstacle {
                Obstacle::Box { .. } => Vec::new(),
                Obstacle::Cylinder {
                    x,
                    z,
                    radius,
                    height,
                } => vec![Occluder::Cylinder {
                    base: self.prism(x, z, 0.0).place([0.0; 3]),
                    radius,
                    height,
                }],
                Obstacle::Tree {
                    x,
                    z,
                    radius,
                    height,
                } => {
                    let foot = self.prism(x, z, 0.0);
                    vec![
                        Occluder::Cylinder {
                            base: foot.place([0.0; 3]),
                            radius: radius * TRUNK,
                            height: height - radius,
                        },
                        Occluder::Sphere {
                            centre: foot.place([0.0, height - radius, 0.0]),
                            radius,
                        },
                    ]
                }
            })
            .collect()
    }

    const fn prism(&self, x: f64, z: f64, rotation: f64) -> Frame {
        Frame {
            x,
            z,
            rotation,
            north: self.north,
        }
    }
}

/// A convex polygon as triangles sharing its first corner.
fn fan(corners: &[Point]) -> Vec<Occluder> {
    let Some((&first, rest)) = corners.split_first() else {
        return Vec::new();
    };
    rest.windows(2)
        .filter_map(|pair| match *pair {
            [b, c] => Some(Occluder::Triangle([first, b, c])),
            _ => None,
        })
        .collect()
}

/// Where a footprint stands: its corner, its turn and the compass.
struct Frame {
    x: f64,
    z: f64,
    rotation: f64,
    north: f64,
}

impl Frame {
    /// A footprint's walls under `tops` and the tops themselves, in the shading frame, drawn as
    /// the side and the top surface.
    fn faces(
        &self,
        [width, depth]: [f64; 2],
        tops: Vec<Vec<Local>>,
        [side, top]: [Surface; 2],
    ) -> Vec<Face> {
        let walls = walls(width, depth, &tops);
        walls
            .into_iter()
            .map(|corners| (side, corners))
            .chain(tops.into_iter().map(|corners| (top, corners)))
            .map(|(surface, corners)| Face {
                surface,
                corners: corners.into_iter().map(|p| self.place(p)).collect(),
            })
            .collect()
    }

    fn place(&self, [across, up, deep]: Local) -> Point {
        let (x, z) = turn(across, deep, self.rotation);
        let (east, south) = turn(x + self.x, z + self.z, self.north);
        // Never −0, which JSON keeps.
        [east, 0.0 - south, up]
    }
}

/// Clockwise seen from above, where forward is −z.
fn turn(x: f64, z: f64, degrees: f64) -> (f64, f64) {
    let (sin, cos) = degrees.to_radians().sin_cos();
    (x.mul_add(cos, -z * sin), x.mul_add(sin, z * cos))
}

const fn footprint(width: f64, depth: f64) -> [[f64; 2]; 4] {
    [[0.0, 0.0], [width, 0.0], [width, depth], [0.0, depth]]
}

/// Each side of the footprint, corner to corner.
fn edges(width: f64, depth: f64) -> impl Iterator<Item = ([f64; 2], [f64; 2])> {
    let corners = footprint(width, depth);
    corners.into_iter().zip(corners.into_iter().cycle().skip(1))
}

fn lid(width: f64, depth: f64, height: f64) -> Vec<Local> {
    footprint(width, depth)
        .into_iter()
        .map(|[u, w]| [u, height, w])
        .collect()
}

fn roof(block: &Block) -> Vec<Vec<Local>> {
    let (width, depth, eave) = (block.width, block.depth, block.eave);
    let rise = |run: f64, pitch: f64| run.mul_add(pitch.to_radians().tan(), eave);
    match block.roof {
        Roof::Flat => vec![lid(width, depth, eave)],
        Roof::MonoPitch { pitch } => {
            let top = rise(depth, pitch);
            vec![vec![
                [0.0, top, 0.0],
                [width, top, 0.0],
                [width, eave, depth],
                [0.0, eave, depth],
            ]]
        }
        Roof::Gable { pitch } => {
            let (top, middle) = (rise(depth / 2.0, pitch), depth / 2.0);
            [0.0, depth]
                .into_iter()
                .map(|w| {
                    vec![
                        [0.0, eave, w],
                        [width, eave, w],
                        [width, top, middle],
                        [0.0, top, middle],
                    ]
                })
                .collect()
        }
        Roof::Hip { pitch } => {
            let run = width.min(depth) / 2.0;
            let top = rise(run, pitch);
            let mut ridge = vec![[run, top, run], [width - run, top, depth - run]];
            ridge.dedup_by(|a, b| close(*a, *b));
            edges(width, depth)
                .map(|(a, b)| {
                    let near = ridge
                        .iter()
                        .filter(|p| (distance(a, b, **p) - run).abs() < EPSILON);
                    outline(a, b, eave, near.copied().collect())
                })
                .collect()
        }
    }
}

/// The wall under each side of the footprint, up to the roof corners standing on that side.
fn walls(width: f64, depth: f64, roofs: &[Vec<Local>]) -> Vec<Vec<Local>> {
    edges(width, depth)
        .map(|(a, b)| {
            let mut tops: Vec<Local> = Vec::new();
            for &p in roofs.iter().flatten() {
                if distance(a, b, p) < EPSILON && !tops.iter().any(|t| close(*t, p)) {
                    tops.push(p);
                }
            }
            outline(a, b, 0.0, tops)
        })
        .collect()
}

/// The side from `a` to `b` at `height`, closed by `rest` from the end near `b` back to `a`.
fn outline(a: [f64; 2], b: [f64; 2], height: f64, mut rest: Vec<Local>) -> Vec<Local> {
    rest.sort_by(|p, q| along(a, b, *q).total_cmp(&along(a, b, *p)));
    let [[au, aw], [bu, bw]] = [a, b];
    let mut polygon = vec![[au, height, aw], [bu, height, bw]];
    polygon.extend(rest);
    polygon
}

/// How far along the side from `a` to `b` the point stands, in its length.
fn along([au, aw]: [f64; 2], [bu, bw]: [f64; 2], [u, _, w]: Local) -> f64 {
    (u - au).mul_add(bu - au, (w - aw) * (bw - aw))
}

/// The point's horizontal distance from the line through the side.
fn distance([au, aw]: [f64; 2], [bu, bw]: [f64; 2], [u, _, w]: Local) -> f64 {
    let (du, dw) = (bu - au, bw - aw);
    du.mul_add(w - aw, -(dw * (u - au))).abs() / du.hypot(dw)
}

fn close(a: Local, b: Local) -> bool {
    a.iter().zip(b).all(|(a, b)| (a - b).abs() < EPSILON)
}
