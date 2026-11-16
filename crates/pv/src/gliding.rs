//! What the builder drags along a roof face (ADR 20 Editing): a chimney or a roof window follows
//! the pointer's level move in 10 cm steps, stopped where it no longer fits and sliding on.

use crate::RoofFace;
use crate::fitting::snap;

/// Metres: the steps a dragged chimney or roof window moves in along its face.
const STEP: f64 = 0.1;

/// The halvings that find where a drag stops.
const HALVINGS: u8 = 40;

/// A level move of `east` and `north` metres as across and up `face`, seen from above.
pub fn along(face: &RoofFace, [east, north]: [f64; 2]) -> [f64; 2] {
    let [across_east, across_north, _] = face.across;
    let [up_east, up_north, _] = face.up;
    let level = up_east.hypot(up_north);
    let per_metre = if level > 0.0 { level * level } else { 1.0 };
    [
        east.mul_add(across_east, north * across_north),
        east.mul_add(up_east, north * up_north) / per_metre,
    ]
}

/// The furthest from `from`, where it fits, toward `to` that it still fits.
fn furthest(from: [f64; 2], to: [f64; 2], fits: impl Fn([f64; 2]) -> bool) -> [f64; 2] {
    let between = |share: f64| {
        [
            (to[0] - from[0]).mul_add(share, from[0]),
            (to[1] - from[1]).mul_add(share, from[1]),
        ]
    };
    if fits(to) {
        return to;
    }
    let (reached, _) = (0..HALVINGS).fold((0.0, 1.0), |(low, high), _| {
        let mid = f64::midpoint(low, high);
        if fits(between(mid)) {
            (mid, high)
        } else {
            (low, mid)
        }
    });
    between(reached)
}

/// A centre at `from` on `face` moved by a level `east` and `north` metres, seen from above: in
/// 10 cm steps, stopped where it no longer `fits` and sliding along that. One that does not fit
/// where it is goes where it is moved.
pub fn glided(
    face: &RoofFace,
    from: [f64; 2],
    shift: [f64; 2],
    fits: impl Fn([f64; 2]) -> bool,
) -> [f64; 2] {
    let [across, up] = along(face, shift);
    let wanted = [snap(from[0] + across, STEP), snap(from[1] + up, STEP)];
    if !fits(from) {
        return wanted;
    }
    let straight = furthest(from, wanted, &fits);
    let sideways = furthest(straight, [wanted[0], straight[1]], &fits);
    furthest(sideways, [sideways[0], wanted[1]], &fits)
}
