//! The sources through their one interface, against a recorded tile and a recorded Overpass
//! answer for a public square (terrain © offene Daten Österreichs, map © OpenStreetMap
//! contributors), and the fetch task through the feature module. No test reaches the network.

use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use sunreye_pv as pv;
use tokio::sync::watch;

use super::fake::{Fake, Recorded};
use super::{Ask, Https, Load, Overpass, Phase, Source, Surroundings, TerrainTiles, Web};
use crate::location::Location;

const TILE: &[u8] = include_bytes!("../../fixtures/surroundings/terrarium-15-17789-11515.png");
const TILE_URL: &str = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/17789/11515.png";
const MAP: &[u8] = include_bytes!("../../../pv/fixtures/surroundings/overpass.json");
const OVERPASS: &str = "https://overpass-api.de/api/interpreter";

/// The recorded answers' centre: a public square inside tile 17789/11515.
const SQUARE: pv::Vicinity = pv::Vicinity {
    centre: pv::Location {
        latitude: 47.0739,
        longitude: 15.4413,
    },
    radius: 100.0,
};

fn close(actual: f32, expected: f32) -> bool {
    (actual - expected).abs() < 1e-3
}

#[test]
fn terrain_tiles_answer_the_heights_of_each_tile_the_area_touches() {
    let web = Recorded::new();
    web.serve(TILE_URL, TILE);
    let mut fetched = pv::Fetched::default();

    TerrainTiles::new(Arc::<Recorded>::clone(&web))
        .fetch(&SQUARE, &mut fetched)
        .unwrap();

    let [tile] = fetched.tiles.as_slice() else {
        panic!("one tile");
    };
    assert_eq!((tile.x, tile.y, tile.heights.len()), (17789, 11515, 65536));
    // Decoded apart from this crate: rows of 256 from the north-west corner.
    for ((column, row), metres) in [
        ((0, 0), 384.167_97),
        ((255, 0), 365.085_94),
        ((100, 37), 372.9375),
        ((128, 128), 369.132_8),
        ((0, 255), 349.984_38),
        ((255, 255), 356.730_47),
    ] {
        let height = tile.heights[row * 256 + column];
        assert!(close(height, metres), "{column}/{row}: {height}");
    }
    let asked = web.asked();
    assert_eq!(
        asked,
        vec![Ask {
            url: TILE_URL.to_owned(),
            form: None
        }]
    );
}

#[test]
fn a_tile_that_is_missing_or_no_terrarium_png_fails_the_fetch() {
    let web = Recorded::new();
    let tiles = TerrainTiles::new(Arc::<Recorded>::clone(&web));
    let mut fetched = pv::Fetched::default();

    let missing = tiles.fetch(&SQUARE, &mut fetched);
    web.serve(TILE_URL, &TILE[..2000]);
    let cut_short = tiles.fetch(&SQUARE, &mut fetched);
    web.serve(TILE_URL, b"<html>".to_vec());
    let page = tiles.fetch(&SQUARE, &mut fetched);

    assert!(missing.is_err() && cut_short.is_err() && page.is_err());
    assert_eq!(fetched.tiles, vec![]);
}

#[test]
fn overpass_is_asked_for_the_areas_bounds_and_answers_its_elements() {
    let web = Recorded::new();
    web.serve(OVERPASS, MAP);
    let mut fetched = pv::Fetched::default();

    Overpass::new(Arc::<Recorded>::clone(&web))
        .fetch(&SQUARE, &mut fetched)
        .unwrap();

    // A tree node keeps its tags.
    assert_eq!(fetched.map.elements.len(), ELEMENTS);
    let tree = &fetched.map.elements[0];
    assert_eq!(tree.tags.get("natural").map(String::as_str), Some("tree"));
    let [ask] = web.asked().try_into().unwrap();
    assert_eq!(ask.url, OVERPASS);
    let (field, query) = ask.form.unwrap();
    assert_eq!(field, "data");
    // South, west, north, east: 100 m around the square.
    let (head, rest) = query.split_once("];").unwrap();
    let bounds: Vec<f64> = head
        .strip_prefix("[out:json][timeout:25][bbox:")
        .unwrap()
        .split(',')
        .map(|degrees| degrees.parse().unwrap())
        .collect();
    let expected = [47.073_000_5, 15.439_983_4, 47.074_799_5, 15.442_616_6];
    assert_eq!(bounds.len(), 4);
    for (actual, expected) in bounds.iter().zip(expected) {
        assert!((actual - expected).abs() < 2e-6, "{actual} for {expected}");
    }
    let query = rest;
    for wanted in [
        r#"way["building"];"#,
        r#"relation["building"];"#,
        r#"node["natural"="tree"];"#,
        r#"way["natural"="tree_row"];"#,
        r#"way["barrier"="hedge"];"#,
        r#"way["highway"];"#,
        r#"way["waterway"];"#,
        r#"way["landuse"];"#,
    ] {
        assert!(query.contains(wanted), "{wanted} in {query}");
    }
    assert!(query.ends_with("out geom;"));
}

#[test]
fn an_overpass_answer_that_is_no_json_fails_the_fetch() {
    let web = Recorded::new();
    web.serve(OVERPASS, b"<html>rate limited</html>".to_vec());
    let mut fetched = pv::Fetched::default();

    let failed = Overpass::new(web).fetch(&SQUARE, &mut fetched);

    assert!(failed.is_err());
}

/// Answers one HTTP request on a local socket with `body` and returns what it was sent.
fn local(body: &'static [u8]) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/api/interpreter", listener.local_addr().unwrap());
    let served = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        // Until the head and, for a form, its body have arrived.
        loop {
            let read = stream.read(&mut buffer).unwrap();
            request.extend_from_slice(&buffer[..read]);
            let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
            let done = text.split_once("\r\n\r\n").is_some_and(|(head, body)| {
                let length = head
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .map_or(0, |n| n.trim().parse::<usize>().unwrap());
                body.len() >= length
            });
            if done || read == 0 {
                break;
            }
        }
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        String::from_utf8(request).unwrap()
    });
    (url, served)
}

#[test]
fn the_web_names_sunreye_alone_and_posts_a_form() {
    let (url, served) = local(b"answer");
    let ask = Ask {
        url,
        form: Some(("data", "[out:json];node[\"natural\"=\"tree\"];".to_owned())),
    };

    let answer = Https.ask(&ask).unwrap();
    let request = served.join().unwrap();

    assert_eq!(answer, b"answer");
    assert!(request.starts_with("POST /api/interpreter HTTP/1.1\r\n"));
    let agents: Vec<&str> = request
        .lines()
        .filter(|line| line.to_ascii_lowercase().starts_with("user-agent:"))
        .collect();
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].split_once(": ").unwrap().1, "SunReye");
    assert!(request.ends_with("data=%5Bout%3Ajson%5D%3Bnode%5B%22natural%22%3D%22tree%22%5D%3B"));
    let (url, served) = local(b"tile");
    assert_eq!(Https.ask(&Ask { url, form: None }).unwrap(), b"tile");
    assert!(
        served
            .join()
            .unwrap()
            .starts_with("GET /api/interpreter HTTP/1.1\r\n")
    );
}

/// How many elements the recording holds.
const ELEMENTS: usize = 190;

fn recorded() -> pv::Fetched {
    let rgb: Vec<u8> = (0..256 * 256).flat_map(|_| [0x81, 0x80, 0x00]).collect();
    pv::Fetched {
        tiles: vec![pv::Tile::terrarium(17789, 11515, &rgb).unwrap()],
        map: serde_json::from_slice(MAP).unwrap(),
    }
}

fn here() -> watch::Receiver<Option<Location>> {
    let location = Location {
        latitude: 47.07,
        longitude: 15.44,
    };
    watch::channel(Some(location)).1
}

/// The module over `dir` with one source that fails the fetches listed in `fail`.
fn module(
    dir: &std::path::Path,
    location: watch::Receiver<Option<Location>>,
    fail: &[bool],
) -> (Surroundings, Arc<std::sync::Mutex<Vec<pv::Vicinity>>>) {
    let (source, asked) = Fake::new(recorded(), fail);
    let sources: Vec<Box<dyn Source>> = vec![Box::new(source)];
    (
        Surroundings::spawn(dir.join("surroundings"), sources, location),
        asked,
    )
}

fn load(radius: u16) -> Load {
    Load {
        radius,
        latitude: None,
        longitude: None,
    }
}

/// Lets the fetch task finish.
async fn settled(surroundings: &Surroundings) -> super::SurroundingsStatus {
    for _ in 0..500 {
        let status = surroundings.status();
        if status.state != Phase::Fetching {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the fetch never ended");
}

#[tokio::test]
async fn a_load_fetches_in_its_own_task_and_stores_the_document_under_its_sha_256() {
    let dir = tempfile::tempdir().unwrap();
    let (surroundings, asked) = module(dir.path(), here(), &[]);

    let started = surroundings.load(load(100)).unwrap();
    let status = settled(&surroundings).await;

    // The request returns at once; the task fetches around the plant's location.
    assert_eq!(started.state, Phase::Fetching);
    assert_eq!(status.state, Phase::Ready);
    let [area] = asked.lock().unwrap().clone().try_into().unwrap();
    assert_eq!(
        (area.centre.latitude, area.centre.longitude, area.radius),
        (47.07, 15.44, 100.0)
    );
    let id = status.document.unwrap();
    let file = std::fs::read(dir.path().join("surroundings").join(format!("{id}.json"))).unwrap();
    let digest = ring::digest::digest(&ring::digest::SHA256, &file);
    assert_eq!(crate::auth::hex(digest.as_ref()), id);
    let stored: pv::Imported = serde_json::from_slice(&file).unwrap();
    assert_eq!(stored, pv::Imported::new(&area, &recorded()));
    assert_eq!(*surroundings.documents().read(&id).await.unwrap(), stored);
}

#[tokio::test]
async fn a_more_exact_centre_given_with_the_load_is_fetched_instead_and_kept_nowhere() {
    let dir = tempfile::tempdir().unwrap();
    let (surroundings, asked) = module(dir.path(), watch::channel(None).1, &[]);
    let exact = Load {
        radius: 300,
        latitude: Some(47.073_912),
        longitude: Some(15.441_287),
    };

    surroundings.load(exact).unwrap();
    let status = settled(&surroundings).await;

    let [area] = asked.lock().unwrap().clone().try_into().unwrap();
    assert_eq!(
        (area.centre.latitude, area.centre.longitude),
        (47.073_912, 15.441_287)
    );
    let id = status.document.clone().unwrap();
    let file = std::fs::read(dir.path().join("surroundings").join(format!("{id}.json")));
    let stored: serde_json::Value = serde_json::from_slice(&file.unwrap()).unwrap();
    // Metres and credits; the status its state and the digest.
    assert_eq!(stored["buildings"].as_array().unwrap().len(), 31);
    let keys: Vec<&String> = stored.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "buildings",
            "credits",
            "grounds",
            "hedges",
            "radius",
            "terrain",
            "trees"
        ]
    );
    assert_eq!(
        serde_json::to_value(&status).unwrap(),
        serde_json::json!({ "state": "ready", "document": id })
    );
}

#[tokio::test]
async fn a_fetch_that_fails_says_why_and_keeps_the_last_document() {
    let dir = tempfile::tempdir().unwrap();
    let (surroundings, _) = module(dir.path(), here(), &[false, true]);
    surroundings.load(load(100)).unwrap();
    let first = settled(&surroundings).await;

    surroundings.load(load(200)).unwrap();
    let failed = settled(&surroundings).await;

    assert_eq!(failed.state, Phase::Failed);
    assert_eq!(failed.error.as_deref(), Some("offline"));
    assert_eq!(failed.document, first.document);
    let id = first.document.unwrap();
    assert!(surroundings.documents().read(&id).await.is_some());
    assert_eq!(
        std::fs::read_dir(dir.path().join("surroundings"))
            .unwrap()
            .count(),
        1
    );
}

#[tokio::test]
async fn a_load_is_refused_for_another_radius_without_a_location_or_while_one_runs() {
    let dir = tempfile::tempdir().unwrap();
    let (nowhere, _) = module(dir.path(), watch::channel(None).1, &[]);
    let (surroundings, asked) = module(dir.path(), here(), &[]);
    let half = Load {
        latitude: Some(47.0),
        ..load(200)
    };
    let off = Load {
        latitude: Some(91.0),
        longitude: Some(0.0),
        ..load(200)
    };

    assert_eq!(
        surroundings.load(load(150)).unwrap_err().code,
        crate::api::Code::SurroundingsRadius
    );
    assert_eq!(
        nowhere.load(load(200)).unwrap_err().code,
        crate::api::Code::SurroundingsLocation
    );
    assert_eq!(
        surroundings.load(half).unwrap_err().code,
        crate::api::Code::SurroundingsLocation
    );
    assert_eq!(
        surroundings.load(off).unwrap_err().code,
        crate::api::Code::SurroundingsLocation
    );
    assert!(asked.lock().unwrap().is_empty());
    surroundings.load(load(300)).unwrap();
    assert_eq!(
        surroundings.load(load(300)).unwrap_err().code,
        crate::api::Code::SurroundingsBusy
    );
    assert_eq!(settled(&surroundings).await.state, Phase::Ready);
}

#[tokio::test]
async fn a_document_is_read_by_its_digest_alone() {
    let dir = tempfile::tempdir().unwrap();
    let (surroundings, _) = module(dir.path(), here(), &[]);
    std::fs::write(dir.path().join("secret.json"), "{}").unwrap();
    let documents = surroundings.documents();

    assert!(documents.read("../secret").await.is_none());
    assert!(documents.read(&"0".repeat(64)).await.is_none());
}
