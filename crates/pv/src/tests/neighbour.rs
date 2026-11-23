//! Neighbours the builder's consumer supplies (ADR 20), checked against corners worked out by hand.

use crate::{Neighbour, NeighbourRefused, Occluder, Point, Surface};

/// A triangle's area seen from above.
fn area([a, b, c]: [Point; 3]) -> f64 {
    (b[0] - a[0])
        .mul_add(c[1] - a[1], -(c[0] - a[0]) * (b[1] - a[1]))
        .abs()
        / 2.0
}

#[test]
fn an_l_shaped_neighbour_stands_on_its_footprint_with_a_wall_per_edge_and_a_level_top() {
    let l = Neighbour {
        footprint: vec![
            [0.0, 0.0],
            [4.0, 0.0],
            [4.0, 2.0],
            [2.0, 2.0],
            [2.0, 4.0],
            [0.0, 4.0],
        ],
        height: 7.5,
    };

    let faces = l.faces().unwrap();

    assert_eq!(faces.len(), 7);
    assert!(faces.iter().all(|face| face.surface == Surface::Obstacle));
    assert_eq!(
        faces[1].corners,
        vec![
            [4.0, 0.0, 0.0],
            [4.0, 2.0, 0.0],
            [4.0, 2.0, 7.5],
            [4.0, 0.0, 7.5]
        ]
    );
    assert_eq!(faces[6].corners[3], [2.0, 2.0, 7.5]);
    // The top's 12 m² as triangles: its notch is not filled in.
    let top: f64 = Neighbour::occluders(&[l])
        .unwrap()
        .iter()
        .filter_map(|occluder| match *occluder {
            Occluder::Triangle(corners) if corners.iter().all(|[_, _, up]| *up > 7.0) => {
                Some(area(corners))
            }
            Occluder::Triangle(_)
            | Occluder::Sphere { .. }
            | Occluder::Cylinder { .. }
            | Occluder::Cone { .. } => None,
        })
        .sum();
    assert!((top - 12.0).abs() < 1e-9, "{top}");
}

#[test]
fn a_neighbour_without_three_corners_or_a_height_is_refused() {
    let neighbour = |footprint: Vec<[f64; 2]>, height| Neighbour { footprint, height };

    assert_eq!(
        neighbour(vec![[0.0, 0.0], [1.0, 0.0]], 3.0).faces(),
        Err(NeighbourRefused::Corners)
    );
    assert_eq!(
        Neighbour::occluders(&[neighbour(vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]], 0.0)]),
        Err(NeighbourRefused::Height)
    );
}
