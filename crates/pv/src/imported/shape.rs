//! Outlines on the ground, in metres east and north: their area, what lies inside them, how they
//! are cut to a square, covered by a rectangle and split into triangles.

/// Metres east and north.
pub type Spot = [f64; 2];

/// Square metres under which a triangle or an outline is nothing.
const SLIVER: f64 = 1e-9;

/// Twice the area the corners enclose: positive when they run counter-clockwise seen from above.
fn doubled(outline: &[Spot]) -> f64 {
    edges(outline)
        .map(|([ax, ay], [bx, by])| ax.mul_add(by, -(bx * ay)))
        .sum()
}

pub fn area(outline: &[Spot]) -> f64 {
    doubled(outline).abs() / 2.0
}

/// Each side, corner to corner, the last back to the first.
pub fn edges(outline: &[Spot]) -> impl Iterator<Item = (Spot, Spot)> + '_ {
    outline
        .iter()
        .copied()
        .zip(outline.iter().copied().cycle().skip(1))
}

/// The outline running counter-clockwise seen from above.
pub fn counter_clockwise(mut outline: Vec<Spot>) -> Vec<Spot> {
    if doubled(&outline) < 0.0 {
        outline.reverse();
    }
    outline
}

/// The mean of the corners.
pub fn centre(outline: &[Spot]) -> Spot {
    let count = f64::from(u32::try_from(outline.len().max(1)).unwrap_or(u32::MAX));
    let [east, north] = outline
        .iter()
        .fold([0.0, 0.0], |[e, n], [x, y]| [e + x, n + y]);
    [east / count, north / count]
}

/// Whether the outline encloses the spot: a ray toward the east crosses it an odd number of
/// times.
pub fn encloses(outline: &[Spot], [x, y]: Spot) -> bool {
    edges(outline)
        .filter(|([ax, ay], [bx, by])| {
            (*ay > y) != (*by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax
        })
        .count()
        % 2
        == 1
}

/// Whether two outlines share ground: a corner of one inside the other, or two sides crossing.
pub fn overlap(a: &[Spot], b: &[Spot]) -> bool {
    a.iter().any(|p| encloses(b, *p))
        || b.iter().any(|p| encloses(a, *p))
        || edges(a).any(|(p, q)| edges(b).any(|(r, s)| crossing(p, q, r, s)))
}

fn crossing(p: Spot, q: Spot, r: Spot, s: Spot) -> bool {
    let side = |[ax, ay]: Spot, [bx, by]: Spot, [cx, cy]: Spot| {
        (bx - ax).mul_add(cy - ay, -((by - ay) * (cx - ax)))
    };
    side(p, q, r) * side(p, q, s) < 0.0 && side(r, s, p) * side(r, s, q) < 0.0
}

/// The smallest rectangle on one of the outline's sides that covers it, counter-clockwise, its
/// first side a long one; `None` for an outline without area.
pub fn rectangle(outline: &[Spot]) -> Option<[Spot; 4]> {
    edges(outline)
        .filter_map(|([ax, ay], [bx, by])| {
            let length = (bx - ax).hypot(by - ay);
            if length < SLIVER {
                return None;
            }
            let along = [(bx - ax) / length, (by - ay) / length];
            let across = [-along[1], along[0]];
            let span = |[ux, uy]: Spot| {
                let at = outline.iter().map(|[x, y]| x.mul_add(ux, y * uy));
                at.fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), v| {
                    (low.min(v), high.max(v))
                })
            };
            let ((u0, u1), (v0, v1)) = (span(along), span(across));
            let corner = |u: f64, v: f64| {
                [
                    u.mul_add(along[0], v * across[0]),
                    u.mul_add(along[1], v * across[1]),
                ]
            };
            let corners = if u1 - u0 >= v1 - v0 {
                [
                    corner(u0, v0),
                    corner(u1, v0),
                    corner(u1, v1),
                    corner(u0, v1),
                ]
            } else {
                [
                    corner(u1, v0),
                    corner(u1, v1),
                    corner(u0, v1),
                    corner(u0, v0),
                ]
            };
            Some(((u1 - u0) * (v1 - v0), corners))
        })
        .filter(|(area, _)| *area > SLIVER)
        .min_by(|(a, _), (b, _)| a.total_cmp(b))
        .map(|(_, corners)| corners)
}

/// The four half-planes of the square reaching `half` from the origin: an axis, and the side
/// kept.
const fn sides(half: f64) -> [(usize, f64, f64); 4] {
    [
        (0, 1.0, half),
        (0, -1.0, half),
        (1, 1.0, half),
        (1, -1.0, half),
    ]
}

/// How far inside a half-plane a spot lies; negative outside.
fn inside(spot: Spot, (axis, sign, half): (usize, f64, f64)) -> f64 {
    let at = if axis == 0 { spot[0] } else { spot[1] };
    sign.mul_add(-at, half)
}

/// Where the side from `a` to `b` leaves the half-plane.
fn cut(a: Spot, b: Spot, side: (usize, f64, f64)) -> Spot {
    let (da, db) = (inside(a, side), inside(b, side));
    let t = da / (da - db);
    [t.mul_add(b[0] - a[0], a[0]), t.mul_add(b[1] - a[1], a[1])]
}

/// The part of a closed outline inside the square reaching `half` from the origin (Sutherland
/// and Hodgman 1974); empty when none is.
pub fn clip_area(outline: &[Spot], half: f64) -> Vec<Spot> {
    sides(half)
        .into_iter()
        .fold(outline.to_vec(), |outline, side| {
            let mut kept = Vec::with_capacity(outline.len() + 4);
            for (a, b) in edges(&outline) {
                let (a_in, b_in) = (inside(a, side) >= 0.0, inside(b, side) >= 0.0);
                if a_in != b_in {
                    kept.push(cut(a, b, side));
                }
                if b_in {
                    kept.push(b);
                }
            }
            kept
        })
}

/// The stretches of a line inside the square reaching `half` from the origin.
pub fn clip_line(points: &[Spot], half: f64) -> Vec<Vec<Spot>> {
    sides(half)
        .into_iter()
        .fold(vec![points.to_vec()], |lines, side| {
            lines
                .iter()
                .flat_map(|line| clip_side(line, side))
                .collect()
        })
}

fn clip_side(line: &[Spot], side: (usize, f64, f64)) -> Vec<Vec<Spot>> {
    let mut stretches = Vec::new();
    let mut open: Vec<Spot> = Vec::new();
    let mut close = |open: &mut Vec<Spot>| {
        if open.len() > 1 {
            stretches.push(std::mem::take(open));
        }
        open.clear();
    };
    for pair in line.windows(2) {
        let &[a, b] = pair else { continue };
        let (a_in, b_in) = (inside(a, side) >= 0.0, inside(b, side) >= 0.0);
        if a_in && open.is_empty() {
            open.push(a);
        }
        match (a_in, b_in) {
            (true, true) => open.push(b),
            (true, false) => {
                open.push(cut(a, b, side));
                close(&mut open);
            }
            (false, true) => {
                open.push(cut(a, b, side));
                open.push(b);
            }
            (false, false) => {}
        }
    }
    close(&mut open);
    stretches
}

/// The outline as triangles of its own corners (ear clipping), for one that need not be convex.
pub fn triangles(outline: &[Spot]) -> Vec<[Spot; 3]> {
    let mut left = counter_clockwise(outline.to_vec());
    let mut out = Vec::with_capacity(left.len().saturating_sub(2));
    while left.len() > 3 {
        let count = left.len();
        let ear = (0..count).find(|&at| {
            let [a, b, c] = corner(&left, at);
            turn(a, b, c) > SLIVER
                && !left
                    .iter()
                    .any(|p| ![a, b, c].contains(p) && within([a, b, c], *p))
        });
        // An outline that crosses itself has no ear left: its flattest corner goes instead.
        let flat = |at: usize| {
            let [before, here, after] = corner(&left, at);
            turn(before, here, after).abs()
        };
        let at = ear.unwrap_or_else(|| {
            (0..count)
                .min_by(|&i, &j| flat(i).total_cmp(&flat(j)))
                .unwrap_or(0)
        });
        if ear.is_some() {
            out.push(corner(&left, at));
        }
        left.remove(at);
    }
    if let &[a, b, c] = left.as_slice()
        && turn(a, b, c).abs() > SLIVER
    {
        out.push([a, b, c]);
    }
    out
}

/// The corner at `at` with the ones before and after it.
fn corner(outline: &[Spot], at: usize) -> [Spot; 3] {
    let count = outline.len();
    let pick = |i: usize| outline.get(i % count).copied().unwrap_or_default();
    [pick(at + count - 1), pick(at), pick(at + 1)]
}

/// Twice the area of the triangle: positive when it runs counter-clockwise.
fn turn([ax, ay]: Spot, [bx, by]: Spot, [cx, cy]: Spot) -> f64 {
    (bx - ax).mul_add(cy - ay, -((by - ay) * (cx - ax)))
}

fn within([a, b, c]: [Spot; 3], p: Spot) -> bool {
    turn(a, b, p) >= 0.0 && turn(b, c, p) >= 0.0 && turn(c, a, p) >= 0.0
}
