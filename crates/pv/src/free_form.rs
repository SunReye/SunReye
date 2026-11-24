//! Free-form roofs (ADR 20): a block on a polygon footprint under flat faces given by their
//! corners, drawn by hand or taken from a surveyed building model.

use serde::{Deserialize, Serialize};

use crate::Point;
use crate::grid::TOLERANCE;
use crate::polygon::{self, Plan, overlap, simple};
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
    /// The lines a traced roof's faces are derived from; none for faces entered as they are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traced: Option<Traced>,
}

/// A traced roof's source (ADR 20): its points and lines, and the points each face's corners are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Traced {
    /// Each point as x, y and z, in metres; y is its height now.
    pub points: Vec<[f64; 3]>,
    /// The points whose height was set, by the person or by a surface: no pull changes it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub set: Vec<usize>,
    /// Each line's two points.
    pub lines: Vec<[usize; 2]>,
    /// For each face, in the order of the faces, the points its corners are.
    pub faces: Vec<Vec<usize>>,
    /// The points the person made eaves: a pull of the eaves raises them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub eaves: Vec<usize>,
    /// The points the person made ridges: a pull of the ridges raises them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ridges: Vec<usize>,
}

/// Metres a corner may lie off its face's plane (ADR 20).
pub const FLATNESS: f64 = 0.02;

impl FreeForm {
    /// Whether its footprint is a polygon and every face flat, simple, facing up and over it.
    /// A traced roof whose faces make no single outline yet has no footprint, and its faces then
    /// stand over none.
    pub(crate) fn valid(&self) -> bool {
        let unwalled = self.footprint.is_empty() && self.traced.is_some();
        (unwalled || simple(&self.footprint))
            && self.faces.iter().all(|face| self.holds(face, unwalled))
            && self
                .traced
                .as_ref()
                .is_none_or(|traced| traced.names(&self.faces))
    }

    /// Whether face `face` is a traced one bent off its plane: it carries no modules (ADR 20).
    pub(crate) fn bent(&self, face: usize) -> bool {
        self.traced.is_some() && self.faces.get(face).is_some_and(|corners| !flat(corners))
    }

    fn holds(&self, face: &[[f64; 3]], unwalled: bool) -> bool {
        let plan: Vec<Plan> = face.iter().map(|&[x, _, z]| [x, z]).collect();
        // A traced face may be bent while its heights are being given (ADR 20).
        let flat = self.traced.is_some() || flat(face);
        facing(face).is_some()
            && simple(&plan)
            && flat
            && (unwalled || overlap(&plan, &self.footprint))
    }
}

/// Whether no corner lies more than `FLATNESS` off the plane through the corners' mean square to
/// their Newell normal.
fn flat(face: &[[f64; 3]]) -> bool {
    let Some(normal) = facing(face) else {
        return false;
    };
    let count = f64::from(u32::try_from(face.len()).unwrap_or(u32::MAX));
    let mean = face.iter().fold([0.0; 3], |[x, y, z], [px, py, pz]| {
        [x + px / count, y + py / count, z + pz / count]
    });
    face.iter()
        .all(|&p| dot(sub(p, mean), normal).abs() <= FLATNESS)
}

impl Traced {
    /// Whether every line joins two of its points, every set, eave and ridge point is one, and each of `faces`
    /// has its corners at the points it names.
    fn names(&self, faces: &[Vec<[f64; 3]>]) -> bool {
        let count = self.points.len();
        let lines = self
            .lines
            .iter()
            .all(|&[a, b]| a != b && a < count && b < count);
        let at = |corner: [f64; 3], point: usize| {
            self.points.get(point).is_some_and(|&p| near(p, corner))
        };
        let named = self.faces.len() == faces.len()
            && self.faces.iter().zip(faces).all(|(points, corners)| {
                points.len() == corners.len() && points.iter().zip(corners).all(|(&p, &c)| at(c, p))
            });
        let points = |list: &[usize]| list.iter().all(|&p| p < count);
        lines && named && points(&self.set) && points(&self.eaves) && points(&self.ridges)
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

impl FreeForm {
    /// The wall under each side of the footprint, up to the faces above it and stepping where
    /// they step; along a stretch no face stands over, it has no height, and a side with none
    /// has no wall. Then each dormer's walls.
    pub(crate) fn walls(&self) -> Vec<Vec<[f64; 3]>> {
        polygon::edges(&self.footprint)
            .map(|side| self.wall(side))
            .filter(|wall| wall.iter().any(|&[_, up, _]| up > TOLERANCE))
            .chain(self.cheeks())
            .collect()
    }

    /// For each face, the face it stands on seen from above, as a traced dormer's does (ADR 20):
    /// the smallest larger face holding all its corners, one clear of its edges.
    fn hosts(&self) -> Vec<Option<usize>> {
        let plans: Vec<Vec<Plan>> = self
            .faces
            .iter()
            .map(|face| face.iter().map(|&[x, _, z]| [x, z]).collect())
            .collect();
        let size = plans.iter().map(|plan| polygon::area(plan).abs());
        let holds = |around: &[Plan], plan: &[Plan]| {
            plan.iter().any(|&p| polygon::inside(around, p, TOLERANCE))
                && plan.iter().all(|&p| polygon::inside(around, p, -TOLERANCE))
        };
        let sized: Vec<(&Vec<Plan>, f64)> = plans.iter().zip(size).collect();
        sized
            .iter()
            .map(|&(plan, small)| {
                sized
                    .iter()
                    .enumerate()
                    .filter(|&(_, &(around, large))| {
                        large > small && self.traced.is_some() && holds(around, plan)
                    })
                    .min_by(|(_, (_, p)), (_, (_, q))| p.total_cmp(q))
                    .map(|(f, _)| f)
            })
            .collect()
    }

    /// The corners of the faces of the dormers standing on face `face`: its cuts.
    pub(crate) fn cuts(&self, face: usize) -> Vec<Vec<[f64; 3]>> {
        self.hosts()
            .into_iter()
            .zip(&self.faces)
            .filter(|(host, _)| *host == Some(face))
            .map(|(_, corners)| corners.clone())
            .collect()
    }

    /// Each dormer's walls: under every edge of its outline, from the face it stands on up to its
    /// own face, where that stands higher.
    fn cheeks(&self) -> Vec<Vec<[f64; 3]>> {
        let hosts = self.hosts();
        let raised: Vec<(usize, &Vec<[f64; 3]>)> = hosts
            .iter()
            .zip(&self.faces)
            .filter_map(|(host, face)| host.map(|host| (host, face)))
            .collect();
        let shared = |a: [f64; 3], b: [f64; 3]| {
            raised
                .iter()
                .flat_map(|(_, face)| edges3(face))
                .filter(|&(p, q)| near(p, b) && near(q, a))
                .count()
                > 0
        };
        raised
            .iter()
            .flat_map(|&(host, face)| {
                let under = self.faces.get(host).map_or(&[][..], Vec::as_slice);
                edges3(face)
                    .filter(|&(a, b)| !shared(a, b))
                    .map(move |(a, b)| {
                        let foot = |[x, _, z]: [f64; 3]| [x, level(under, [x, z]), z];
                        vec![foot(a), foot(b), b, a]
                    })
                    .collect::<Vec<_>>()
            })
            // A wall's top corners stand over its feet; one the dormer meets its face along has none.
            .filter(|wall| {
                wall.iter()
                    .zip(wall.iter().rev())
                    .any(|(foot, top)| top[1] - foot[1] > TOLERANCE)
            })
            .map(|mut wall| {
                wall.dedup_by(|p, q| near(*p, *q));
                if wall
                    .first()
                    .zip(wall.last())
                    .is_some_and(|(p, q)| near(*p, *q))
                {
                    wall.pop();
                }
                wall
            })
            .collect()
    }

    fn wall(&self, (a, b): (Plan, Plan)) -> Vec<[f64; 3]> {
        let at = |t: f64| {
            [
                (b[0] - a[0]).mul_add(t, a[0]),
                (b[1] - a[1]).mul_add(t, a[1]),
            ]
        };
        let steps = self.steps((a, b));
        // From the end back to the start, each stretch under the face over its middle.
        let top = steps.windows(2).rev().flat_map(|pair| {
            let (from, to) = match *pair {
                [from, to] => (from, to),
                _ => (0.0, 0.0),
            };
            let face = self.over(at(f64::midpoint(from, to)));
            [to, from].map(|t| {
                let [x, z] = at(t);
                [x, face.map_or(0.0, |face| level(face, [x, z])), z]
            })
        });
        let mut wall = vec![[a[0], 0.0, a[1]], [b[0], 0.0, b[1]]];
        wall.extend(top);
        wall.dedup_by(|p, q| near(*p, *q));
        if wall.len() > 1
            && wall
                .first()
                .zip(wall.last())
                .is_some_and(|(p, q)| near(*p, *q))
        {
            wall.pop();
        }
        wall
    }

    /// How far along the side, in its length, a face's edge meets it, from 0 to 1.
    fn steps(&self, side: (Plan, Plan)) -> Vec<f64> {
        let mut steps: Vec<f64> = self
            .faces
            .iter()
            .flat_map(|face| {
                let plan: Vec<Plan> = face.iter().map(|&[x, _, z]| [x, z]).collect();
                let crossings: Vec<f64> = polygon::edges(&plan)
                    .filter_map(|edge| polygon::crossing(side, edge))
                    .collect();
                crossings
            })
            .chain([0.0, 1.0])
            .collect();
        steps.sort_by(f64::total_cmp);
        steps.dedup_by(|p, q| (*p - *q).abs() < EPSILON);
        steps
    }

    /// The height of the faces over a point of the plan: the highest that stands there.
    pub(crate) fn height(&self, point: Plan) -> f64 {
        self.over(point).map_or(0.0, |face| level(face, point))
    }

    /// The highest face standing over a point of the plan, its edges included.
    fn over(&self, point: Plan) -> Option<&[[f64; 3]]> {
        self.faces
            .iter()
            .filter(|face| {
                let plan: Vec<Plan> = face.iter().map(|&[x, _, z]| [x, z]).collect();
                polygon::inside(&plan, point, -TOLERANCE)
            })
            .map(Vec::as_slice)
            .max_by(|p, q| level(p, point).total_cmp(&level(q, point)))
    }
}

/// The height of a face's plane over a point of the plan.
fn level(face: &[[f64; 3]], [x, z]: Plan) -> f64 {
    let Some(normal) = facing(face) else {
        return 0.0;
    };
    let count = f64::from(u32::try_from(face.len()).unwrap_or(u32::MAX));
    let [cx, cy, cz] = face.iter().fold([0.0; 3], |[sx, sy, sz], [px, py, pz]| {
        [sx + px / count, sy + py / count, sz + pz / count]
    });
    let [nx, ny, nz] = normal;
    cy - nx.mul_add(x - cx, nz * (z - cz)) / ny
}

fn near(a: [f64; 3], b: [f64; 3]) -> bool {
    a.iter().zip(b).all(|(p, q)| (p - q).abs() < TOLERANCE)
}

/// Each edge of a face, corner to corner, the last back to the first.
fn edges3(face: &[[f64; 3]]) -> impl Iterator<Item = ([f64; 3], [f64; 3])> + '_ {
    face.iter()
        .copied()
        .zip(face.iter().cycle().skip(1).copied())
}
