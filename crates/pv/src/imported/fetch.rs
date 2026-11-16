//! A fetched area turned into the document (ADR 20): Terrarium terrain tiles and Overpass's
//! answer, with the defaults OpenStreetMap's tags leave open.

use std::collections::{BTreeMap, HashMap};
use std::f64::consts::PI;

use serde::Deserialize;

use super::shape::{self, EastNorth};
use super::{
    Building, CREDITS, Hedge, Imported, Patch, PatchFinish, Roofing, Terrain, Tree, centimetres,
};
use crate::{Crown, Location};

/// The zoom the terrain is fetched at: a pixel is under 5 m wide.
const ZOOM: u32 = 15;
/// A tile's pixels a side.
const PIXELS: usize = 256;
/// WGS 84: the equator's radius in metres and the squared eccentricity.
const EQUATOR: f64 = 6_378_137.0;
const ECCENTRICITY: f64 = 0.006_694_379_990_14;
/// Metres between the terrain's nodes.
const STEP: f64 = 5.0;
/// Metres a building level is high, and a building without a height or levels.
const LEVEL: f64 = 3.0;
const BUILDING: f64 = 6.0;
/// Degrees an untagged pitched roof rises at.
const PITCH: f64 = 35.0;
/// The share of its covering rectangle an outline fills to carry a pitched roof.
const RECTANGULAR: f64 = 0.8;
/// A tree's height in metres, its crown's radius as a share of it, and metres between the
/// trees of a row.
const TREE: f64 = 8.0;
const CROWN: f64 = 0.3;
const SPACING: f64 = 8.0;
/// A hedge's height and width in metres.
const HEDGE: (f64, f64) = (1.5, 1.0);

/// The area surroundings are fetched for: `radius` metres east, west, north and south of
/// `centre`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vicinity {
    pub centre: Location,
    pub radius: f64,
}

/// A place in degrees, as Overpass names it.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Coordinate {
    pub lat: f64,
    pub lon: f64,
}

/// Overpass's answer to a query ending in `out geom`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct MapData {
    #[serde(default)]
    pub elements: Vec<Element>,
}

/// A node at `lat` and `lon`, a way along `geometry`, or a relation of `members`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Element {
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lon: Option<f64>,
    #[serde(default)]
    pub geometry: Vec<Coordinate>,
    #[serde(default)]
    pub members: Vec<Member>,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

/// A relation's way: an `outer` ring is an outline of its own.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Member {
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub geometry: Vec<Coordinate>,
}

/// One zoom-15 terrain tile: 256 by 256 heights in metres above sea level, row by row toward
/// the south from its north-west corner.
#[derive(Debug, Clone, PartialEq)]
pub struct Tile {
    pub x: u32,
    pub y: u32,
    pub heights: Vec<f32>,
}

/// What the sources answered for one area.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Fetched {
    pub tiles: Vec<Tile>,
    pub map: MapData,
}

impl Tile {
    /// The tile at `x` and `y` from its pixels, three bytes each: red, green, blue. A height is
    /// red × 256 + green + blue / 256 − 32768 (Terrarium). `None` unless 256 by 256 pixels.
    #[must_use]
    pub fn terrarium(x: u32, y: u32, rgb: &[u8]) -> Option<Self> {
        if rgb.len() != PIXELS * PIXELS * 3 {
            return None;
        }
        let (pixels, _) = rgb.as_chunks::<3>();
        let heights = pixels
            .iter()
            .map(|[red, green, blue]| {
                let whole = f32::from(*red).mul_add(256.0, f32::from(*green));
                f32::from(*blue).mul_add(1.0 / 256.0, whole) - 32768.0
            })
            .collect();
        Some(Self { x, y, heights })
    }
}

/// Where a coordinate lies on the zoom's grid of tiles, counted from the north-west.
fn mercator(at: Coordinate) -> (f64, f64) {
    let tiles = f64::from(1_u32 << ZOOM);
    let x = (at.lon + 180.0) / 360.0 * tiles;
    let y = (1.0 - at.lat.to_radians().tan().asinh() / PI) / 2.0 * tiles;
    (x, y)
}

/// The whole number at or under `value`, from 0 up.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the zoom's pixels, which fit"
)]
fn whole(value: f64) -> u32 {
    let most = f64::from((1_u32 << ZOOM) * 256 - 1);
    value.floor().clamp(0.0, most) as u32
}

impl Vicinity {
    /// Metres a degree of longitude and one of latitude span at the centre.
    fn degree(&self) -> (f64, f64) {
        let latitude = self.centre.latitude.to_radians();
        let curve = ECCENTRICITY.mul_add(-latitude.sin().powi(2), 1.0);
        let east = EQUATOR / curve.sqrt() * latitude.cos();
        let north = EQUATOR * (1.0 - ECCENTRICITY) / curve.powf(1.5);
        (east.to_radians(), north.to_radians())
    }

    /// What a source is asked for: south, west, north, east, in degrees.
    #[must_use]
    pub fn bounds(&self) -> [f64; 4] {
        let (east, north) = self.degree();
        let (lat, lon) = (self.radius / north, self.radius / east);
        let Location {
            latitude,
            longitude,
        } = self.centre;
        [
            latitude - lat,
            longitude - lon,
            latitude + lat,
            longitude + lon,
        ]
    }

    /// The zoom-15 terrain tiles the bounds touch, by `x` then `y`.
    #[must_use]
    pub fn tiles(&self) -> Vec<(u32, u32)> {
        let [south, west, north, east] = self.bounds();
        let (left, top) = mercator(Coordinate {
            lat: north,
            lon: west,
        });
        let (right, bottom) = mercator(Coordinate {
            lat: south,
            lon: east,
        });
        (whole(left)..=whole(right))
            .flat_map(|x| (whole(top)..=whole(bottom)).map(move |y| (x, y)))
            .collect()
    }

    /// Metres east and north of the centre.
    fn spot(&self, at: Coordinate) -> EastNorth {
        let (east, north) = self.degree();
        [
            (at.lon - self.centre.longitude) * east,
            (at.lat - self.centre.latitude) * north,
        ]
    }

    fn coordinate(&self, [x, y]: EastNorth) -> Coordinate {
        let (east, north) = self.degree();
        Coordinate {
            lat: self.centre.latitude + y / north,
            lon: self.centre.longitude + x / east,
        }
    }

    fn holds(&self, [east, north]: EastNorth) -> bool {
        east.abs() <= self.radius && north.abs() <= self.radius
    }

    fn square(&self) -> [EastNorth; 4] {
        let r = self.radius;
        [[-r, -r], [r, -r], [r, r], [-r, r]]
    }
}

impl Imported {
    /// The document of what was `fetched` for `area`. A building's height is its `height`, else
    /// 3 m a level of `building:levels`, else 6 m; its roof is flat unless `roof:shape` says
    /// gabled or hipped and its outline is close to a rectangle. A tree is 8 m of broadleaf
    /// unless `height` or `leaf_type` say otherwise. Everything but a building is cut at the
    /// radius; terrain without a tile is level.
    #[must_use]
    pub fn new(area: &Vicinity, fetched: &Fetched) -> Self {
        let mut found = Found::default();
        for element in &fetched.map.elements {
            found.take(area, element);
        }
        // Areas under lines, each kind in its own layer.
        found.grounds.sort_by_key(|g| (g.width.is_some(), g.finish));
        Self {
            radius: area.radius,
            buildings: found.buildings,
            trees: found.trees,
            hedges: found.hedges,
            grounds: found.grounds,
            terrain: terrain(area, &fetched.tiles),
            credits: CREDITS.into_iter().map(str::to_owned).collect(),
        }
    }
}

/// The terrain's grid over the area, above the centre's height.
fn terrain(area: &Vicinity, tiles: &[Tile]) -> Terrain {
    let tiles: HashMap<(u32, u32), &Tile> = tiles.iter().map(|t| ((t.x, t.y), t)).collect();
    let each = whole((area.radius / STEP).round());
    let side = 2 * each + 1;
    let height = |spot: EastNorth| sample(&tiles, area.coordinate(spot)).unwrap_or(0.0);
    let centre = height([0.0, 0.0]);
    let node = |at: u32| STEP * (f64::from(at) - f64::from(each));
    let heights = (0..side)
        .flat_map(|row| (0..side).map(move |column| (row, column)))
        .map(|(row, column)| centimetres(height([node(column), node(row)]) - centre))
        .collect();
    Terrain {
        step: STEP,
        side,
        heights,
    }
}

/// The height at a coordinate, between the four pixels around it; a pixel no tile holds counts
/// as the mean of those held. `None` when none is.
fn sample(tiles: &HashMap<(u32, u32), &Tile>, at: Coordinate) -> Option<f64> {
    let (x, y) = mercator(at);
    // A pixel's height is its centre's.
    let (x, y) = (x.mul_add(256.0, -0.5), y.mul_add(256.0, -0.5));
    let (left, top) = (whole(x), whole(y));
    let (fx, fy) = (x - f64::from(left), y - f64::from(top));
    let pixel = |column: u32, row: u32| {
        let tile = tiles.get(&(column / 256, row / 256))?;
        let at = usize::try_from(row % 256).ok()? * PIXELS + usize::try_from(column % 256).ok()?;
        tile.heights.get(at).copied().map(f64::from)
    };
    let corners = [
        (pixel(left, top), (1.0 - fx) * (1.0 - fy)),
        (pixel(left + 1, top), fx * (1.0 - fy)),
        (pixel(left, top + 1), (1.0 - fx) * fy),
        (pixel(left + 1, top + 1), fx * fy),
    ];
    let held: Vec<f64> = corners.iter().filter_map(|(height, _)| *height).collect();
    let mean = held.iter().sum::<f64>() / f64::from(u32::try_from(held.len()).ok()?);
    (!held.is_empty()).then(|| {
        corners
            .iter()
            .map(|(height, weight)| height.unwrap_or(mean) * weight)
            .sum()
    })
}

/// What the elements turn into, in their order.
#[derive(Default)]
struct Found {
    buildings: Vec<Building>,
    trees: Vec<Tree>,
    hedges: Vec<Hedge>,
    grounds: Vec<Patch>,
}

type Tags = BTreeMap<String, String>;

fn tag<'a>(tags: &'a Tags, key: &str) -> Option<&'a str> {
    tags.get(key).map(String::as_str)
}

/// A tag's metres: a number, with or without an `m` after it.
fn metres(text: &str) -> Option<f64> {
    let text = text.trim();
    let number = text.strip_suffix('m').map_or(text, str::trim_end);
    number
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}

fn measured(tags: &Tags, key: &str) -> Option<f64> {
    tag(tags, key).and_then(metres)
}

impl Found {
    fn take(&mut self, area: &Vicinity, element: &Element) {
        let tags = &element.tags;
        let lines = lines(area, element);
        if tag(tags, "building").is_some_and(|kind| kind != "no") {
            if tag(tags, "location") != Some("underground") {
                self.build(area, tags, &lines);
            }
            return;
        }
        match (tag(tags, "natural"), tag(tags, "barrier")) {
            (Some("tree"), _) => self.plant(area, tags, &single(area, element)),
            (Some("tree_row"), _) => self.plant(area, tags, &spaced(&lines)),
            (_, Some("hedge")) => self.hedge(area, tags, &lines),
            _ => self.ground(area, tags, &lines),
        }
    }

    fn build(&mut self, area: &Vicinity, tags: &Tags, lines: &[Vec<EastNorth>]) {
        for outline in lines.iter().filter_map(|line| ring(line)) {
            if !shape::overlap(&outline, &area.square()) {
                continue;
            }
            let id = u32::try_from(self.buildings.len()).unwrap_or(u32::MAX);
            self.buildings.push(building(id, tags, outline));
        }
    }

    fn plant(&mut self, area: &Vicinity, tags: &Tags, spots: &[EastNorth]) {
        let height = measured(tags, "height").unwrap_or(TREE);
        let radius = measured(tags, "diameter_crown").map_or(height * CROWN, |d| d / 2.0);
        let crown = match tag(tags, "leaf_type") {
            Some("needleleaved") => Crown::Conifer,
            _ => Crown::Broadleaf,
        };
        let trees = spots.iter().filter(|spot| area.holds(**spot));
        self.trees.extend(trees.map(|spot| Tree {
            at: spot.map(centimetres),
            height,
            radius: centimetres(radius),
            crown,
        }));
    }

    fn hedge(&mut self, area: &Vicinity, tags: &Tags, lines: &[Vec<EastNorth>]) {
        let stretches = lines
            .iter()
            .flat_map(|line| shape::clip_line(line, area.radius));
        self.hedges.extend(stretches.map(|points| Hedge {
            points: rounded(points),
            height: measured(tags, "height").unwrap_or(HEDGE.0),
            width: measured(tags, "width").unwrap_or(HEDGE.1),
        }));
    }

    fn ground(&mut self, area: &Vicinity, tags: &Tags, lines: &[Vec<EastNorth>]) {
        let Some((finish, width)) = finish(tags) else {
            return;
        };
        let is_area = width.is_none() || tag(tags, "area") == Some("yes");
        let width = width.map(|usual| measured(tags, "width").unwrap_or(usual));
        for line in lines {
            let outline = ring(line).filter(|_| is_area);
            let stretches = match (outline, width) {
                (Some(outline), _) => vec![(shape::clip_area(&outline, area.radius), None)],
                (None, Some(_)) => {
                    let cut = shape::clip_line(line, area.radius);
                    cut.into_iter().map(|points| (points, width)).collect()
                }
                (None, None) => Vec::new(),
            };
            let kept = stretches
                .into_iter()
                .filter(|(points, width)| width.is_some() || shape::area(points) > 0.0);
            self.grounds.extend(kept.map(|(points, width)| Patch {
                finish,
                outline: rounded(points),
                width,
            }));
        }
    }
}

fn rounded(points: Vec<EastNorth>) -> Vec<EastNorth> {
    points.into_iter().map(|p| p.map(centimetres)).collect()
}

/// A way's line, or each outer ring of a relation, in metres.
fn lines(area: &Vicinity, element: &Element) -> Vec<Vec<EastNorth>> {
    let line = |geometry: &[Coordinate]| geometry.iter().map(|at| area.spot(*at)).collect();
    if element.members.is_empty() {
        return vec![line(&element.geometry)];
    }
    element
        .members
        .iter()
        .filter(|member| matches!(member.role.as_str(), "outer" | ""))
        .map(|member| line(&member.geometry))
        .collect()
}

fn single(area: &Vicinity, element: &Element) -> Vec<EastNorth> {
    let at = element
        .lat
        .zip(element.lon)
        .map(|(lat, lon)| area.spot(Coordinate { lat, lon }));
    at.into_iter().collect()
}

/// A closed line's corners, counter-clockwise, without the one that closes it.
fn ring(line: &[EastNorth]) -> Option<Vec<EastNorth>> {
    let (last, corners) = line.split_last()?;
    let closed = corners.first() == Some(last) && corners.len() >= 3;
    closed.then(|| shape::counter_clockwise(corners.to_vec()))
}

/// Spots every 8 m or so along each line, from end to end.
fn spaced(lines: &[Vec<EastNorth>]) -> Vec<EastNorth> {
    lines.iter().flat_map(|line| along(line)).collect()
}

fn along(line: &[EastNorth]) -> Vec<EastNorth> {
    let length = |a: EastNorth, b: EastNorth| (b[0] - a[0]).hypot(b[1] - a[1]);
    let stretches = || {
        line.windows(2)
            .filter_map(|pair| Some((*pair.first()?, *pair.get(1)?)))
    };
    let total: f64 = stretches().map(|(a, b)| length(a, b)).sum();
    let gaps = whole((total / SPACING).round()).max(1);
    (0..=gaps)
        .filter_map(|at| {
            let mut left = total * f64::from(at) / f64::from(gaps);
            for (a, b) in stretches() {
                let span = length(a, b);
                if left <= span + 1e-9 && span > 0.0 {
                    let t = left / span;
                    return Some([t.mul_add(b[0] - a[0], a[0]), t.mul_add(b[1] - a[1], a[1])]);
                }
                left -= span;
            }
            None
        })
        .collect()
}

fn building(id: u32, tags: &Tags, outline: Vec<EastNorth>) -> Building {
    let top = measured(tags, "height");
    let walls = measured(tags, "building:levels").map(|levels| levels * LEVEL);
    let hipped = match tag(tags, "roof:shape") {
        Some("gabled") => Some(false),
        Some("hipped") => Some(true),
        _ => None,
    };
    let rectangle = shape::rectangle(&outline)
        .filter(|r| shape::area(&outline) / shape::area(r) >= RECTANGULAR);
    let (Some(hipped), Some(rectangle)) = (hipped, rectangle) else {
        return Building {
            id,
            outline: rounded(outline),
            eave: centimetres(top.or(walls).unwrap_or(BUILDING)),
            roof: Roofing::Flat,
        };
    };
    let [_, [bx, by], [cx, cy], _] = rectangle;
    let short = (cx - bx).hypot(cy - by);
    let rise =
        measured(tags, "roof:height").unwrap_or_else(|| PITCH.to_radians().tan() * short / 2.0);
    // A tagged height is the ridge's.
    let eave = top.map_or_else(
        || walls.unwrap_or(BUILDING),
        |top| (top - rise).max(top / 2.0),
    );
    let rise = centimetres(top.map_or(rise, |top| top - eave));
    Building {
        id,
        outline: rounded(rectangle.to_vec()),
        eave: centimetres(eave),
        roof: if hipped {
            Roofing::Hipped { rise }
        } else {
            Roofing::Gable { rise }
        },
    }
}

/// What ground the tags name, and for a line its width in metres.
fn finish(tags: &Tags) -> Option<(PatchFinish, Option<f64>)> {
    if let Some(kind) = tag(tags, "highway") {
        return road(kind);
    }
    if let Some(kind) = tag(tags, "waterway") {
        let width = match kind {
            "river" => 8.0,
            "canal" => 6.0,
            "stream" => 1.5,
            "ditch" | "drain" => 1.0,
            _ => return None,
        };
        return Some((PatchFinish::Water, Some(width)));
    }
    let area = match (
        tag(tags, "natural"),
        tag(tags, "landuse"),
        tag(tags, "leisure"),
    ) {
        (Some("water"), _, _) => PatchFinish::Water,
        (Some("wood" | "scrub"), _, _) | (_, Some("forest"), _) => PatchFinish::Wood,
        (Some("grassland" | "heath"), _, _)
        | (_, Some("grass" | "meadow" | "village_green" | "recreation_ground" | "flowerbed"), _)
        | (_, _, Some("park" | "garden" | "pitch" | "playground")) => PatchFinish::Grass,
        (_, Some("farmland" | "orchard" | "vineyard" | "allotments"), _) => PatchFinish::Field,
        _ => return None,
    };
    Some((area, None))
}

fn road(kind: &str) -> Option<(PatchFinish, Option<f64>)> {
    let (finish, width) = match kind {
        "motorway" | "trunk" | "primary" => (PatchFinish::Road, 7.0),
        "secondary" | "tertiary" => (PatchFinish::Road, 6.0),
        "residential" | "unclassified" | "living_street" => (PatchFinish::Road, 5.0),
        "service" => (PatchFinish::Road, 3.0),
        "track" => (PatchFinish::Path, 2.5),
        "footway" | "path" | "cycleway" | "steps" | "pedestrian" | "bridleway" => {
            (PatchFinish::Path, 1.5)
        }
        _ => return None,
    };
    Some((finish, Some(width)))
}
