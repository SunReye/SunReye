//! Where surroundings come from (ADR 20): the web as a source reaches it, and the two sources,
//! terrain tiles and OpenStreetMap through Overpass.

use std::sync::Arc;
use std::time::Duration;

use sunreye_pv as pv;

use super::png;

const TIMEOUT: Duration = Duration::from_secs(60);
/// The most of an answer read: a dense square kilometre of map data stays far under it.
const LIMIT: u64 = 64 << 20;
/// All a host learns of who asks.
const AGENT: &str = "SunReye";
const TILES: &str = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const OVERPASS: &str = "https://overpass-api.de/api/interpreter";
/// What Overpass is asked for inside the bounds, each with its geometry.
const WANTED: &str = r#"(way["building"];relation["building"];node["natural"="tree"];way["natural"="tree_row"];way["barrier"="hedge"];way["highway"];way["natural"~"^(water|wood|scrub|grassland|heath)$"];relation["natural"="water"];way["waterway"];way["landuse"];way["leisure"~"^(park|garden|pitch|playground)$"];);out geom;"#;

/// A request to an open data host: a GET of `url`, or a POST of one form field to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ask {
    pub url: String,
    pub form: Option<(&'static str, String)>,
}

/// The web as a source reaches it: HTTPS, or recorded answers in tests. Blocking.
pub trait Web: Send + Sync + std::fmt::Debug {
    /// The answer's body.
    ///
    /// # Errors
    /// The host could not be reached or refused the request.
    fn ask(&self, ask: &Ask) -> Result<Vec<u8>, String>;
}

/// Asks over HTTPS with `ureq` (ADR 2), naming `SunReye` alone.
#[derive(Debug, Clone, Copy, Default)]
pub struct Https;

impl Web for Https {
    fn ask(&self, ask: &Ask) -> Result<Vec<u8>, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .user_agent(AGENT)
            .build()
            .into();
        let answered = match &ask.form {
            Some((field, value)) => agent.post(&ask.url).send_form([(*field, value.as_str())]),
            None => agent.get(&ask.url).call(),
        };
        answered
            .and_then(|mut response| response.body_mut().with_config().limit(LIMIT).read_to_vec())
            .map_err(|e| e.to_string())
    }
}

/// A source of open map data. Blocking: the fetch task runs it on Tokio's blocking pool.
pub trait Source: Send + Sync + std::fmt::Debug {
    /// Adds what it holds for `area` to `fetched`.
    ///
    /// # Errors
    /// The source could not be reached, or its answer is not what it serves.
    fn fetch(&self, area: &pv::Area, fetched: &mut pv::Fetched) -> Result<(), String>;
}

/// The open Terrain Tiles on AWS: keyless, heights in the Terrarium encoding, at zoom 15.
#[derive(Debug)]
pub struct TerrainTiles(Arc<dyn Web>);

impl TerrainTiles {
    #[must_use]
    pub fn new(web: Arc<dyn Web>) -> Self {
        Self(web)
    }
}

impl Source for TerrainTiles {
    fn fetch(&self, area: &pv::Area, fetched: &mut pv::Fetched) -> Result<(), String> {
        let mut tiles = Vec::new();
        for (x, y) in area.tiles() {
            let ask = Ask {
                url: format!("{TILES}/15/{x}/{y}.png"),
                form: None,
            };
            // No error names a tile: the core's log would then tell where the plant stands.
            let body = self.0.ask(&ask).map_err(|e| format!("terrain: {e}"))?;
            let tile = png::rgb(&body).and_then(|rgb| pv::Tile::terrarium(x, y, &rgb));
            tiles.push(tile.ok_or("terrain: the answer is no Terrarium tile")?);
        }
        fetched.tiles.extend(tiles);
        Ok(())
    }
}

/// OpenStreetMap through the Overpass API: keyless.
#[derive(Debug)]
pub struct Overpass(Arc<dyn Web>);

impl Overpass {
    #[must_use]
    pub fn new(web: Arc<dyn Web>) -> Self {
        Self(web)
    }
}

impl Source for Overpass {
    fn fetch(&self, area: &pv::Area, fetched: &mut pv::Fetched) -> Result<(), String> {
        let [south, west, north, east] = area.bounds();
        let query = format!(
            "[out:json][timeout:25][bbox:{south:.6},{west:.6},{north:.6},{east:.6}];{WANTED}"
        );
        let ask = Ask {
            url: OVERPASS.to_owned(),
            form: Some(("data", query)),
        };
        let body = self.0.ask(&ask).map_err(|e| format!("map: {e}"))?;
        let map: pv::MapData =
            serde_json::from_slice(&body).map_err(|_| "map: the answer is no Overpass JSON")?;
        fetched.map.elements.extend(map.elements);
        Ok(())
    }
}
