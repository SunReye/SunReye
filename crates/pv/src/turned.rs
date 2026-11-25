//! A rectangle turned in a roof face's outline (ADR 20): a chimney's footprint, a roof window's
//! pane. Clockwise seen from above the face, its eave below.

use crate::grid::Area;

/// The corners of the rectangle `half` either side of `centre`, turned `turn` degrees: from its
/// own lower left, counter-clockwise.
pub fn corners([across, up]: [f64; 2], [wide, high]: [f64; 2], turn: f64) -> [[f64; 2]; 4] {
    let (sin, cos) = turn.to_radians().sin_cos();
    [[-wide, -high], [wide, -high], [wide, high], [-wide, high]].map(|[x, y]| {
        [
            x.mul_add(cos, y * sin) + across,
            (-x).mul_add(sin, y * cos) + up,
        ]
    })
}

/// The lower left and upper right of what `corners` cover.
pub fn bounds(corners: &[[f64; 2]; 4]) -> Area {
    let fold = |pick: fn(f64, f64) -> f64, start: f64| {
        corners
            .iter()
            .fold([start; 2], |[x, y], &[cx, cy]| [pick(x, cx), pick(y, cy)])
    };
    [fold(f64::min, f64::MAX), fold(f64::max, f64::MIN)]
}

/// Whether `point` lies in the rectangle `half` either side of `centre`, turned `turn` degrees,
/// widened by `margin` on each axis of its own.
pub fn within(
    [across, up]: [f64; 2],
    [wide, high]: [f64; 2],
    turn: f64,
    [x, y]: [f64; 2],
    [beside, above]: [f64; 2],
) -> bool {
    let (sin, cos) = turn.to_radians().sin_cos();
    let [dx, dy] = [x - across, y - up];
    let [own_x, own_y] = [dx.mul_add(cos, -dy * sin), dx.mul_add(sin, dy * cos)];
    own_x.abs() <= wide + beside && own_y.abs() <= high + above
}

#[expect(
    clippy::trivially_copy_pass_by_ref,
    reason = "serde hands the field by reference"
)]
pub fn is_zero(degrees: &f64) -> bool {
    *degrees == 0.0
}
