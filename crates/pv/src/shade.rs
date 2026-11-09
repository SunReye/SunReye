//! Beam shade on a placed module's bypass-diode substrings (ADR 20).

use crate::{ModuleType, Occluder, Place, Plane, Point, Sun};

/// Sample points per substring: across its strip, and along the module's long side.
const ACROSS: u32 = 3;
const ALONG: u32 = 9;
/// Metres a ray travels before it counts, so a module's own roof never shades it.
const CLEARANCE: f64 = 1e-6;

/// How many of the module's substrings lose their beam. A substring with any shaded sample is
/// shaded, since its most shaded cell limits its current.
pub fn shaded_substrings(
    module: &ModuleType,
    plane: Plane,
    at: Place,
    sun: Sun,
    occluders: &[Occluder],
) -> u8 {
    if occluders.is_empty() {
        return 0;
    }
    let toward_sun = direction(sun);
    let (tilt, azimuth) = (plane.tilt.to_radians(), plane.azimuth.to_radians());
    let up_slope = [
        azimuth.sin() * tilt.cos(),
        azimuth.cos() * tilt.cos(),
        tilt.sin(),
    ];
    let across_slope = [azimuth.cos(), -azimuth.sin(), 0.0];
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
                occluders.iter().any(|o| blocks(o, origin, toward_sun))
            })
        })
        .count();
    u8::try_from(shaded).unwrap_or(parts)
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
        Occluder::Triangle(corners) => triangle(origin, ray, corners),
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
    }
}

/// Möller and Trumbore 1997.
fn triangle(origin: Point, ray: Point, [first, second, third]: [Point; 3]) -> bool {
    let (edge, other) = (sub(second, first), sub(third, first));
    let normal = cross(ray, other);
    let det = dot(edge, normal);
    if det.abs() < 1e-12 {
        return false;
    }
    let to = sub(origin, first);
    let u = dot(to, normal) / det;
    let turned = cross(to, edge);
    let v = dot(ray, turned) / det;
    let distance = dot(other, turned) / det;
    (0.0..=1.0).contains(&u) && v >= 0.0 && u + v <= 1.0 && distance > CLEARANCE
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
