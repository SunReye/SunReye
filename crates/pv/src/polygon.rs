//! Simple polygons in a plane, convex or not: whether one crosses itself, its triangles, and
//! whether two share area.

/// Metres within which two points are one, or a point lies on a line.
const EPSILON: f64 = 1e-9;

pub type Plan = [f64; 2];

/// Twice the signed area: positive counter-clockwise.
pub fn area(polygon: &[Plan]) -> f64 {
    edges(polygon)
        .map(|([au, av], [bu, bv])| au.mul_add(bv, -(bu * av)))
        .sum()
}

/// Each edge, corner to corner, the last back to the first.
pub fn edges(polygon: &[Plan]) -> impl Iterator<Item = (Plan, Plan)> + '_ {
    let next = polygon.iter().cycle().skip(1);
    polygon.iter().copied().zip(next.copied())
}

/// Twice the signed area of the triangle: positive where `c` lies left of `a` to `b`.
fn turn([au, av]: Plan, [bu, bv]: Plan, [cu, cv]: Plan) -> f64 {
    (bu - au).mul_add(cv - av, -((bv - av) * (cu - au)))
}

/// Whether two segments share a point, ends included.
fn touch((a, b): (Plan, Plan), (c, d): (Plan, Plan)) -> bool {
    let sides = |p, q, r, s| {
        let (one, other) = (turn(p, q, r), turn(p, q, s));
        !(one > EPSILON && other > EPSILON || one < -EPSILON && other < -EPSILON)
    };
    let span = |p: f64, q: f64| (p.min(q), p.max(q));
    let meets =
        |(lo, hi): (f64, f64), (low, high): (f64, f64)| lo <= high + EPSILON && low <= hi + EPSILON;
    meets(span(a[0], b[0]), span(c[0], d[0]))
        && meets(span(a[1], b[1]), span(c[1], d[1]))
        && sides(a, b, c, d)
        && sides(c, d, a, b)
}

/// Whether the polygon has at least three corners, an area, and no edge that meets another but
/// its neighbours at their shared corner.
pub fn simple(polygon: &[Plan]) -> bool {
    let all: Vec<(Plan, Plan)> = edges(polygon).collect();
    let count = all.len();
    let crossing = all.iter().enumerate().any(|(i, &(a, b))| {
        let after = all.iter().cycle().skip(i + 1);
        let folds = after.clone().next().is_some_and(|&(_, c)| {
            let back = (b[0] - a[0]).mul_add(c[0] - b[0], (b[1] - a[1]) * (c[1] - b[1]));
            turn(a, b, c).abs() <= EPSILON && back < 0.0
        });
        // Every edge but the two that share a corner with this one.
        let mut others = after.skip(1).take(count.saturating_sub(3));
        let short = (a[0] - b[0]).hypot(a[1] - b[1]) <= EPSILON;
        short || folds || others.any(|&other| touch((a, b), other))
    });
    count >= 3
        && polygon.iter().flatten().all(|v| v.is_finite())
        && area(polygon).abs() > EPSILON
        && !crossing
}

/// A simple polygon as counter-clockwise triangles, by clipping ears.
pub fn triangles(polygon: &[Plan]) -> Vec<[Plan; 3]> {
    let mut left = polygon.to_vec();
    if area(polygon) < 0.0 {
        left.reverse();
    }
    let mut out = Vec::new();
    while left.len() >= 3 {
        let Some((at, triangle)) = ear(&left) else {
            // Rounding left no ear: what is left goes as a fan.
            if let Some((&first, rest)) = left.split_first() {
                out.extend(rest.windows(2).filter_map(|w| match *w {
                    [b, c] => Some([first, b, c]),
                    _ => None,
                }));
            }
            break;
        };
        out.extend(triangle);
        left.remove(at);
    }
    out
}

/// A corner of a counter-clockwise polygon that can be cut off, with its triangle; none for one
/// in line with its neighbours, which goes without.
fn ear(polygon: &[Plan]) -> Option<(usize, Option<[Plan; 3]>)> {
    let count = polygon.len();
    let before = polygon.iter().cycle().skip(count - 1);
    let after = polygon.iter().cycle().skip(1);
    let corners = before.zip(polygon).zip(after).take(count);
    corners.enumerate().find_map(|(at, ((&a, &b), &c))| {
        let spun = turn(a, b, c);
        if spun.abs() <= EPSILON {
            return Some((at, None));
        }
        let blocked = polygon.iter().any(|&p| {
            ![a, b, c].contains(&p)
                && turn(a, b, p) >= -EPSILON
                && turn(b, c, p) >= -EPSILON
                && turn(c, a, p) >= -EPSILON
        });
        (spun > 0.0 && !blocked).then_some((at, Some([a, b, c])))
    })
}

/// Whether two simple polygons share more than a line or a point.
pub fn overlap(a: &[Plan], b: &[Plan]) -> bool {
    let theirs = triangles(b);
    triangles(a)
        .iter()
        .any(|t| theirs.iter().any(|u| triangles_overlap(*t, *u)))
}

/// Whether two counter-clockwise triangles share area: no edge of either has the other wholly on
/// its outside.
fn triangles_overlap(a: [Plan; 3], b: [Plan; 3]) -> bool {
    let apart = |t: [Plan; 3], other: [Plan; 3]| {
        edges(&t).any(|(p, q)| other.iter().all(|&r| turn(p, q, r) <= EPSILON))
    };
    !apart(a, b) && !apart(b, a)
}
