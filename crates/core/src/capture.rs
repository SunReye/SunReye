//! `sunreye capture` (ADR 6): a read-only recording of a real device, which `sim` replays.

use std::fmt::{self, Write as _};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sunreye_profile::{Framing, Profile};

use crate::bus::DeviceId;
use crate::endpoint::{self, Device, TIMEOUT};
use crate::transport::{Capture, Client, Endpoint, Error, Exchange};

/// What `sunreye capture --help` prints: the flags [`Options::parse`] reads.
pub const USAGE: &str = "\
Usage: sunreye capture --endpoint <transport>://<host>:<port> --unit <id> --profile <id>

Polls one device read-only and prints the capture to stdout.

Flags:
  --endpoint <url>   modbus-tcp://, rtu-over-tcp:// or solarman-v5://host:port
  --unit <id>        the unit id, 0 to 255
  --profile <id>     a bundled profile's id
";

/// What `sunreye capture` records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub endpoint: Endpoint,
    pub unit: u8,
    /// A bundled profile's id.
    pub profile: String,
}

/// Why the options were refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionsError {
    Missing(&'static str),
    NoValue(&'static str),
    Endpoint(String),
    Unit(String),
    Unknown(String),
}

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(flag) => write!(f, "--{flag} is required"),
            Self::NoValue(flag) => write!(f, "--{flag} needs a value"),
            Self::Endpoint(value) => write!(
                f,
                "--endpoint: `{value}` is not modbus-tcp://, rtu-over-tcp:// or solarman-v5://host:port"
            ),
            Self::Unit(value) => write!(f, "--unit: `{value}` is not a unit id from 0 to 255"),
            Self::Unknown(arg) => write!(f, "unknown argument `{arg}`"),
        }
    }
}

impl std::error::Error for OptionsError {}

impl Options {
    /// Reads `--endpoint`, `--unit` and `--profile`, each required.
    ///
    /// # Errors
    /// A flag missing or malformed, or an argument that is not a flag.
    pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Self, OptionsError> {
        let (mut endpoint, mut unit, mut profile) = (None, None, None);
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) => (name, Some(value.to_owned())),
                None => (arg.as_str(), None),
            };
            let (flag, slot) = match name {
                "--endpoint" => ("endpoint", &mut endpoint),
                "--unit" => ("unit", &mut unit),
                "--profile" => ("profile", &mut profile),
                _ => return Err(OptionsError::Unknown(arg)),
            };
            *slot = Some(
                inline
                    .or_else(|| args.next())
                    .ok_or(OptionsError::NoValue(flag))?,
            );
        }
        let endpoint = endpoint.ok_or(OptionsError::Missing("endpoint"))?;
        let unit = unit.ok_or(OptionsError::Missing("unit"))?;
        Ok(Self {
            endpoint: parse_endpoint(&endpoint).ok_or(OptionsError::Endpoint(endpoint))?,
            unit: unit.parse().map_err(|_| OptionsError::Unit(unit))?,
            profile: profile.ok_or(OptionsError::Missing("profile"))?,
        })
    }
}

/// `modbus-tcp://`, `rtu-over-tcp://` or `solarman-v5://host:port`: the transport's name (ADR 6) as
/// scheme.
fn parse_endpoint(url: &str) -> Option<Endpoint> {
    let (transport, address) = url.split_once("://")?;
    let (host, port) = address.rsplit_once(':')?;
    let (host, port) = (host.to_owned(), port.parse().ok()?);
    if host.is_empty() {
        return None;
    }
    match transport {
        "modbus-tcp" => Some(Endpoint::ModbusTcp { host, port }),
        "rtu-over-tcp" => Some(Endpoint::RtuOverTcp { host, port }),
        "solarman-v5" => Some(Endpoint::SolarmanV5 { host, port }),
        _ => None,
    }
}

/// A capture of one device, and the profile whose read plan it recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recording {
    pub profile: String,
    pub version: String,
    pub unit: u8,
    pub capture: Capture,
}

/// The file format this build writes and reads.
const FORMAT: u32 = 1;

/// The first line of a capture file.
#[derive(Serialize, Deserialize)]
struct Header {
    capture: u32,
    profile: String,
    version: String,
    framing: String,
    unit: u8,
}

/// Every later line: one exchange, in hex.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
enum Line {
    #[serde(rename = "tx")]
    Request(String),
    #[serde(rename = "rx")]
    Reply(Vec<String>),
}

impl Recording {
    /// The capture file (ADR 6): a header line, then one line per exchange.
    #[must_use]
    pub fn to_ndjson(&self) -> String {
        let header = Header {
            capture: FORMAT,
            profile: self.profile.clone(),
            version: self.version.clone(),
            framing: framing_name(self.capture.framing).to_owned(),
            unit: self.unit,
        };
        let lines = self
            .capture
            .exchanges
            .iter()
            .map(|exchange| match exchange {
                Exchange::Request(bytes) => Line::Request(hex(bytes)),
                Exchange::Reply(chunks) => Line::Reply(chunks.iter().map(|c| hex(c)).collect()),
            });
        let mut out = json(&header);
        for line in lines {
            out.push_str(&json(&line));
        }
        out
    }

    /// Reads a capture file.
    ///
    /// # Errors
    ///
    /// The text is not a capture file this build reads.
    pub fn parse(text: &str) -> Result<Self, FormatError> {
        let mut lines = text
            .lines()
            .enumerate()
            .filter(|(_, l)| !l.trim().is_empty());
        let (_, first) = lines
            .next()
            .ok_or_else(|| FormatError::Malformed(1, "empty".into()))?;
        let header: Header = serde_json::from_str(first).map_err(|e| malformed(0, &e))?;
        if header.capture != FORMAT {
            return Err(FormatError::Format(header.capture));
        }
        let framing = match header.framing.as_str() {
            "tcp" => Framing::Tcp,
            "rtu-over-tcp" => Framing::RtuOverTcp,
            "solarman-v5" => Framing::SolarmanV5,
            other => {
                return Err(FormatError::Malformed(
                    1,
                    format!("unknown framing `{other}`"),
                ));
            }
        };
        let exchanges = lines
            .map(|(at, line)| {
                let bytes = |hex: &str| {
                    unhex(hex).ok_or_else(|| FormatError::Malformed(at + 1, "bad hex".into()))
                };
                match serde_json::from_str(line).map_err(|e| malformed(at, &e))? {
                    Line::Request(hex) => bytes(&hex).map(Exchange::Request),
                    Line::Reply(chunks) => chunks
                        .iter()
                        .map(|c| bytes(c))
                        .collect::<Result<_, _>>()
                        .map(Exchange::Reply),
                }
            })
            .collect::<Result<_, _>>()?;
        Ok(Self {
            profile: header.profile,
            version: header.version,
            unit: header.unit,
            capture: Capture { framing, exchanges },
        })
    }
}

const fn framing_name(framing: Framing) -> &'static str {
    match framing {
        Framing::Tcp => "tcp",
        Framing::RtuOverTcp => "rtu-over-tcp",
        Framing::SolarmanV5 => "solarman-v5",
    }
}

fn json(value: &impl Serialize) -> String {
    let mut line = serde_json::to_string(value).unwrap_or_default();
    line.push('\n');
    line
}

fn malformed(at: usize, error: &serde_json::Error) -> FormatError {
    FormatError::Malformed(at + 1, error.to_string())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, b| {
        // Writing to a String cannot fail.
        write!(out, "{b:02x}").ok();
        out
    })
}

fn unhex(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Why a capture file was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatError {
    /// A capture format this build does not read.
    Format(u32),
    /// The line, counted from 1, and why.
    Malformed(usize, String),
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Format(format) => write!(
                f,
                "capture format {format} is not supported; this build reads format {FORMAT}"
            ),
            Self::Malformed(line, why) => write!(f, "line {line}: {why}"),
        }
    }
}

impl std::error::Error for FormatError {}

/// Poll cycles a capture records: a minute at the cadence.
pub const CYCLES: usize = 12;

/// Why a capture failed.
#[derive(Debug)]
pub enum RunError {
    Profile(String),
    Transport(Error),
}

impl fmt::Display for RunError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Profile(id) => write!(f, "no bundled profile `{id}`"),
            Self::Transport(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for RunError {}

/// Records [`CYCLES`] cycles of the device `options` names.
///
/// # Errors
///
/// The profile is not bundled, or a read failed.
pub async fn run(options: Options) -> Result<Recording, RunError> {
    let profile = crate::profiles::Catalogue::bundled()
        .ok()
        .and_then(|catalogue| catalogue.get(&options.profile))
        .ok_or(RunError::Profile(options.profile))?;
    record(&options.endpoint, options.unit, profile, CYCLES)
        .await
        .map_err(RunError::Transport)
}

/// Polls `unit` behind `endpoint` with `profile`'s read plan for `cycles` cycles, a cadence apart.
///
/// # Errors
///
/// The first error of a read.
pub async fn record(
    endpoint: &Endpoint,
    unit: u8,
    profile: Arc<Profile>,
    cycles: usize,
) -> Result<Recording, Error> {
    let (mut client, tape) = Client::recording(endpoint, TIMEOUT).await?;
    let framing = endpoint.framing();
    let (id, version) = (profile.id.clone(), profile.version.clone());
    let device = Device {
        id: DeviceId(0),
        unit,
        profile,
    };
    endpoint::poll(&mut client, framing, device, cycles).await?;
    Ok(Recording {
        profile: id,
        version,
        unit,
        capture: Capture {
            framing,
            exchanges: tape.exchanges(),
        },
    })
}

#[cfg(test)]
mod tests;
