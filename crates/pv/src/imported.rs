//! Imported surroundings (ADR 20): the terrain, neighbouring buildings, trees and ground around
//! the plant, fetched once from open map data and kept as one document.
//!
//! The document is in metres east and north of the place it was fetched for and holds no
//! coordinate of it, so a viewer who reads it learns no location. The scene names it and says
//! where it lies; [`Scene::around`](crate::Scene::around) stands it there.

mod fetch;
mod place;
mod shape;

use serde::{Deserialize, Serialize};

use crate::Crown;

pub use fetch::{Area, Coordinate, Element, Fetched, MapData, Member, Tile};
pub use place::{Around, Draped, Relief, Standing};
pub use shape::Spot;

/// "© OpenStreetMap contributors", then the terrain sources' credits as the Terrain Tiles
/// dataset requires them: shown while the surroundings are drawn, and on the About page.
pub const CREDITS: [&str; 12] = [
    "© OpenStreetMap contributors",
    "ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded \
     under National Science Foundation awards 1043681, 1559691, and 1542736",
    "Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017",
    "Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich",
    "Canada terrain data contains information licensed under the Open Government Licence – \
     Canada",
    "Europe terrain data produced using Copernicus data and information funded by the European \
     Union - EU-DEM layers",
    "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration",
    "Mexico terrain data source: INEGI, Continental relief, 2016",
    "New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand \
     and the New Zealand Government (All rights reserved)",
    "Norway terrain data © Kartverket",
    "United Kingdom terrain data © Environment Agency copyright and/or database right 2015. \
     All rights reserved",
    "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of \
     the U.S. Geological Survey",
];

/// The surroundings of one place: everything in metres east and north of it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Imported {
    /// Metres the area reaches from its centre, east, west, north and south.
    pub radius: f64,
    pub buildings: Vec<Building>,
    pub trees: Vec<Tree>,
    pub hedges: Vec<Hedge>,
    /// Drawn in order, each over the last. They never shade.
    pub grounds: Vec<Patch>,
    pub terrain: Terrain,
    /// Who the data is owed to, shown wherever it is drawn.
    pub credits: Vec<String>,
}

/// A neighbouring building: walls up from its outline under one roof.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Building {
    /// Its number in this document, which a scene hides it by.
    pub id: u32,
    /// Counter-clockwise seen from above; under a pitched roof a rectangle whose first side is
    /// a long one.
    #[cfg_attr(feature = "openapi", schema(value_type = Vec<Vec<f64>>))]
    pub outline: Vec<Spot>,
    /// The walls' height.
    pub eave: f64,
    pub roof: Roofing,
}

/// A building's roof; `rise` is the ridge's height over the eaves.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Roofing {
    Flat,
    /// Its ridge runs along the long sides.
    Gable {
        rise: f64,
    },
    Hipped {
        rise: f64,
    },
}

/// A single tree, like a tree obstacle.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Tree {
    #[cfg_attr(feature = "openapi", schema(value_type = Vec<f64>))]
    pub at: Spot,
    pub height: f64,
    /// Its crown's.
    pub radius: f64,
    pub crown: Crown,
}

/// A hedge along a line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Hedge {
    #[cfg_attr(feature = "openapi", schema(value_type = Vec<Vec<f64>>))]
    pub points: Vec<Spot>,
    pub height: f64,
    pub width: f64,
}

/// A piece of ground: an area inside its outline, or with a `width` a line through it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Patch {
    pub finish: PatchFinish,
    #[cfg_attr(feature = "openapi", schema(value_type = Vec<Vec<f64>>))]
    pub outline: Vec<Spot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
}

/// In the order they are drawn, each over the last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum PatchFinish {
    Field,
    Grass,
    Wood,
    Water,
    Path,
    Road,
}

/// Heights in metres above the centre's, on a square grid of `side` nodes a side, `step` apart,
/// row by row toward the north from the south-west corner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Terrain {
    pub step: f64,
    pub side: u32,
    pub heights: Vec<f64>,
}

/// The imported surroundings a scene draws (ADR 20): the document and where it lies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct Import {
    /// The document's SHA-256 in hex.
    pub document: String,
    /// Where the document's centre lies in the scene's frame.
    pub x: f64,
    pub z: f64,
    /// Degrees clockwise seen from above, from where true north puts it.
    pub turn: f64,
    /// The ids of the buildings left out.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden: Vec<u32>,
}

/// To the centimetre, as the document keeps its metres.
pub fn centimetres(metres: f64) -> f64 {
    (metres * 100.0).round() / 100.0
}
