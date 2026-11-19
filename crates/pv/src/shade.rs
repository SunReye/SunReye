//! Beam shade on a placed module's bypass-diode substrings (ADR 20).

use crate::{ModuleType, Occluder, Place, Plane, Point, Sun};

/// Sample points per substring: across its strip, and along the module's long side.
const ACROSS: u32 = 3;
const ALONG: u32 = 9;
/// Metres a ray travels before it counts, so a module's own roof never shades it.
const CLEARANCE: f64 = 1e-6;

/// Slack on the bounds that rule a caster out for a module, in metres and of 1: a caster a
/// rounding error out of reach is still tested.
const SLACK: f64 = 1e-9;
/// The cosine of incidence from which a module's own plane rules casters out; below it a ray
/// gains too little height per metre to tell the plane from what lies in it.
const FACING: f64 = 1e-4;

/// What casts beam shade under one sun.
pub struct Casters {
    toward_sun: Point,
    casters: Vec<Caster>,
}

/// An occluder with what the sun's ray fixes of its test, in the ball that holds it.
struct Caster {
    centre: Point,
    radius: f64,
    shape: Shape,
}

enum Shape {
    Triangle(Facing),
    Round(Occluder),
}

impl Casters {
    pub fn under(sun: Sun, occluders: &[Occluder]) -> Self {
        let toward_sun = direction(sun);
        let casters = occluders
            .iter()
            .filter_map(|occluder| Caster::new(toward_sun, occluder));
        Self {
            toward_sun,
            casters: casters.collect(),
        }
    }

    /// How many of the module's substrings lose their beam. A substring with any shaded sample
    /// is shaded, since its most shaded cell limits its current.
    pub fn shaded_substrings(&self, module: &ModuleType, plane: Plane, at: Place) -> u8 {
        let (tilt, azimuth) = (plane.tilt.to_radians(), plane.azimuth.to_radians());
        let up_slope = [
            azimuth.sin() * tilt.cos(),
            azimuth.cos() * tilt.cos(),
            tilt.sin(),
        ];
        let across_slope = [azimuth.cos(), -azimuth.sin(), 0.0];
        let face = Face {
            centre: at.centre,
            normal: cross(across_slope, up_slope),
            reach: module.width.hypot(module.height) / 2.0,
        };
        // Most casters cannot shade this module under this sun: each sample tests the rest.
        let near: Vec<&Caster> = self
            .casters
            .iter()
            .filter(|c| c.reaches(&face, self.toward_sun))
            .collect();
        if near.is_empty() {
            return 0;
        }
        // Substrings are strips along the long side, side by side across the short side.
        let (long, short) = if at.landscape {
            (across_slope, up_slope)
        } else {
            (up_slope, across_slope)
        };
        let parts = module.bypass_diodes.max(1);
        let shaded = (0..parts)
            .filter(|&part| {
                samples(module, parts, part).any(|(s, l)| {
                    let origin = offset(offset(at.centre, short, s), long, l);
                    near.iter().any(|c| c.blocks(origin, self.toward_sun))
                })
            })
            .count();
        u8::try_from(shaded).unwrap_or(parts)
    }
}

/// A module as its casters see it: its samples lie in its plane, within `reach` of its centre.
struct Face {
    centre: Point,
    /// Out of its front.
    normal: Point,
    reach: f64,
}

impl Caster {
    /// `None` for a triangle edge-on to the ray, which blocks nothing.
    fn new(ray: Point, occluder: &Occluder) -> Option<Self> {
        let upright = |base: Point, radius: f64, height: f64| {
            let centre = offset(base, [0.0, 0.0, 1.0], height / 2.0);
            (centre, radius.hypot(height / 2.0))
        };
        let (centre, radius) = match *occluder {
            Occluder::Triangle(corners) => {
                let [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = corners;
                let centre = [
                    (ax + bx + cx) / 3.0,
                    (ay + by + cy) / 3.0,
                    (az + bz + cz) / 3.0,
                ];
                let far = corners.map(|p| dot(sub(p, centre), sub(p, centre)));
                (centre, far.into_iter().fold(0.0, f64::max).sqrt())
            }
            Occluder::Sphere { centre, radius } => (centre, radius.abs()),
            Occluder::Cylinder {
                base,
                radius,
                height,
            }
            | Occluder::Cone {
                base,
                radius,
                height,
            } => upright(base, radius, height),
        };
        let shape = match *occluder {
            Occluder::Triangle(corners) => Shape::Triangle(Facing::new(ray, corners)?),
            Occluder::Sphere { .. } | Occluder::Cylinder { .. } | Occluder::Cone { .. } => {
                Shape::Round(*occluder)
            }
        };
        Some(Self {
            centre,
            radius,
            shape,
        })
    }

    /// Whether a ray toward the sun, `ray`, from any of the module's samples could meet it. It
    /// cannot when the caster lies behind the module along the ray, beside the rays, or on or
    /// behind the module's own plane.
    fn reaches(&self, face: &Face, ray: Point) -> bool {
        let to = sub(self.centre, face.centre);
        let along = dot(to, ray);
        let apart = (self.radius + face.reach).mul_add(1.0 + SLACK, SLACK);
        if along < -apart || along.mul_add(-along, dot(to, to)) > apart * apart {
            return false;
        }
        let facing = dot(face.normal, ray);
        if facing < FACING {
            return true;
        }
        // A ray is `facing` above the plane per metre, and counts from CLEARANCE on.
        let above = match &self.shape {
            Shape::Triangle(triangle) => {
                let heights = triangle
                    .corners
                    .map(|p| dot(sub(p, face.centre), face.normal));
                heights.into_iter().fold(f64::MIN, f64::max)
            }
            Shape::Round(_) => dot(to, face.normal) + self.radius,
        };
        above > CLEARANCE * facing / 2.0
    }

    /// Whether the ray from `origin` toward the sun, `ray`, meets it.
    fn blocks(&self, origin: Point, ray: Point) -> bool {
        match &self.shape {
            Shape::Triangle(facing) => facing.blocks(origin, ray),
            Shape::Round(occluder) => blocks(occluder, origin, ray),
        }
    }
}

/// Offsets in metres along the short and the long side of one substring's sample points.
fn samples(module: &ModuleType, parts: u8, part: u8) -> impl Iterator<Item = (f64, f64)> + '_ {
    let strip = module.width / f64::from(parts);
    let start = strip.mul_add(f64::from(part), -module.width / 2.0);
    (0..ACROSS).flat_map(move |a| {
        (0..ALONG).map(move |b| {
            (
                strip.mul_add((f64::from(a) + 0.5) / f64::from(ACROSS), start),
                module.height * ((f64::from(b) + 0.5) / f64::from(ALONG) - 0.5),
            )
        })
    })
}

/// The unit vector toward the sun: east, north, up.
fn direction(sun: Sun) -> Point {
    let (zenith, azimuth) = (sun.zenith.to_radians(), sun.azimuth.to_radians());
    [
        -azimuth.sin() * zenith.sin(),
        -azimuth.cos() * zenith.sin(),
        zenith.cos(),
    ]
}

pub const fn offset(p: Point, along: Point, by: f64) -> Point {
    let [x, y, z] = p;
    let [dx, dy, dz] = along;
    [by.mul_add(dx, x), by.mul_add(dy, y), by.mul_add(dz, z)]
}

pub fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn dot(a: Point, b: Point) -> f64 {
    a[0].mul_add(b[0], a[1].mul_add(b[1], a[2] * b[2]))
}

pub fn cross(a: Point, b: Point) -> Point {
    [
        a[1].mul_add(b[2], -a[2] * b[1]),
        a[2].mul_add(b[0], -a[0] * b[2]),
        a[0].mul_add(b[1], -a[1] * b[0]),
    ]
}

/// Whether the ray from `origin` toward `ray` meets the occluder.
fn blocks(occluder: &Occluder, origin: Point, ray: Point) -> bool {
    match *occluder {
        Occluder::Triangle(corners) => {
            Facing::new(ray, corners).is_some_and(|facing| facing.blocks(origin, ray))
        }
        Occluder::Sphere { centre, radius } => {
            let to = sub(origin, centre);
            let b = dot(ray, to);
            let discriminant = b.mul_add(b, radius.mul_add(radius, -dot(to, to)));
            discriminant >= 0.0 && discriminant.sqrt() - b > CLEARANCE
        }
        Occluder::Cylinder {
            base,
            radius,
            height,
        } => cylinder(sub(origin, base), ray, radius, height),
        Occluder::Cone {
            base,
            radius,
            height,
        } => cone(sub(origin, base), ray, radius, height),
    }
}

/// A triangle under one ray direction, by Möller and Trumbore 1997: what every ray shares.
struct Facing {
    corners: [Point; 3],
    first: Point,
    edge: Point,
    other: Point,
    normal: Point,
    det: f64,
}

impl Facing {
    /// `None` edge-on to the ray, where nothing is blocked.
    fn new(ray: Point, corners: [Point; 3]) -> Option<Self> {
        let [first, second, third] = corners;
        let (edge, other) = (sub(second, first), sub(third, first));
        let normal = cross(ray, other);
        let det = dot(edge, normal);
        (det.abs() >= 1e-12).then_some(Self {
            corners,
            first,
            edge,
            other,
            normal,
            det,
        })
    }

    fn blocks(&self, origin: Point, ray: Point) -> bool {
        let to = sub(origin, self.first);
        let u = dot(to, self.normal) / self.det;
        if !(0.0..=1.0).contains(&u) {
            return false;
        }
        let turned = cross(to, self.edge);
        let v = dot(ray, turned) / self.det;
        let distance = dot(self.other, turned) / self.det;
        v >= 0.0 && u + v <= 1.0 && distance > CLEARANCE
    }
}

/// Metres past which a level ray no longer counts, so its stretch in a slab stays finite.
const FAR: f64 = 1e6;

/// An upright cone standing on the origin of `origin`'s frame, its apex `height` above.
fn cone(origin: Point, ray: Point, radius: f64, height: f64) -> bool {
    let [ox, oy, oz] = origin;
    let [dx, dy, dz] = ray;
    // The stretch of the ray between the base and the apex…
    let (enter, leave) = if dz.abs() < 1e-12 {
        if !(0.0..=height).contains(&oz) {
            return false;
        }
        (CLEARANCE, FAR)
    } else {
        let (bottom, top) = (-oz / dz, (height - oz) / dz);
        (bottom.min(top).max(CLEARANCE), bottom.max(top).min(FAR))
    };
    if enter > leave {
        return false;
    }
    // …where it lies inside the double cone x² + y² ≤ k²(h − z)², which below the apex is this
    // one: f(t) = at² + 2bt + c ≤ 0.
    let (kk, rest) = ((radius / height).powi(2), height - oz);
    let a = (-kk * dz).mul_add(dz, dx.mul_add(dx, dy * dy));
    let b = (kk * rest).mul_add(dz, ox.mul_add(dx, oy * dy));
    let c = (-kk * rest).mul_add(rest, ox.mul_add(ox, oy * oy));
    let inside = |t: f64| a.mul_add(t, 2.0 * b).mul_add(t, c) <= 0.0;
    let vertex = -b / a;
    inside(enter)
        || inside(leave)
        || (a > 0.0 && (enter..=leave).contains(&vertex) && inside(vertex))
}

/// An upright cylinder standing on the origin of `origin`'s frame.
fn cylinder(origin: Point, ray: Point, radius: f64, height: f64) -> bool {
    let [ox, oy, oz] = origin;
    let [dx, dy, dz] = ray;
    // The stretch of the ray inside the infinite cylinder…
    let a = dx.mul_add(dx, dy * dy);
    let b = ox.mul_add(dx, oy * dy);
    let c = ox.mul_add(ox, oy.mul_add(oy, -radius * radius));
    let (mut enter, mut leave) = if a < 1e-12 {
        if c > 0.0 {
            return false;
        }
        (f64::NEG_INFINITY, f64::INFINITY)
    } else {
        let discriminant = b.mul_add(b, -a * c);
        if discriminant < 0.0 {
            return false;
        }
        (
            (-b - discriminant.sqrt()) / a,
            (-b + discriminant.sqrt()) / a,
        )
    };
    // …and between its base and its top.
    if dz.abs() < 1e-12 {
        if !(0.0..=height).contains(&oz) {
            return false;
        }
    } else {
        let (bottom, top) = (-oz / dz, (height - oz) / dz);
        enter = enter.max(bottom.min(top));
        leave = leave.min(bottom.max(top));
    }
    enter <= leave && leave > CLEARANCE
}
