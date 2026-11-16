//! Imported surroundings (ADR 20): a fetched area turned into metres around the location,
//! checked against a recorded Overpass answer for a public square (© OpenStreetMap
//! contributors, `ODbL`) whose distances were worked out apart from this crate, the lengths of a
//! degree from geodesy tables, and terrain made by hand.

use serde_json::{Value, json};

use crate::{Crown, Fetched, Imported, Location, MapData, PatchFinish, Roofing, Tile, Vicinity};

/// The recorded answer's centre: a public square, tile 17789/11515 at zoom 15.
const SQUARE: Location = Location {
    latitude: 47.0739,
    longitude: 15.4413,
};

fn area(centre: Location, radius: f64) -> Vicinity {
    Vicinity { centre, radius }
}

fn recorded() -> Imported {
    let map = serde_json::from_str(include_str!("../../fixtures/surroundings/overpass.json"));
    let fetched = Fetched {
        tiles: vec![],
        map: map.unwrap(),
    };
    Imported::new(&area(SQUARE, 100.0), &fetched)
}

/// What Overpass answers with for `elements`.
fn map(elements: &Value) -> MapData {
    serde_json::from_value(json!({ "version": 0.6, "elements": elements })).unwrap()
}

fn imported(centre: Location, radius: f64, elements: &Value) -> Imported {
    let fetched = Fetched {
        tiles: vec![],
        map: map(elements),
    };
    Imported::new(&area(centre, radius), &fetched)
}

fn at(latitude: f64, longitude: f64) -> Location {
    Location {
        latitude,
        longitude,
    }
}

/// A closed way around the four corners `metres` from the equator's origin, as degrees: one of
/// longitude is 111.319 km there, one of latitude 110.574 km.
fn square_way(metres: f64, tags: &Value) -> Value {
    let (n, e) = (metres / 110_574.0, metres / 111_319.49);
    let ring = [[-n, -e], [-n, e], [n, e], [n, -e], [-n, -e]];
    let geometry: Vec<Value> = ring
        .iter()
        .map(|[lat, lon]| json!({ "lat": lat, "lon": lon }))
        .collect();
    json!({ "type": "way", "id": 1, "geometry": geometry, "tags": tags })
}

fn close(actual: f64, expected: f64, within: f64) -> bool {
    (actual - expected).abs() <= within
}

#[test]
fn a_degree_is_as_long_as_the_geodesy_tables_say() {
    let tree = |lat: f64, lon: f64| json!([{ "type": "node", "id": 1, "lat": lat, "lon": lon, "tags": { "natural": "tree" } }]);

    // A degree of longitude is 111.319 km on the equator and 55.800 km at 60°; one of latitude
    // 111.132 km at 45°.
    let equator = imported(at(0.0, 10.0), 200.0, &tree(0.0, 10.001));
    let sixty = imported(at(60.0, 10.0), 200.0, &tree(60.0, 10.001));
    let middle = imported(at(45.0, 10.0), 200.0, &tree(45.001, 10.0));

    // To the centimetre the document keeps.
    assert!(close(equator.trees[0].at[0], 111.319, 0.006));
    assert!(close(equator.trees[0].at[1], 0.0, 0.006));
    assert!(close(sixty.trees[0].at[0], 55.800, 0.006));
    assert!(close(middle.trees[0].at[1], 111.132, 0.006));
    assert!(close(middle.trees[0].at[0], 0.0, 0.006));
}

#[test]
fn an_area_asks_for_its_bounds_and_the_zoom_15_tiles_they_touch() {
    let [south, west, north, east] = area(SQUARE, 100.0).bounds();

    // 100 m are 0.000 899 5° of latitude and 0.001 316 6° of longitude there.
    assert!(close(south, 47.073_000_5, 1e-6) && close(north, 47.074_799_5, 1e-6));
    assert!(close(west, 15.439_983_4, 1e-6) && close(east, 15.442_616_6, 1e-6));
    assert_eq!(area(SQUARE, 100.0).tiles(), vec![(17789, 11515)]);
    assert_eq!(area(SQUARE, 300.0).tiles(), vec![(17789, 11515)]);
    // 350 m further south the area crosses into the next row of tiles.
    assert_eq!(
        area(at(47.0707, 15.4395), 100.0).tiles(),
        vec![(17789, 11515), (17789, 11516)]
    );
}

#[test]
fn a_terrarium_pixel_is_its_red_times_256_plus_green_plus_a_256th_of_blue_less_32768() {
    let mut rgb = vec![0_u8; 256 * 256 * 3];
    rgb[..3].copy_from_slice(&[0x81, 0x80, 0x2b]);
    rgb[3..6].copy_from_slice(&[0x81, 0x6d, 0x16]);

    let tile = Tile::terrarium(17789, 11515, &rgb).unwrap();

    assert!(close(f64::from(tile.heights[0]), 384.167_968_75, 1e-4));
    assert!(close(f64::from(tile.heights[1]), 365.085_937_5, 1e-4));
    assert_eq!(tile.heights.len(), 256 * 256);
    assert!(Tile::terrarium(0, 0, &rgb[3..]).is_none());
}

#[test]
fn the_recorded_square_becomes_buildings_trees_hedges_and_ground() {
    let square = recorded();

    // 27 ways, one of them underground and left out, and the 5 outer rings of 4 relations; ids
    // count up from 0.
    assert_eq!(square.buildings.len(), 31);
    assert!(square.buildings.iter().zip(0..).all(|(b, id)| b.id == id));
    // Way 988215463: a service building tagged 3 m high, 34.7 m² large.
    let kiosk = &square.buildings[25];
    assert!(close(kiosk.eave, 3.0, 0.0) && kiosk.roof == Roofing::Flat);
    assert!(close(kiosk.outline[0][0], -5.63, 0.02) && close(kiosk.outline[0][1], -16.75, 0.02));
    // Node 1399872431 stands 5.38 m east and 2.10 m north of the centre, untagged.
    assert_eq!(square.trees.len(), 52);
    let tree = square.trees[0];
    assert!(close(tree.at[0], 5.377, 0.02) && close(tree.at[1], 2.101, 0.02));
    assert!(close(tree.height, 8.0, 0.0) && tree.crown == Crown::Broadleaf);
    // Both hedges run in from past 100 m east, the first from 103 m, and are cut there.
    assert_eq!(square.hedges.len(), 2);
    assert!(
        square
            .hedges
            .iter()
            .all(|h| close(h.points[0][0], 100.0, 1e-9))
    );
    assert!(close(square.hedges[0].height, 1.5, 0.0) && close(square.hedges[0].width, 1.0, 0.0));
    let water = square
        .grounds
        .iter()
        .filter(|g| g.finish == PatchFinish::Water);
    assert_eq!(water.count(), 2);
    assert!(close(square.radius, 100.0, 0.0));
}

#[test]
fn nothing_of_the_recorded_square_lies_past_its_radius_but_whole_buildings() {
    let square = recorded();

    let inside = |[east, north]: [f64; 2]| east.abs() <= 100.0 && north.abs() <= 100.0;
    assert!(square.trees.iter().all(|t| inside(t.at)));
    assert!(
        square
            .hedges
            .iter()
            .all(|h| h.points.iter().all(|p| inside(*p)))
    );
    assert!(
        square
            .grounds
            .iter()
            .all(|g| g.outline.iter().all(|p| inside(*p)))
    );
    // A building is never cut: way 85081216 reaches 110 m west.
    let west = square.buildings[3].outline.iter().map(|p| p[0]);
    assert!(west.fold(f64::INFINITY, f64::min) < -105.0);
}

#[test]
fn a_building_is_as_high_as_tagged_else_3_m_a_level_else_6_m() {
    let tagged = json!({ "building": "yes", "height": "11.5 m", "building:levels": "2" });
    let levels = json!({ "building": "house", "building:levels": "2" });
    let bare = json!({ "building": "yes", "height": "tall" });

    let built = imported(
        at(0.0, 0.0),
        100.0,
        &json!([
            square_way(5.0, &tagged),
            square_way(5.0, &levels),
            square_way(5.0, &bare),
        ]),
    );

    let eaves: Vec<f64> = built.buildings.iter().map(|b| b.eave).collect();
    assert_eq!(eaves, vec![11.5, 6.0, 6.0]);
    assert!(built.buildings.iter().all(|b| b.roof == Roofing::Flat));
    // 10 m a side, counter-clockwise seen from above.
    assert_eq!(built.buildings[0].outline.len(), 4);
    assert!(close(built.buildings[0].outline[0][0].abs(), 5.0, 0.01));
}

#[test]
fn a_gabled_or_hipped_roof_rises_at_35_degrees_over_its_buildings_short_side() {
    let gabled = json!({ "building": "yes", "building:levels": "2", "roof:shape": "gabled" });
    let hipped = json!({ "building": "yes", "height": "9", "roof:shape": "hipped" });
    let given = json!({ "building": "yes", "roof:shape": "gabled", "roof:height": "2" });
    let other = json!({ "building": "yes", "building:levels": "2", "roof:shape": "mansard" });

    let built = imported(
        at(0.0, 0.0),
        100.0,
        &json!([
            square_way(5.0, &gabled),
            square_way(5.0, &hipped),
            square_way(5.0, &given),
            square_way(5.0, &other),
        ]),
    );

    // Half of 10 m at 35° is 3.50 m of rise.
    let [a, b, c, d] = built.buildings.as_slice() else {
        panic!("four buildings");
    };
    let Roofing::Gable { rise } = a.roof else {
        panic!("gable");
    };
    assert!(close(rise, 3.501, 0.01) && close(a.eave, 6.0, 0.0));
    // A tagged height is the ridge's: the eaves stand the rise below it.
    let Roofing::Hipped { rise } = b.roof else {
        panic!("hipped");
    };
    assert!(close(rise, 3.501, 0.01) && close(b.eave, 5.499, 0.01));
    assert_eq!(c.roof, Roofing::Gable { rise: 2.0 });
    assert_eq!(d.roof, Roofing::Flat);
}

#[test]
fn a_pitched_roof_on_an_outline_far_from_a_rectangle_is_flat() {
    let d = 1.0 / 111_319.49;
    // An L of 20 by 20 m with a 15 by 15 m notch: 175 of its rectangle's 400 m².
    let ell = [
        [0.0, 0.0],
        [0.0, 20.0],
        [5.0, 20.0],
        [5.0, 5.0],
        [20.0, 5.0],
        [20.0, 0.0],
        [0.0, 0.0],
    ];
    let geometry: Vec<Value> = ell
        .iter()
        .map(|[north, east]| json!({ "lat": north * d, "lon": east * d }))
        .collect();
    let way = json!({ "type": "way", "id": 1, "geometry": geometry,
        "tags": { "building": "yes", "roof:shape": "gabled" } });

    let built = imported(at(0.0, 0.0), 100.0, &json!([way]));

    assert_eq!(built.buildings[0].roof, Roofing::Flat);
    assert_eq!(built.buildings[0].outline.len(), 6);
}

#[test]
fn a_tree_is_8_m_of_broadleaf_unless_its_tags_say_otherwise() {
    let tree =
        |tags: Value| json!({ "type": "node", "id": 1, "lat": 0.0, "lon": 0.0, "tags": tags });

    let grown = imported(
        at(0.0, 0.0),
        100.0,
        &json!([
            tree(json!({ "natural": "tree" })),
            tree(json!({ "natural": "tree", "height": "15", "leaf_type": "needleleaved" })),
            tree(json!({ "natural": "tree", "diameter_crown": "9" })),
        ]),
    );

    let shapes: Vec<_> = grown
        .trees
        .iter()
        .map(|t| (t.height, t.radius, t.crown))
        .collect();
    assert_eq!(
        shapes,
        vec![
            (8.0, 2.4, Crown::Broadleaf),
            (15.0, 4.5, Crown::Conifer),
            (8.0, 4.5, Crown::Broadleaf),
        ]
    );
}

#[test]
fn a_tree_row_is_a_tree_every_8_m_from_end_to_end() {
    let d = 1.0 / 111_319.49;
    let row = json!([{ "type": "way", "id": 1,
        "geometry": [{ "lat": 0.0, "lon": 0.0 }, { "lat": 0.0, "lon": 24.0 * d }],
        "tags": { "natural": "tree_row" } }]);

    let grown = imported(at(0.0, 0.0), 100.0, &row);

    let east: Vec<f64> = grown.trees.iter().map(|t| t.at[0]).collect();
    assert_eq!(east.len(), 4);
    for (actual, expected) in east.iter().zip([0.0, 8.0, 16.0, 24.0]) {
        assert!(close(*actual, expected, 0.01), "{actual} for {expected}");
    }
}

#[test]
fn roads_paths_water_and_land_use_become_ground_and_what_is_unknown_is_left_out() {
    let d = 1.0 / 111_319.49;
    let line = |tags: Value| {
        json!({ "type": "way", "id": 1,
            "geometry": [{ "lat": 0.0, "lon": -500.0 * d }, { "lat": 0.0, "lon": 500.0 * d }],
            "tags": tags })
    };

    let ground = imported(
        at(0.0, 0.0),
        100.0,
        &json!([
            line(json!({ "highway": "residential" })),
            line(json!({ "highway": "footway" })),
            line(json!({ "highway": "service", "width": "4.5" })),
            line(json!({ "waterway": "stream" })),
            square_way(500.0, &json!({ "landuse": "grass" })),
            square_way(20.0, &json!({ "natural": "water" })),
            square_way(20.0, &json!({ "landuse": "forest" })),
            square_way(20.0, &json!({ "landuse": "farmland" })),
            square_way(20.0, &json!({ "landuse": "residential" })),
            line(json!({ "power": "line" })),
        ]),
    )
    .grounds;

    // Areas under lines, so each later one draws over the earlier.
    let drawn: Vec<_> = ground.iter().map(|g| (g.finish, g.width)).collect();
    assert_eq!(
        drawn,
        vec![
            (PatchFinish::Field, None),
            (PatchFinish::Grass, None),
            (PatchFinish::Wood, None),
            (PatchFinish::Water, None),
            (PatchFinish::Water, Some(1.5)),
            (PatchFinish::Path, Some(1.5)),
            (PatchFinish::Road, Some(5.0)),
            (PatchFinish::Road, Some(4.5)),
        ]
    );
    // A road a kilometre long is kept from edge to edge, the lawn as the square itself.
    let road = &ground[6].outline;
    assert_eq!(road, &vec![[-100.0, 0.0], [100.0, 0.0]]);
    let lawn = &ground[1].outline;
    assert_eq!(lawn.len(), 4);
    assert!(
        lawn.iter()
            .all(|[e, n]| close(e.abs(), 100.0, 0.0) && close(n.abs(), 100.0, 0.0))
    );
}

/// A tile whose heights rise by half a metre a pixel toward the east.
fn slope(x: u32, y: u32) -> Tile {
    let heights = (0..256 * 256)
        .map(|at| 0.5_f32.mul_add(f32::from(u16::try_from(at % 256).unwrap()), 100.0))
        .collect();
    Tile { x, y, heights }
}

#[test]
fn the_terrain_is_a_5_m_grid_of_heights_above_the_centres() {
    // On the equator a zoom-15 pixel is 4.777 m wide; this area lies inside tile 16384/16383.
    let fetched = Fetched {
        tiles: vec![slope(16384, 16383)],
        map: MapData::default(),
    };

    let terrain = Imported::new(&area(at(0.004, 0.004), 100.0), &fetched).terrain;

    assert!(close(terrain.step, 5.0, 0.0) && terrain.side == 41);
    assert_eq!(terrain.heights.len(), 41 * 41);
    // Rows run north from the south-west corner: the centre is node 20 of row 20.
    let node = |row: usize, column: usize| terrain.heights[row * 41 + column];
    assert!(close(node(20, 20), 0.0, 0.0));
    // 50 m east are 10.466 pixels, so 5.23 m up; north changes nothing.
    assert!(close(node(20, 30), 5.233, 0.02), "{}", node(20, 30));
    assert!(close(node(20, 0), -10.466, 0.02), "{}", node(20, 0));
    assert!(close(node(40, 20), 0.0, 0.02) && close(node(0, 20), 0.0, 0.02));
}

#[test]
fn terrain_without_a_tile_is_level() {
    let terrain = imported(at(0.0, 0.0), 200.0, &json!([])).terrain;

    assert_eq!(terrain.side, 81);
    assert!(terrain.heights.iter().all(|h| close(*h, 0.0, 0.0)));
}

#[test]
fn the_document_names_its_sources_credits_and_reads_back_as_written() {
    let square = recorded();

    assert_eq!(square.credits[0], "© OpenStreetMap contributors");
    assert!(square.credits.iter().any(|c| c.contains("Copernicus")));
    let text = serde_json::to_string(&square).unwrap();
    assert_eq!(serde_json::from_str::<Imported>(&text).unwrap(), square);
}

mod placed {
    //! The document stood in a scene: what shades, what is drawn and what is hidden, checked
    //! against rays worked out by hand. The sun stands in the south-east, 40° from the zenith:
    //! its ray climbs 1.19 m for each metre it runs along the ground.

    use crate::{
        Block, Building, Crown, EastNorth, Hedge, Import, Imported, Input, Module, Occluder,
        Overhang, Patch, PatchFinish, Place, Plane, PvString, Roof, Roofing, Scene, Sky, Sun,
        Surface, Terrain, Tree, input_output,
    };

    use super::super::fixtures::MODULE;
    use super::close;

    const DOCUMENT: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn level(height: impl Fn(f64, f64) -> f64) -> Terrain {
        let node = |at: u32| 5.0 * (f64::from(at) - 20.0);
        Terrain {
            step: 5.0,
            side: 41,
            heights: (0..41)
                .flat_map(|row| (0..41).map(move |column| (row, column)))
                .map(|(row, column)| height(node(column), node(row)))
                .collect(),
        }
    }

    fn document() -> Imported {
        Imported {
            radius: 100.0,
            buildings: vec![],
            trees: vec![],
            hedges: vec![],
            grounds: vec![],
            terrain: level(|_, _| 0.0),
            credits: vec![],
        }
    }

    fn import(x: f64, z: f64, turn: f64) -> Import {
        Import {
            document: DOCUMENT.to_owned(),
            x,
            z,
            turn,
            hidden: vec![],
        }
    }

    fn scene(imported: Option<Import>) -> Scene {
        Scene {
            north: 0.0,
            blocks: vec![],
            obstacles: vec![],
            grids: vec![],
            equipment: vec![],
            car_places: vec![],
            chimneys: vec![],
            surfaces: vec![],
            fences: vec![],
            openings: vec![],
            roof_windows: vec![],
            imported,
        }
    }

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

    /// The unit vectors along the ground toward the sun and across its ray, east and north.
    const TOWARD: EastNorth = [0.766, -0.643];
    const ACROSS: EastNorth = [0.643, 0.766];

    /// The spot `toward` metres toward the sun and `across` metres beside its ray.
    fn spot(toward: f64, across: f64) -> EastNorth {
        [
            toward.mul_add(TOWARD[0], across * ACROSS[0]),
            toward.mul_add(TOWARD[1], across * ACROSS[1]),
        ]
    }

    /// A building across the sun's ray: from `near` to `far` metres toward the sun, `half`
    /// metres to either side, counter-clockwise from its side facing the module.
    fn across(id: u32, (near, far): (f64, f64), half: f64, eave: f64, roof: Roofing) -> Building {
        Building {
            id,
            outline: vec![
                spot(near, half),
                spot(near, -half),
                spot(far, -half),
                spot(far, half),
            ],
            eave,
            roof,
        }
    }

    /// One level module lying 1 m up at the origin, under what the scene and the document shade
    /// with.
    fn watts(scene: &Scene, document: &Imported) -> f64 {
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
        input_output(&input, &sky(), &scene.occluders_among(Some(document))).power
    }

    fn open() -> f64 {
        watts(&scene(None), &document())
    }

    #[test]
    fn a_scene_without_an_import_has_nothing_around_it() {
        let mut around = document();
        around.buildings = vec![across(0, (2.0, 6.0), 2.0, 6.0, Roofing::Flat)];
        let bare = scene(None);

        assert!(bare.around(&around).is_none());
        assert_eq!(bare.occluders_among(Some(&around)), bare.occluders());
        assert_eq!(bare.occluders_among(None), bare.occluders());
    }

    #[test]
    fn an_imported_building_shades_like_a_box_and_a_hidden_one_does_not() {
        // 2 m out the ray is 3.4 m up: under the 6 m eaves.
        let mut around = document();
        around.buildings = vec![across(7, (2.0, 6.0), 2.0, 6.0, Roofing::Flat)];
        let shown = scene(Some(import(0.0, 0.0, 0.0)));
        let mut hidden = shown.clone();
        hidden.imported.as_mut().unwrap().hidden = vec![7];

        let standing = &shown.around(&around).unwrap().buildings;

        assert!(watts(&shown, &around) < open() * 0.5);
        assert!(close(watts(&hidden, &around), open(), 1e-9));
        // Four walls and a lid of two triangles, up to 6 m.
        assert_eq!(
            (standing.len(), standing[0].id, standing[0].hidden),
            (1, 7, false)
        );
        let walls = standing[0]
            .faces
            .iter()
            .filter(|f| f.surface == Surface::Wall);
        assert_eq!(walls.count(), 4);
        let roof: Vec<_> = standing[0]
            .faces
            .iter()
            .filter(|f| f.surface == Surface::Roof)
            .collect();
        assert_eq!(roof.len(), 2);
        assert!(
            roof.iter()
                .all(|f| f.corners.iter().all(|c| close(c[2], 6.0, 1e-9)))
        );
        // A hidden building is still told, so the builder can show it again.
        let told = &hidden.around(&around).unwrap().buildings;
        assert!(told[0].hidden && !told[0].faces.is_empty());
    }

    #[test]
    fn the_document_lies_where_the_scene_puts_it_and_keeps_true_north() {
        // Behind the module, away from the sun.
        let mut around = document();
        around.buildings = vec![across(0, (-6.0, -2.0), 2.0, 6.0, Roofing::Flat)];
        // 10 m east of the ray.
        let mut aside = document();
        let moved = across(0, (2.0, 6.0), 2.0, 6.0, Roofing::Flat);
        aside.buildings = vec![Building {
            outline: moved.outline.iter().map(|[e, n]| [e + 10.0, *n]).collect(),
            ..moved
        }];
        let lying = |x, z, turn| scene(Some(import(x, z, turn)));
        // The scene's forward axis points east: its x runs south, its z west.
        let mut turned = lying(0.0, 10.0, 0.0);
        turned.north = 90.0;

        assert!(close(watts(&lying(0.0, 0.0, 0.0), &around), open(), 1e-9));
        assert!(watts(&lying(0.0, 0.0, 180.0), &around) < open() * 0.5);
        assert!(close(watts(&lying(0.0, 0.0, 0.0), &aside), open(), 1e-9));
        // The scene's x runs east.
        assert!(watts(&lying(-10.0, 0.0, 0.0), &aside) < open() * 0.5);
        // Whatever the compass says, north in the document stays north.
        assert!(watts(&turned, &aside) < open() * 0.5);
    }

    #[test]
    fn a_turn_is_clockwise_seen_from_above() {
        let mut around = document();
        around.trees = vec![Tree {
            at: [0.0, 10.0],
            height: 8.0,
            radius: 2.0,
            crown: Crown::Conifer,
        }];

        let trees = scene(Some(import(0.0, 0.0, 90.0)))
            .around(&around)
            .unwrap()
            .trees;

        // From 10 m north to 10 m east.
        let Occluder::Cylinder { base, .. } = trees[0] else {
            panic!("a trunk");
        };
        assert!(close(base[0], 10.0, 1e-9) && close(base[1], 0.0, 1e-9));
    }

    #[test]
    fn a_pitched_roof_shades_above_its_eaves() {
        // From 3 to 11 m out, its ridge across the ray 7 m out. At the near wall the ray is
        // 4.6 m up, over the 3 m eaves; a roof rising 8 m to its ridge meets it 4.9 m out.
        let mut around = document();
        let shades = |around: &mut Imported, roof| {
            around.buildings = vec![across(0, (3.0, 11.0), 6.0, 3.0, roof)];
            watts(&scene(Some(import(0.0, 0.0, 0.0))), around)
        };

        assert!(close(shades(&mut around, Roofing::Flat), open(), 1e-9));
        assert!(shades(&mut around, Roofing::Gable { rise: 8.0 }) < open() * 0.5);
        assert!(shades(&mut around, Roofing::Hipped { rise: 8.0 }) < open() * 0.5);
    }

    #[test]
    fn a_gable_stands_on_the_short_sides_and_its_ridge_runs_along_the_long_ones() {
        let mut around = document();
        around.buildings = vec![Building {
            id: 0,
            outline: vec![[0.0, 0.0], [12.0, 0.0], [12.0, 8.0], [0.0, 8.0]],
            eave: 3.0,
            roof: Roofing::Gable { rise: 2.0 },
        }];

        let faces = &scene(Some(import(0.0, 0.0, 0.0)))
            .around(&around)
            .unwrap()
            .buildings[0]
            .faces;

        // Two roof faces meeting 5 m up along north = 4; the gable walls at east 0 and 12.
        let ridge: Vec<_> = faces
            .iter()
            .flat_map(|f| &f.corners)
            .filter(|c| close(c[2], 5.0, 1e-9))
            .collect();
        assert!(ridge.iter().all(|c| close(c[1], 4.0, 1e-9)));
        assert!(ridge.iter().any(|c| close(c[0], 0.0, 1e-9)));
        assert!(ridge.iter().any(|c| close(c[0], 12.0, 1e-9)));
        let gables = faces
            .iter()
            .filter(|f| f.surface == Surface::Wall && f.corners.len() == 5);
        assert_eq!(gables.count(), 2);
        assert_eq!(
            faces.iter().filter(|f| f.surface == Surface::Roof).count(),
            2
        );
    }

    /// The area of a face's triangle fan, seen from above.
    fn area(corners: &[[f64; 3]]) -> f64 {
        let [first, rest @ ..] = corners else {
            return 0.0;
        };
        rest.windows(2)
            .map(|pair| {
                let (b, c) = (pair[0], pair[1]);
                let (east, north) = (b[0] - first[0], b[1] - first[1]);
                east.mul_add(c[1] - first[1], -(north * (c[0] - first[0])))
                    .abs()
                    / 2.0
            })
            .sum()
    }

    #[test]
    fn a_flat_roof_covers_its_outline_and_not_the_notch_in_it() {
        // An L of 20 by 20 m with a 15 by 15 m notch at its north-east: 175 m².
        let mut around = document();
        around.buildings = vec![Building {
            id: 0,
            outline: vec![
                [0.0, 0.0],
                [20.0, 0.0],
                [20.0, 5.0],
                [5.0, 5.0],
                [5.0, 20.0],
                [0.0, 20.0],
            ],
            eave: 4.0,
            roof: Roofing::Flat,
        }];

        let faces = &scene(Some(import(0.0, 0.0, 0.0)))
            .around(&around)
            .unwrap()
            .buildings[0]
            .faces;

        let roof: Vec<_> = faces
            .iter()
            .filter(|f| f.surface == Surface::Roof)
            .collect();
        assert!(close(
            roof.iter().map(|f| area(&f.corners)).sum(),
            175.0,
            1e-6
        ));
        let in_notch = |f: &&crate::Face| {
            let count = f64::from(u8::try_from(f.corners.len()).unwrap());
            let east = f.corners.iter().map(|c| c[0]).sum::<f64>() / count;
            let north = f.corners.iter().map(|c| c[1]).sum::<f64>() / count;
            east > 5.0 && north > 5.0
        };
        assert!(!roof.iter().any(in_notch));
        assert_eq!(
            faces.iter().filter(|f| f.surface == Surface::Wall).count(),
            6
        );
    }

    #[test]
    fn an_imported_tree_shades_from_the_ground_it_stands_on() {
        // 6 m out the ray is 8.2 m up: inside the crown of a 10 m broadleaf, whose 2 m sphere
        // is centred 8 m up.
        let mut around = document();
        let [east, north] = spot(6.0, 0.0);
        around.trees = vec![Tree {
            at: [east, north],
            height: 10.0,
            radius: 2.0,
            crown: Crown::Broadleaf,
        }];
        let lying = scene(Some(import(0.0, 0.0, 0.0)));
        let on_the_level = watts(&lying, &around);
        // The ground falls 6 m from 2 m east of the module on: the crown now ends 4.5 m up.
        around.terrain = level(|east, _| if east > 2.0 { -6.0 } else { 0.0 });
        let below = watts(&lying, &around);
        let trees = lying.around(&around).unwrap().trees;

        assert!(on_the_level < open() * 0.5);
        assert!(close(below, open(), 1e-9));
        // Between the nodes at 0 and 5 m east: 92 % of the way down.
        let Occluder::Cylinder { base, .. } = trees[0] else {
            panic!("a trunk");
        };
        assert!(close(base[2], -5.5, 0.1), "{}", base[2]);
    }

    #[test]
    fn a_hill_toward_the_sun_shades_and_level_or_lower_ground_does_not() {
        // 40 m high from 20 m east and 20 m south on: the ray comes over it 31 m out, 38 m up.
        let mut around = document();
        let lying = scene(Some(import(0.0, 0.0, 0.0)));
        let level_ground = lying.occluders_among(Some(&around));
        around.terrain = level(|east, north| {
            if east >= 20.0 && north <= -20.0 {
                40.0
            } else {
                0.0
            }
        });
        let hill = watts(&lying, &around);
        around.terrain = level(|east, north| {
            if east >= 20.0 && north <= -20.0 {
                -40.0
            } else {
                0.0
            }
        });
        let pit = lying.occluders_among(Some(&around));

        assert!(hill < open() * 0.5);
        // Ground no higher than the blocks' can shade nothing above it.
        assert_eq!((level_ground, pit), (vec![], vec![]));
    }

    fn block() -> Block {
        Block {
            x: 0.0,
            z: 0.0,
            width: 10.0,
            depth: 8.0,
            eave: 3.0,
            rotation: 0.0,
            roof: Roof::Flat,
            open: false,
            overhang: Overhang::default(),
            roof_colour: None,
            wall_colour: None,
        }
    }

    #[test]
    fn the_terrain_is_measured_from_the_ground_under_the_blocks_and_flat_there() {
        // Rising a metre every 10 m toward the east. The block reaches 10 m east and 8 m
        // south of the origin: under its centre the terrain is 0.5 m up.
        let mut around = document();
        around.terrain = level(|east, _| east / 10.0);
        let mut built = scene(Some(import(0.0, 0.0, 0.0)));
        built.blocks = vec![block()];

        let relief = built.around(&around).unwrap().terrain;

        assert!(close(relief.height(50.0, 0.0), 4.5, 1e-9));
        assert!(close(relief.height(-50.0, 30.0), -5.5, 1e-9));
        // Level under the block and at its walls, and back to the terrain 10 m from them.
        assert!(close(relief.height(5.0, -5.0), 0.0, 1e-9));
        assert!(close(relief.height(10.0, -5.0), 0.0, 1e-9));
        assert!(close(relief.height(15.0, -5.0), 0.5, 1e-9));
        assert!(close(relief.height(20.0, -5.0), 1.5, 1e-9));
        // The grid as the browser draws it: from the south-west node, a step east, a step
        // north.
        assert_eq!((relief.side, relief.heights.len()), (41, 41 * 41));
        assert!(close(relief.origin[0], -100.0, 1e-9) && close(relief.origin[1], -100.0, 1e-9));
        assert!(close(relief.across[0], 5.0, 1e-9) && close(relief.along[1], 5.0, 1e-9));
        assert!(close(relief.heights[20 * 41 + 30], 4.5, 1e-9));
    }

    #[test]
    fn ground_is_draped_on_the_terrain_and_never_shades() {
        // A road across the ray 1 m out and water all around the module: were they solid, they
        // would shade.
        let mut around = document();
        around.grounds = vec![
            Patch {
                finish: PatchFinish::Water,
                outline: vec![[-20.0, -20.0], [20.0, -20.0], [20.0, 20.0], [-20.0, 20.0]],
                width: None,
            },
            Patch {
                finish: PatchFinish::Road,
                outline: vec![spot(1.0, -5.0), spot(1.0, 5.0)],
                width: Some(5.0),
            },
        ];
        let lying = scene(Some(import(0.0, 0.0, 0.0)));

        let drawn = lying.around(&around).unwrap().grounds;

        assert_eq!(lying.occluders_among(Some(&around)), vec![]);
        assert_eq!(drawn.len(), 2);
        assert_eq!(
            (drawn[0].finish, drawn[0].width),
            (PatchFinish::Water, None)
        );
        assert_eq!(
            (drawn[1].finish, drawn[1].width),
            (PatchFinish::Road, Some(5.0))
        );
        assert!(
            close(drawn[0].points[1][0], 20.0, 1e-9) && close(drawn[0].points[1][2], 0.0, 1e-9)
        );
        // On ground 30 m up east of the module they lie 30 m up.
        around.terrain = level(|east, _| if east > 2.0 { 30.0 } else { 0.0 });
        let raised = lying.around(&around).unwrap().grounds;
        assert!(close(raised[0].points[1][2], 30.0, 1e-9));
    }

    #[test]
    fn an_imported_hedge_shades_as_a_box_along_each_stretch_of_its_line() {
        // Across the ray 1.5 m out, where it is 2.8 m up, and on along it.
        let mut around = document();
        around.hedges = vec![Hedge {
            points: vec![spot(1.5, -3.0), spot(1.5, 3.0), spot(6.0, 3.0)],
            height: 3.5,
            width: 0.8,
        }];
        let lying = scene(Some(import(0.0, 0.0, 0.0)));

        let hedges = lying.around(&around).unwrap().hedges;

        assert!(watts(&lying, &around) < open() * 0.5);
        // Four sides and a top for each of the two stretches.
        assert_eq!(hedges.len(), 10);
        assert!(hedges.iter().all(|f| f.surface == Surface::Hedge));
        let top = hedges.iter().flat_map(|f| &f.corners).map(|c| c[2]);
        assert!(close(top.fold(0.0, f64::max), 3.5, 1e-9));
    }

    #[test]
    fn loading_hides_the_building_under_the_blocks() {
        let mut around = document();
        let footprint = |id, east: f64| Building {
            id,
            outline: vec![
                [east, -9.0],
                [east + 11.0, -9.0],
                [east + 11.0, 1.0],
                [east, 1.0],
            ],
            eave: 6.0,
            roof: Roofing::Flat,
        };
        around.buildings = vec![footprint(0, 30.0), footprint(1, -0.5), footprint(2, -40.0)];
        let mut built = scene(None);
        built.blocks = vec![block()];

        let loaded = Import::load(DOCUMENT, &built, &around);

        assert_eq!(
            loaded,
            Import {
                hidden: vec![1],
                ..import(0.0, 0.0, 0.0)
            }
        );
        assert_eq!(
            Import::load(DOCUMENT, &scene(None), &around).hidden,
            Vec::<u32>::new()
        );
    }

    #[test]
    fn a_scene_reads_and_writes_as_before_without_an_import_and_names_one_by_its_digest() {
        let bare = r#"{"north":0.0,"blocks":[],"obstacles":[],"grids":[]}"#;
        let stored: Scene = serde_json::from_str(bare).unwrap();
        let mut lying = scene(Some(Import {
            hidden: vec![3],
            ..import(1.5, -2.0, 12.0)
        }));

        assert_eq!(stored, scene(None));
        assert_eq!(serde_json::to_string(&stored).unwrap(), bare);
        let text = serde_json::to_string(&lying).unwrap();
        assert!(text.ends_with(&format!(
            r#""imported":{{"document":"{DOCUMENT}","x":1.5,"z":-2.0,"turn":12.0,"hidden":[3]}}}}"#
        )));
        assert_eq!(serde_json::from_str::<Scene>(&text).unwrap(), lying);
        assert!(stored.import_fits() && lying.import_fits());
        lying.imported.as_mut().unwrap().document = "../core.sqlite".to_owned();
        assert!(!lying.import_fits());
        lying.imported = Some(import(f64::NAN, 0.0, 0.0));
        assert!(!lying.import_fits());
    }
}
