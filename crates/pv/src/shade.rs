//! Beam shade on a placed module's bypass-diode substrings (ADR 20).

use crate::{ModuleType, Occluder, Place, Plane, Point, Sun};

/// Sample points per substring, edge to edge: across its strip, and along the module's long side.
const ACROSS: u32 = 3;
const ALONG: u32 = 9;
/// Samples per substring.
const SAMPLES: usize = (ACROSS * ALONG) as usize;
/// What the samples weigh, as the trapezoid rule over the substring: a node's share of the
/// substring's sky closed is the shaded samples' weight over this.
pub const WHOLE: u8 = 4 * 16;
/// Metres the samples on a substring's edge stand inside it, so a shadow that ends on the line
/// between two substrings takes only the one it covers.
const INSET: f64 = 1e-4;
/// Metres a ray travels before it counts, so a module's own roof never shades it.
const CLEARANCE: f64 = 1e-6;

/// Slack on the bounds that rule a caster out for a module, in metres and of 1: a caster a
/// rounding error out of reach is still tested.
const SLACK: f64 = 1e-9;
/// The cosine of incidence from which a module's own plane rules casters out; below it a ray
/// gains too little height per metre to tell the plane from what lies in it.
const FACING: f64 = 1e-4;
/// Minimum height above a module's plane that can shade it when `facing >= FACING`.
const MIN_ABOVE: f64 = CLEARANCE * FACING / 2.0;

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
    Triangle(Triangle),
    /// About the caster's centre.
    Sphere {
        radius: f64,
    },
    Cylinder {
        base: Point,
        radius: f64,
        height: f64,
    },
    Cone {
        base: Point,
        radius: f64,
        height: f64,
    },
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
    #[cfg(test)]
    pub fn shaded_substrings(&self, module: &ModuleType, plane: Plane, at: Place) -> u8 {
        self.shaded(module, plane, at, true)
    }

    /// The same with every sample tested against every caster: what ruling casters out must
    /// never change.
    #[cfg(test)]
    pub fn shaded_exhaustively(&self, module: &ModuleType, plane: Plane, at: Place) -> u8 {
        self.shaded(module, plane, at, false)
    }

    /// Marks each of the module's substrings, `parts` of them in `shaded`, that loses its beam.
    pub fn mark(&self, module: &ModuleType, plane: Plane, at: Place, shaded: &mut [bool]) {
        for part in self.shaded_parts(module, plane, at, true) {
            if let Some(mark) = shaded.get_mut(usize::from(part)) {
                *mark = true;
            }
        }
    }

    /// Writes how much of each of the module's substrings, `parts` of them in `covered`, lies in
    /// shade, in samples weighed to `WHOLE`: a substring loses its beam at any, and takes the
    /// share in its view of the sky.
    pub fn cover(&self, module: &ModuleType, plane: Plane, at: Place, covered: &mut [u8]) {
        let sampler = Sampler::new(self, module, plane, at, true);
        for (part, covered) in (0..sampler.parts).zip(covered.iter_mut()) {
            *covered = sampler
                .samples(part)
                .filter(|&(_, shaded)| shaded)
                .map(|(weight, _)| weight)
                .sum();
        }
    }

    #[cfg(test)]
    fn shaded(&self, module: &ModuleType, plane: Plane, at: Place, rule_out: bool) -> u8 {
        let shaded = self.shaded_parts(module, plane, at, rule_out).count();
        u8::try_from(shaded).unwrap_or(u8::MAX)
    }

    /// Each of the module's substrings that loses its beam.
    fn shaded_parts<'a>(
        &'a self,
        module: &'a ModuleType,
        plane: Plane,
        at: Place,
        rule_out: bool,
    ) -> impl Iterator<Item = u8> + 'a {
        let sampler = Sampler::new(self, module, plane, at, rule_out);
        (0..sampler.parts).filter(move |&part| sampler.samples(part).any(|(_, shaded)| shaded))
    }
}

/// One module's samples under one sun, against the casters that can reach it.
struct Sampler<'a> {
    module: &'a ModuleType,
    toward_sun: Point,
    centre: Point,
    near: Vec<&'a Caster>,
    long: Point,
    short: Point,
    /// Its substrings; none when no caster can reach it.
    parts: u8,
}

impl<'a> Sampler<'a> {
    fn new(
        casters: &'a Casters,
        module: &'a ModuleType,
        plane: Plane,
        at: Place,
        rule_out: bool,
    ) -> Self {
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
        let near: Vec<&Caster> = casters
            .casters
            .iter()
            .filter(|c| !rule_out || c.reaches(&face, casters.toward_sun))
            .collect();
        // Substrings are strips along the long side, side by side across the short side.
        let (long, short) = if at.landscape {
            (across_slope, up_slope)
        } else {
            (up_slope, across_slope)
        };
        let parts = if near.is_empty() {
            0
        } else {
            module.bypass_diodes.max(1)
        };
        Self {
            module,
            toward_sun: casters.toward_sun,
            centre: at.centre,
            near,
            long,
            short,
            parts,
        }
    }

    /// Each of the `part`th substring's samples: its weight, and whether it lies in shade.
    fn samples(&self, part: u8) -> impl Iterator<Item = (u8, bool)> + '_ {
        samples(self.module, self.parts, part).map(move |(s, l, weight)| {
            let origin = offset(offset(self.centre, self.short, s), self.long, l);
            let shaded = self.near.iter().any(|c| c.blocks(origin, self.toward_sun));
            (weight, shaded)
        })
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
        let upright = |base: Point, radius: f64, height: f64, shape: Shape| Self {
            centre: offset(base, [0.0, 0.0, 1.0], height / 2.0),
            radius: radius.hypot(height / 2.0),
            shape,
        };
        Some(match *occluder {
            Occluder::Triangle(corners) => {
                let [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = corners;
                let centre = [
                    (ax + bx + cx) / 3.0,
                    (ay + by + cy) / 3.0,
                    (az + bz + cz) / 3.0,
                ];
                let far = corners.map(|p| dot(sub(p, centre), sub(p, centre)));
                Self {
                    centre,
                    radius: far.into_iter().fold(0.0, f64::max).sqrt(),
                    shape: Shape::Triangle(Triangle::new(ray, corners)?),
                }
            }
            Occluder::Sphere { centre, radius } => Self {
                centre,
                radius: radius.abs(),
                shape: Shape::Sphere { radius },
            },
            Occluder::Cylinder {
                base,
                radius,
                height,
            } => {
                let shape = Shape::Cylinder {
                    base,
                    radius,
                    height,
                };
                upright(base, radius, height, shape)
            }
            Occluder::Cone {
                base,
                radius,
                height,
            } => {
                let shape = Shape::Cone {
                    base,
                    radius,
                    height,
                };
                upright(base, radius, height, shape)
            }
        })
    }

    /// Whether a ray toward the sun, `ray`, from any of the module's samples could meet it
    /// (ignoring the module's own plane check).
    fn coverage(&self, face: &Face, ray: Point) -> Coverage {
        match &self.shape {
            Shape::Triangle(triangle) => triangle.coverage(face),
            Shape::Sphere { .. } | Shape::Cylinder { .. } | Shape::Cone { .. } => {
                let to = sub(self.centre, face.centre);
                let along = dot(to, ray);
                let apart = (self.radius + face.reach).mul_add(1.0 + SLACK, SLACK);
                if along >= -apart && along.mul_add(-along, dot(to, to)) <= apart * apart {
                    Coverage::Partial
                } else {
                    Coverage::None
                }
            }
        }
    }

    /// Whether a ray toward the sun, `ray`, from any of the module's samples could meet it. It
    /// cannot when the caster lies behind the module along the ray, beside the rays, or on or
    /// behind the module's own plane.
    fn reaches(&self, face: &Face, ray: Point) -> bool {
        if matches!(self.coverage(face, ray), Coverage::None) {
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
            Shape::Sphere { .. } | Shape::Cylinder { .. } | Shape::Cone { .. } => {
                dot(sub(self.centre, face.centre), face.normal) + self.radius
            }
        };
        above > CLEARANCE * facing / 2.0
    }

    /// Whether the ray from `origin` toward the sun, `ray`, meets it.
    fn blocks(&self, origin: Point, ray: Point) -> bool {
        match self.shape {
            Shape::Triangle(ref triangle) => triangle.blocks(origin),
            Shape::Sphere { radius } => {
                let to = sub(origin, self.centre);
                let b = dot(ray, to);
                let discriminant = b.mul_add(b, radius.mul_add(radius, -dot(to, to)));
                discriminant >= 0.0 && discriminant.sqrt() - b > CLEARANCE
            }
            Shape::Cylinder {
                base,
                radius,
                height,
            } => cylinder(sub(origin, base), ray, radius, height),
            Shape::Cone {
                base,
                radius,
                height,
            } => cone(sub(origin, base), ray, radius, height),
        }
    }
}

/// Offsets in metres along the short and the long side of one substring's sample points, and
/// each one's weight: edge to edge, so a shadow on a substring's edge takes its beam (#889).
fn samples(module: &ModuleType, parts: u8, part: u8) -> impl Iterator<Item = (f64, f64, u8)> + '_ {
    let strip = module.width / f64::from(parts);
    let start = strip.mul_add(f64::from(part), -module.width / 2.0);
    // The trapezoid rule's weights: the end points count half.
    let spread = |k: u32, n: u32, length: f64| {
        let at = length * f64::from(k) / f64::from(n - 1);
        match k {
            0 => (INSET, 1),
            _ if k + 1 == n => (at - INSET, 1),
            _ => (at, 2),
        }
    };
    (0..ACROSS).flat_map(move |a| {
        let (s, across) = spread(a, ACROSS, strip);
        (0..ALONG).map(move |b| {
            let (l, along) = spread(b, ALONG, module.height);
            (start + s, l - module.height / 2.0, across * along)
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

/// How much of a module's bounding ball a caster covers along one ray direction.
#[derive(Clone, Copy)]
enum Coverage {
    None,
    Partial,
    Full,
}

fn scale(p: Point, s: f64) -> Point {
    [p[0] * s, p[1] * s, p[2] * s]
}

fn norm(p: Point) -> f64 {
    dot(p, p).sqrt()
}

/// A triangle under one ray direction, by Möller and Trumbore 1997: `u`, `v` and `t` are each
/// linear in the ray origin, so one dot product per axis tests a sample or culls a whole module.
struct Triangle {
    corners: [Point; 3],
    first: Point,
    vec_u: Point,
    vec_v: Point,
    vec_t: Point,
    len_u: f64,
    len_v: f64,
    len_uv: f64,
    len_t: f64,
}

impl Triangle {
    /// `None` edge-on to the ray, where nothing is blocked.
    fn new(ray: Point, corners: [Point; 3]) -> Option<Self> {
        let [first, second, third] = corners;
        let (edge, other) = (sub(second, first), sub(third, first));
        Self::from_prepared(ray, corners, edge, other, cross(edge, other))
    }

    fn from_prepared(
        ray: Point,
        corners: [Point; 3],
        edge: Point,
        other: Point,
        tri_normal: Point,
    ) -> Option<Self> {
        let normal = cross(ray, other);
        let det = dot(edge, normal);
        if det.abs() < 1e-12 {
            return None;
        }
        let inv = 1.0 / det;
        let vec_u = scale(normal, inv);
        let vec_v = scale(cross(edge, ray), inv);
        let vec_t = scale(tri_normal, inv);
        let uv = [
            vec_u[0] + vec_v[0],
            vec_u[1] + vec_v[1],
            vec_u[2] + vec_v[2],
        ];
        Some(Self {
            corners,
            first: corners[0],
            vec_u,
            vec_v,
            vec_t,
            len_u: norm(vec_u),
            len_v: norm(vec_v),
            len_uv: norm(uv),
            len_t: norm(vec_t),
        })
    }

    /// Exact conservative test of the module's bounding ball against the triangle's extruded prism.
    fn coverage(&self, face: &Face) -> Coverage {
        let r = face.reach.mul_add(1.0 + SLACK, SLACK);
        let to = sub(face.centre, self.first);
        let t = dot(to, self.vec_t);
        let dt = r * self.len_t;
        if t + dt <= CLEARANCE {
            return Coverage::None;
        }
        let u = dot(to, self.vec_u);
        let du = r * self.len_u;
        if u + du < 0.0 || u - du > 1.0 {
            return Coverage::None;
        }
        let v = dot(to, self.vec_v);
        let dv = r * self.len_v;
        if v + dv < 0.0 || v - dv > 1.0 {
            return Coverage::None;
        }
        let uv = u + v;
        let duv = r * self.len_uv;
        if uv - duv > 1.0 {
            return Coverage::None;
        }
        if t - dt > CLEARANCE && u - du >= 0.0 && v - dv >= 0.0 && uv + duv <= 1.0 {
            return Coverage::Full;
        }
        Coverage::Partial
    }

    fn blocks(&self, origin: Point) -> bool {
        let to = sub(origin, self.first);
        let u = dot(to, self.vec_u);
        if !(0.0..=1.0).contains(&u) {
            return false;
        }
        let v = dot(to, self.vec_v);
        v >= 0.0 && u + v <= 1.0 && dot(to, self.vec_t) > CLEARANCE
    }
}

/// An occluder's sun-independent bounding ball and triangle edges, prepared once for a full sky
/// grid trace.
struct PreparedOccluder {
    centre: Point,
    radius: f64,
    shape: PreparedShape,
}

enum PreparedShape {
    Triangle {
        corners: [Point; 3],
        edge: Point,
        other: Point,
        tri_normal: Point,
    },
    Sphere {
        radius: f64,
    },
    Cylinder {
        base: Point,
        radius: f64,
        height: f64,
    },
    Cone {
        base: Point,
        radius: f64,
        height: f64,
    },
}

impl PreparedOccluder {
    fn new(occluder: &Occluder) -> Self {
        match *occluder {
            Occluder::Triangle(corners) => Self::triangle(corners),
            Occluder::Sphere { centre, radius } => Self {
                centre,
                radius: radius.abs(),
                shape: PreparedShape::Sphere { radius },
            },
            Occluder::Cylinder {
                base,
                radius,
                height,
            } => Self::upright(
                base,
                radius,
                height,
                PreparedShape::Cylinder {
                    base,
                    radius,
                    height,
                },
            ),
            Occluder::Cone {
                base,
                radius,
                height,
            } => Self::upright(
                base,
                radius,
                height,
                PreparedShape::Cone {
                    base,
                    radius,
                    height,
                },
            ),
        }
    }

    fn triangle(corners: [Point; 3]) -> Self {
        let [first, second, third] = corners;
        let centre = [
            (first[0] + second[0] + third[0]) / 3.0,
            (first[1] + second[1] + third[1]) / 3.0,
            (first[2] + second[2] + third[2]) / 3.0,
        ];
        let far = corners.map(|p| dot(sub(p, centre), sub(p, centre)));
        let (edge, other) = (sub(second, first), sub(third, first));
        Self {
            centre,
            radius: far.into_iter().fold(0.0, f64::max).sqrt(),
            shape: PreparedShape::Triangle {
                corners,
                edge,
                other,
                tri_normal: cross(edge, other),
            },
        }
    }

    fn upright(base: Point, radius: f64, height: f64, shape: PreparedShape) -> Self {
        Self {
            centre: offset(base, [0.0, 0.0, 1.0], height / 2.0),
            radius: radius.hypot(height / 2.0),
            shape,
        }
    }

    fn above(&self, face: &Face) -> f64 {
        match &self.shape {
            PreparedShape::Triangle { corners, .. } => corners
                .map(|p| dot(sub(p, face.centre), face.normal))
                .into_iter()
                .fold(f64::MIN, f64::max),
            PreparedShape::Sphere { .. }
            | PreparedShape::Cylinder { .. }
            | PreparedShape::Cone { .. } => {
                dot(sub(self.centre, face.centre), face.normal) + self.radius
            }
        }
    }

    fn under(&self, ray: Point) -> Option<Caster> {
        let shape = match self.shape {
            PreparedShape::Triangle {
                corners,
                edge,
                other,
                tri_normal,
            } => Shape::Triangle(Triangle::from_prepared(
                ray, corners, edge, other, tri_normal,
            )?),
            PreparedShape::Sphere { radius } => Shape::Sphere { radius },
            PreparedShape::Cylinder {
                base,
                radius,
                height,
            } => Shape::Cylinder {
                base,
                radius,
                height,
            },
            PreparedShape::Cone {
                base,
                radius,
                height,
            } => Shape::Cone {
                base,
                radius,
                height,
            },
        };
        Some(Caster {
            centre: self.centre,
            radius: self.radius,
            shape,
        })
    }
}

/// One placed module's sun-independent geometry, sample points, and occluders rising above its
/// plane.
struct PreparedModule {
    face: Face,
    /// Sample points `(origin, weight)`, `SAMPLES` per substring in order.
    samples: Vec<(Point, u8)>,
    /// `(occluder_index, above_plane)` for every occluder with `above > MIN_ABOVE`.
    above: Vec<(usize, f64)>,
}

impl PreparedModule {
    fn new(
        module_type: &ModuleType,
        plane: Plane,
        at: Place,
        occluders: &[PreparedOccluder],
    ) -> Self {
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
            reach: module_type.width.hypot(module_type.height) / 2.0,
        };
        let (long, short) = if at.landscape {
            (across_slope, up_slope)
        } else {
            (up_slope, across_slope)
        };
        let parts = module_type.bypass_diodes.max(1);
        let mut pts = Vec::with_capacity(usize::from(parts) * SAMPLES);
        for part in 0..parts {
            for (s, l, weight) in samples(module_type, parts, part) {
                let origin = offset(offset(at.centre, short, s), long, l);
                pts.push((origin, weight));
            }
        }
        let above = occluders
            .iter()
            .enumerate()
            .filter_map(|(i, o)| {
                let h = o.above(&face);
                (h > MIN_ABOVE).then_some((i, h))
            })
            .collect();
        Self {
            face,
            samples: pts,
            above,
        }
    }
}

/// Precomputed scene state for tracing every node of a [`crate::ShadingTable`] without per-node
/// allocations or repeated trig.
pub struct GridTracer {
    occluders: Vec<PreparedOccluder>,
    modules: Vec<(usize, Option<PreparedModule>)>,
    casters: Vec<Option<Caster>>,
    near: Vec<usize>,
}

impl GridTracer {
    pub fn new(modules: &[(&ModuleType, &crate::Module)], occluders: &[Occluder]) -> Self {
        let prepared: Vec<PreparedOccluder> = occluders.iter().map(PreparedOccluder::new).collect();
        let modules = modules
            .iter()
            .map(|&(module_type, module)| {
                let parts = usize::from(module_type.bypass_diodes.max(1));
                let slot = module
                    .place
                    .map(|place| PreparedModule::new(module_type, module.plane, place, &prepared));
                (parts, slot)
            })
            .collect();
        let cap = prepared.len();
        Self {
            occluders: prepared,
            modules,
            casters: Vec::with_capacity(cap),
            near: Vec::with_capacity(cap),
        }
    }

    /// Traces one sky node's row into `row`, reusing internal scratch buffers.
    pub fn mark(&mut self, sun: Sun, row: &mut [u8]) {
        let ray = direction(sun);
        let mut built = false;
        let mut start = 0;
        for i in 0..self.modules.len() {
            let Some((parts, slot)) = self.modules.get(i) else {
                continue;
            };
            let stop = start + *parts;
            let Some(module) = slot else {
                start = stop;
                continue;
            };
            let facing = dot(module.face.normal, ray);
            if facing <= 0.0 || (facing >= FACING && module.above.is_empty()) {
                start = stop;
                continue;
            }
            if !built {
                self.casters.clear();
                self.casters
                    .extend(self.occluders.iter().map(|o| o.under(ray)));
                built = true;
            }
            if let Some(shaded) = row.get_mut(start..stop) {
                let full = collect_near(module, facing, ray, &self.casters, &mut self.near);
                cover_near(module, full, ray, (&self.casters, &self.near), shaded);
            }
            start = stop;
        }
    }
}

/// Fills `near` with the indices of casters that may partially cover `module`. Returns `true` if
/// one caster covers the whole module, so every substring is fully shaded.
fn collect_near(
    module: &PreparedModule,
    facing: f64,
    ray: Point,
    casters: &[Option<Caster>],
    near: &mut Vec<usize>,
) -> bool {
    near.clear();
    if facing >= FACING {
        return collect_above(module, CLEARANCE * facing / 2.0, ray, casters, near);
    }
    for (idx, caster) in casters.iter().enumerate() {
        let Some(caster) = caster else { continue };
        match caster.coverage(&module.face, ray) {
            Coverage::Full => return true,
            Coverage::Partial => near.push(idx),
            Coverage::None => {}
        }
    }
    false
}

fn collect_above(
    module: &PreparedModule,
    threshold: f64,
    ray: Point,
    casters: &[Option<Caster>],
    near: &mut Vec<usize>,
) -> bool {
    for &(idx, height) in &module.above {
        if height <= threshold {
            continue;
        }
        let Some(caster) = casters.get(idx).and_then(Option::as_ref) else {
            continue;
        };
        match caster.coverage(&module.face, ray) {
            Coverage::Full => return true,
            Coverage::Partial => near.push(idx),
            Coverage::None => {}
        }
    }
    false
}

fn any_blocks(casters: &[Option<Caster>], near: &[usize], origin: Point, ray: Point) -> bool {
    near.iter().any(|&idx| {
        casters
            .get(idx)
            .and_then(Option::as_ref)
            .is_some_and(|c| c.blocks(origin, ray))
    })
}

fn cover_near(
    module: &PreparedModule,
    full: bool,
    ray: Point,
    (casters, near): (&[Option<Caster>], &[usize]),
    shaded: &mut [u8],
) {
    if full {
        shaded.fill(WHOLE);
        return;
    }
    if near.is_empty() {
        return;
    }
    let (chunks, _) = module.samples.as_chunks::<SAMPLES>();
    for (chunk, out) in chunks.iter().zip(shaded.iter_mut()) {
        *out = chunk
            .iter()
            .filter(|&&(origin, _)| any_blocks(casters, near, origin, ray))
            .map(|&(_, weight)| weight)
            .sum();
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
