//! v3's `sunreye-archive`, format version 1: a ustar stream inside gzip whose NDJSON members are
//! gzipped again. Read front to back, one member and one line at a time.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::path::Path;

use flate2::read::GzDecoder;
use jiff::Timestamp;
use serde::Deserialize;

use super::Error;

const BLOCK: u64 = 512;
const FORMAT: &str = "sunreye-archive";
/// The newest format this build reads.
const VERSION: u32 = 1;
/// The largest JSON member read whole; v3's `config.json` holds a few profiles.
const LIMIT: u64 = 16 << 20;
const MANIFEST: &str = "manifest.json";
const CONFIG: &str = "config.json";
const READINGS: &str = "readings.ndjson.gz";

/// A v3 device, by its slug, and the id of its v3 profile.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub slug: String,
    pub profile_id: String,
}

/// What `config.json` holds that the import reads.
#[derive(Debug, Default)]
pub struct Config {
    pub devices: Vec<Device>,
    /// The installed v3 profiles' documents, by id.
    pub profiles: HashMap<String, serde_json::Value>,
}

/// The tier a reading came from: a v3 poll, or a bucket of the given width.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Raw,
    Minute,
    Hourly,
    Daily,
}

/// One line of `readings.ndjson`.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub time: Timestamp,
    pub device: String,
    pub metric: String,
    pub value: f64,
    pub hold_ms: Option<i64>,
    pub tier: Tier,
}

/// Reads the archive at `path`: the manifest is checked first, `config` reads the configuration,
/// then `reading` each reading with what `config` made of it. A member out of that order is
/// refused. Reading stops after the configuration when `config` makes nothing of it.
///
/// # Errors
/// The file is not a v1 archive, a member is cut short or does not read, or a callback failed.
pub fn read<C>(
    path: &Path,
    config: impl FnOnce(Config) -> Result<Option<C>, Error>,
    mut reading: impl FnMut(&C, Line) -> Result<(), Error>,
) -> Result<(), Error> {
    let file = File::open(path).map_err(|e| broken("archive", e))?;
    let mut tar = GzDecoder::new(BufReader::new(file));
    let mut config = Some(config);
    let mut read = None;
    let mut manifest = false;
    while let Some((name, size)) = header(&mut tar)? {
        let mut body = (&mut tar).take(size);
        match name.as_str() {
            MANIFEST => {
                check(&text(&name, &mut body)?)?;
                manifest = true;
            }
            _ if !manifest => return Err(broken(&name, "comes before the manifest")),
            CONFIG => {
                let parse = config.take().ok_or_else(|| broken(&name, "repeated"))?;
                read = parse(configuration(&text(&name, &mut body)?)?)?;
                if read.is_none() {
                    return Ok(());
                }
            }
            READINGS => {
                let read = read
                    .as_ref()
                    .ok_or_else(|| broken(&name, "comes before the configuration"))?;
                lines(&name, GzDecoder::new(&mut body), |line| reading(read, line))?;
            }
            _ => {}
        }
        io::copy(&mut body, &mut io::sink()).map_err(|e| broken(&name, e))?;
        let pad = size.next_multiple_of(BLOCK) - size;
        let skipped = io::copy(&mut (&mut tar).take(pad), &mut io::sink());
        if skipped.map_err(|e| broken(&name, e))? < pad {
            return Err(broken(&name, "the archive is cut short"));
        }
    }
    if manifest {
        Ok(())
    } else {
        Err(broken(MANIFEST, "missing"))
    }
}

/// The devices the archive at `path` holds; only its manifest and configuration are read.
///
/// # Errors
/// The file is not a v1 archive, or its configuration does not read.
pub fn devices(path: &Path) -> Result<Vec<Device>, Error> {
    let mut devices = None;
    read(
        path,
        |config| {
            devices = Some(config.devices);
            Ok(None::<()>)
        },
        |(), _| Ok(()),
    )?;
    devices.ok_or_else(|| broken(CONFIG, "missing"))
}

fn broken(member: &str, reason: impl std::fmt::Display) -> Error {
    Error::Archive(format!("{member}: {reason}"))
}

/// The next member's name and size; none at the end marker.
fn header(tar: &mut impl Read) -> Result<Option<(String, u64)>, Error> {
    let mut block = [0_u8; 512];
    tar.read_exact(&mut block)
        .map_err(|_| broken("archive", "the archive is cut short"))?;
    if block.iter().all(|&b| b == 0) {
        return Ok(None);
    }
    let field = |from: usize, to: usize| {
        let bytes = block.get(from..to).unwrap_or_default();
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        String::from_utf8_lossy(bytes.get(..end).unwrap_or_default())
            .trim()
            .to_owned()
    };
    let sum: u32 = (0..512)
        .zip(block)
        .map(|(i, b)| {
            if (148..156).contains(&i) {
                32
            } else {
                u32::from(b)
            }
        })
        .sum();
    if u32::from_str_radix(&field(148, 156), 8).ok() != Some(sum) {
        return Err(broken("archive", "a member header is corrupt"));
    }
    let name = field(0, 100);
    let size = u64::from_str_radix(&field(124, 136), 8)
        .map_err(|_| broken(&name, "its size does not read"))?;
    Ok(Some((name, size)))
}

fn text(name: &str, body: &mut impl Read) -> Result<String, Error> {
    let mut bytes = Vec::new();
    body.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| broken(name, e))?;
    if bytes.len() as u64 > LIMIT {
        return Err(broken(name, "too large"));
    }
    String::from_utf8(bytes).map_err(|_| broken(name, "not UTF-8"))
}

/// Refuses anything but a `sunreye-archive` of a version this build reads.
fn check(manifest: &str) -> Result<(), Error> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Manifest {
        format: String,
        format_version: u32,
    }
    let manifest: Manifest = serde_json::from_str(manifest).map_err(|e| broken(MANIFEST, e))?;
    if manifest.format != FORMAT {
        return Err(broken(MANIFEST, "not a sunreye-archive"));
    }
    if manifest.format_version > VERSION {
        return Err(broken(
            MANIFEST,
            format!(
                "format version {} is newer than {VERSION}",
                manifest.format_version
            ),
        ));
    }
    Ok(())
}

fn configuration(text: &str) -> Result<Config, Error> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct File {
        plant: Option<Plant>,
        #[serde(default)]
        installed_profiles: Vec<Installed>,
    }
    #[derive(Deserialize)]
    struct Plant {
        devices: Vec<Device>,
    }
    #[derive(Deserialize)]
    struct Installed {
        id: String,
        data: serde_json::Value,
    }
    let file: File = serde_json::from_str(text).map_err(|e| broken(CONFIG, e))?;
    Ok(Config {
        devices: file.plant.map(|p| p.devices).unwrap_or_default(),
        profiles: file
            .installed_profiles
            .into_iter()
            .map(|p| (p.id, p.data))
            .collect(),
    })
}

/// Each non-blank line of `body` to `reading`.
fn lines(
    name: &str,
    body: impl Read,
    mut reading: impl FnMut(Line) -> Result<(), Error>,
) -> Result<(), Error> {
    for (number, line) in (1..).zip(BufReader::new(body).lines()) {
        let line = line.map_err(|e| broken(name, e))?;
        if line.trim().is_empty() {
            continue;
        }
        reading(parse(&line).map_err(|e| broken(name, format!("line {number}: {e}")))?)?;
    }
    Ok(())
}

fn parse(line: &str) -> Result<Line, String> {
    #[derive(Deserialize)]
    struct Wire {
        time: String,
        device_slug: String,
        metric_key: String,
        value: f64,
        dur_ms: Option<i64>,
        source_tier: Tier,
    }
    let wire: Wire = serde_json::from_str(line).map_err(|e| e.to_string())?;
    Ok(Line {
        time: wire
            .time
            .parse()
            .map_err(|_| format!("time {} is not an instant", wire.time))?,
        device: wire.device_slug,
        metric: wire.metric_key,
        value: wire.value,
        hold_ms: wire.dur_ms,
        tier: wire.source_tier,
    })
}
