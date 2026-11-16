//! Hedges, conifers, ground surfaces and fences (ADR 20): what shades, what is only drawn, and
//! what is refused, checked against points worked out by hand.

use super::fixtures::MODULE;
use crate::{
    Crown, Face, Fence, FenceFinish, FencePoint, Fencing, Ground, GroundFinish, GroundSurface,
    Input, Module, Obstacle, Occluder, Place, Plane, PvString, Scene, Sky, Sun, Surface,
    input_output,
};

fn scene(obstacles: Vec<Obstacle>) -> Scene {
    Scene {
        north: 0.0,
        blocks: vec![],
        obstacles,
        grids: vec![],
        equipment: vec![],
        car_places: vec![],
        chimneys: vec![],
        surfaces: vec![],
        fences: vec![],
        openings: vec![],
        roof_windows: vec![],
        imported: None,
    }
}

/// The sun in the south-east, 40° from the zenith.
fn sky() -> Sky {
    Sky {
        sun: Sun {
            zenith: 40.0,
            azimuth: -50.0,
        },
        day_of_year: 172,
        ghi: 850.0,
        dni: 750.0,
        dhi: 150.0,
        temperature: 22.0,
        wind: Some(2.0),
    }
}

/// The scene point `ground` metres out along the ground toward the sun, from the origin.
fn sunward(ground: f64) -> (f64, f64) {
    let azimuth = sky().sun.azimuth.to_radians();
    // East is x, north is −z.
    (-azimuth.sin() * ground, azimuth.cos() * ground)
}

/// One level module lying 1 m up at the origin, under the scene's occluders.
fn watts(scene: &Scene) -> f64 {
    let input = Input {
        limits: None,
        strings: vec![PvString {
            module: MODULE,
            modules: vec![Module {
                plane: Plane {
                    tilt: 0.0,
                    azimuth: 0.0,
                },
                optimized: false,
                place: Some(Place {
                    centre: [0.0, 0.0, 1.0],
                    landscape: false,
                }),
            }],
            loss: 0.0,
        }],
    };
    input_output(&input, &sky(), &scene.occluders()).power
}

fn tree(crown: Crown, at: (f64, f64)) -> Obstacle {
    Obstacle::Tree {
        x: at.0,
        z: at.1,
        radius: 2.0,
        height: 10.0,
        crown,
    }
}

#[test]
fn a_conifer_is_a_trunk_under_a_cone_from_a_fifth_of_its_height_to_its_top() {
    let solids = scene(vec![tree(Crown::Conifer, (-4.0, 0.0))]).solids();

    assert_eq!(
        solids,
        vec![
            Occluder::Cylinder {
                base: [-4.0, 0.0, 0.0],
                radius: 0.2,
                height: 2.0
            },
            Occluder::Cone {
                base: [-4.0, 0.0, 2.0],
                radius: 2.0,
                height: 8.0
            },
        ]
    );
}

#[test]
fn a_conifer_on_the_suns_ray_shades_but_lets_the_sun_past_its_narrow_top() {
    let open = watts(&scene(vec![]));
    // The ray from the module meets the tree's axis 4 m out at 5.8 m, inside the cone.
    let through = watts(&scene(vec![tree(Crown::Conifer, sunward(4.0))]));
    // 6 m out the ray meets the axis at 8.2 m, where a broadleaf crown is 1.8 m wide and the
    // cone 0.45 m; 2 m to the side, past the module's own size, it passes the cone but not the sphere.
    let (x, z) = sunward(6.0);
    let aside = (2.0f64.mul_add(0.643, x), 2.0f64.mul_add(-0.766, z));
    let beside_cone = watts(&scene(vec![tree(Crown::Conifer, aside)]));
    let beside_sphere = watts(&scene(vec![tree(Crown::Broadleaf, aside)]));

    assert!(through < open * 0.5, "{through} of {open}");
    assert!((beside_cone - open).abs() < 1e-9, "{beside_cone} of {open}");
    assert!(beside_sphere < open * 0.5, "{beside_sphere} of {open}");
}

#[test]
fn a_hedge_is_a_box_drawn_as_a_hedge_and_shades() {
    let (x, z) = sunward(1.5);
    // 6 m long, 0.8 m deep and 3 m high, turned to stand across the sun's ray.
    let hedge = Obstacle::Hedge {
        x: x - 3.0,
        z: z - 0.4,
        length: 6.0,
        depth: 0.8,
        height: 3.0,
        rotation: 0.0,
    };
    let built = scene(vec![hedge]);
    let faces: Vec<Face> = built.faces();

    assert_eq!(faces.len(), 5);
    assert!(faces.iter().all(|face| face.surface == Surface::Hedge));
    assert!(watts(&built) < watts(&scene(vec![])) * 0.5);
}

fn surface(width: f64, depth: f64) -> GroundSurface {
    GroundSurface {
        x: -10.0,
        z: -10.0,
        width,
        depth,
        rotation: 0.0,
        finish: GroundFinish::Paving,
    }
}

fn fence(points: Vec<[f64; 2]>) -> Fence {
    Fence {
        points: points
            .into_iter()
            .map(|[x, z]| FencePoint { x, z })
            .collect(),
        height: 1.2,
        finish: FenceFinish::Wood,
    }
}

#[test]
fn surfaces_and_fences_never_shade() {
    let (x, z) = sunward(1.0);
    let mut surrounded = scene(vec![]);
    surrounded.surfaces = vec![surface(20.0, 20.0)];
    // Were they solid, a 5 m fence across the sun's ray 1 m out, and a 30 m wall right under the
    // module, would shade it.
    surrounded.fences = vec![
        fence(vec![[x - 2.0, z + 2.0], [x + 2.0, z - 2.0]]),
        fence(vec![[-15.0, 0.0], [15.0, 0.0]]),
    ];
    surrounded.fences[0].height = 5.0;
    surrounded.fences[1].height = 30.0;

    assert_eq!(surrounded.occluders(), vec![]);
    assert!((watts(&surrounded) - watts(&scene(vec![]))).abs() < 1e-9);
}

#[test]
fn a_surface_lies_on_the_ground_by_its_footprint_and_a_fence_runs_through_its_points() {
    let mut built = scene(vec![]);
    built.surfaces = vec![GroundSurface {
        rotation: 90.0,
        ..surface(4.0, 2.0)
    }];
    built.fences = vec![fence(vec![[0.0, 0.0], [3.0, 4.0], [3.0, 8.0]])];

    let [Ground { finish, corners }] = built.ground().unwrap()[..] else {
        panic!();
    };
    assert_eq!(finish, GroundFinish::Paving);
    // Turned 90° clockwise about its corner, its width runs along +z: south.
    let expected = [
        [-10.0, 10.0, 0.0],
        [-10.0, 6.0, 0.0],
        [-12.0, 6.0, 0.0],
        [-12.0, 10.0, 0.0],
    ];
    for (actual, expected) in corners.iter().zip(expected) {
        assert!(
            actual
                .iter()
                .zip(expected)
                .all(|(a, e)| (a - e).abs() < 1e-9),
            "{corners:?}"
        );
    }
    assert_eq!(
        built.fencing(),
        Ok(vec![Fencing {
            finish: FenceFinish::Wood,
            height: 1.2,
            points: vec![[0.0, 0.0, 0.0], [3.0, -4.0, 0.0], [3.0, -8.0, 0.0]],
        }])
    );
}

#[test]
fn a_surface_without_a_positive_size_or_a_fence_of_fewer_than_two_points_is_refused() {
    let mut built = scene(vec![]);
    built.surfaces = vec![surface(4.0, 2.0), surface(4.0, 0.0)];
    built.fences = vec![fence(vec![[0.0, 0.0], [1.0, 0.0]]), fence(vec![[0.0, 0.0]])];
    assert_eq!(built.ground(), Err(1));
    assert_eq!(built.fencing(), Err(1));

    built.surfaces = vec![surface(-1.0, 2.0)];
    built.fences = vec![Fence {
        height: 0.0,
        ..fence(vec![[0.0, 0.0], [1.0, 0.0]])
    }];
    assert_eq!(built.ground(), Err(0));
    assert_eq!(built.fencing(), Err(0));
}

#[test]
fn a_tree_without_a_crown_kind_is_broadleaf() {
    let stored = r#"{"kind":"tree","x":1,"z":2,"radius":2,"height":8}"#;

    assert_eq!(
        serde_json::from_str::<Obstacle>(stored).unwrap(),
        Obstacle::Tree {
            x: 1.0,
            z: 2.0,
            radius: 2.0,
            height: 8.0,
            crown: Crown::Broadleaf,
        }
    );
}
