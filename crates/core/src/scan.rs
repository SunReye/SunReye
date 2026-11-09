//! The setup scan (ADR 6): finds devices on the local network and proposes a profile and unit id.
//!
//! It connects to Modbus TCP and Solarman ports on a private subnet, then runs every served
//! profile's identify probe against each endpoint that answered. Manual entry stays the fallback:
//! an endpoint whose device answers no probe is still listed.
//!
//! Every probe goes through [`Client::read_only`], whose wire refuses anything but function 3. The
//! scan is bounded so it cannot flood the LAN: at most a /24, connects and identifies capped in
//! number and time, one scan at a time, and no endpoint already configured is touched, as its own
//! task owns it.

use std::fmt;
use std::net::Ipv4Addr;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use sunreye_profile::{Framing, Profile};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::api::{Code, Problem};
use crate::devices::Transport;
use crate::sunspec;
use crate::transport::{Client, Endpoint, Error};

/// The ports a setup scan tries: Modbus TCP on 502, 1502 and 6607, and the Solarman logger's
/// 8899.
pub const PORTS: [(u16, Framing); 4] = [
    (502, Framing::Tcp),
    (1502, Framing::Tcp),
    (6607, Framing::Tcp),
    (8899, Framing::SolarmanV5),
];

/// Unit ids an identify probe tries, in order: 1, a bus device's factory address; 0, which a
/// gateway may answer (the owner's does); then 2 to 5, where a second device on a bus is set. A
/// miss costs the whole probe timeout, so the list stays short.
const UNITS: [u8; 6] = [1, 0, 2, 3, 4, 5];

/// How long and how wide a scan may go.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Per TCP connect.
    pub connect: Duration,
    /// Per identify probe, and per connect of its client.
    pub probe: Duration,
    /// Connects in flight at once.
    pub connects: usize,
    /// Endpoints identified at once; each is probed one request at a time.
    pub identifies: usize,
}

impl Limits {
    /// A /24 sweep of four ports takes at most 16 s; a found endpoint's probes 9 s per profile.
    pub const LAN: Self = Self {
        connect: Duration::from_millis(500),
        probe: Duration::from_millis(1500),
        connects: 32,
        identifies: 8,
    };
}

/// Runs setup scans, one at a time.
#[derive(Clone)]
pub struct Scanner {
    ports: Vec<(u16, Framing)>,
    limits: Limits,
    /// The core's own address, whose /24 a scan without a subnet covers.
    home: fn() -> Option<Ipv4Addr>,
    running: Arc<Mutex<()>>,
}

impl fmt::Debug for Scanner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Scanner")
            .field("ports", &self.ports)
            .finish_non_exhaustive()
    }
}

impl Scanner {
    #[must_use]
    pub fn new(ports: Vec<(u16, Framing)>, limits: Limits, home: fn() -> Option<Ipv4Addr>) -> Self {
        Self {
            ports,
            limits,
            home,
            running: Arc::default(),
        }
    }

    /// The scanner the core runs: [`PORTS`] within [`Limits::LAN`] around the core's address.
    #[must_use]
    pub fn lan() -> Self {
        Self::new(PORTS.to_vec(), Limits::LAN, home)
    }
}

/// The IPv4 address the core reaches the LAN from. Connecting a UDP socket sends nothing.
fn home() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(address) => Some(address),
        std::net::IpAddr::V6(_) => None,
    }
}

/// A private or loopback IPv4 network of at most 256 addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Subnet {
    network: Ipv4Addr,
    prefix: u8,
}

impl Subnet {
    /// The smallest prefix a scan takes: a /24.
    const WIDEST: u8 = 24;

    fn new(address: Ipv4Addr, prefix: u8) -> Option<Self> {
        let local = address.is_private() || address.is_loopback();
        if !(Self::WIDEST..=32).contains(&prefix) || !local {
            return None;
        }
        let mask = u32::MAX.checked_shl(u32::from(32 - prefix)).unwrap_or(0);
        Some(Self {
            network: Ipv4Addr::from(u32::from(address) & mask),
            prefix,
        })
    }

    /// Its hosts: every address, less the network and broadcast addresses of a /30 or wider.
    fn hosts(self) -> impl Iterator<Item = Ipv4Addr> {
        let first = u32::from(self.network);
        let size = 1_u32 << (32 - self.prefix);
        let ends = u32::from(self.prefix <= 30);
        (first + ends..first + size - ends).map(Ipv4Addr::from)
    }
}

impl FromStr for Subnet {
    type Err = ();

    fn from_str(text: &str) -> Result<Self, ()> {
        let (address, prefix) = text.split_once('/').ok_or(())?;
        Self::new(
            address.parse().map_err(|_| ())?,
            prefix.parse().map_err(|_| ())?,
        )
        .ok_or(())
    }
}

impl fmt::Display for Subnet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.network, self.prefix)
    }
}

/// What to scan.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ScanRequest {
    /// A private IPv4 network of at most a /24, such as `192.168.1.0/24`; by default the /24 of
    /// the core's own address.
    #[serde(default)]
    pub subnet: Option<String>,
}

/// What a scan found.
#[derive(Debug, Serialize, ToSchema)]
pub struct ScanReport {
    /// The network scanned.
    subnet: String,
    /// Every endpoint that took a connection, by address.
    endpoints: Vec<Found>,
}

/// An endpoint that took a connection, and the devices proposed behind it.
#[derive(Debug, Serialize, ToSchema)]
struct Found {
    transport: Transport,
    host: String,
    port: u16,
    /// Empty when no profile's identify probe was answered: the homeowner enters it by hand.
    devices: Vec<Proposal>,
}

/// A device the identify probe of a profile found.
#[derive(Debug, Serialize, ToSchema)]
struct Proposal {
    profile: String,
    unit: u8,
    /// The variant the probe found: for SunSpec, the device model after the common model, such
    /// as 103 for a three-phase inverter.
    #[serde(skip_serializing_if = "Option::is_none")]
    variant: Option<u16>,
}

const SUBNET: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::ScanSubnet,
};
const BUSY: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::ScanBusy,
};

impl Scanner {
    /// Scans `subnet`, or the /24 of the core's address, for devices, leaving the endpoints in
    /// `configured` alone, and proposes each device one of `profiles` identifies.
    ///
    /// # Errors
    /// The subnet is not a private one of at most a /24, or a scan is already running.
    pub async fn run(
        &self,
        subnet: Option<&str>,
        configured: Vec<(String, u16)>,
        profiles: &[Arc<Profile>],
    ) -> Result<ScanReport, Problem> {
        let subnet = match subnet {
            Some(text) => text.parse().map_err(|()| SUBNET)?,
            None => (self.home)()
                .and_then(|home| Subnet::new(home, Subnet::WIDEST))
                .ok_or(SUBNET)?,
        };
        let _running = self.running.try_lock().map_err(|_| BUSY)?;
        let targets = subnet.hosts().flat_map(|host| {
            self.ports.iter().map(move |&(port, framing)| {
                let host = host.to_string();
                match framing {
                    Framing::SolarmanV5 => Endpoint::SolarmanV5 { host, port },
                    Framing::Tcp | Framing::RtuOverTcp => Endpoint::ModbusTcp { host, port },
                }
            })
        });
        let targets = targets
            .filter(|endpoint| !configured.iter().any(|(h, p)| address(endpoint) == (h, *p)))
            .collect();
        Ok(ScanReport {
            subnet: subnet.to_string(),
            endpoints: sweep(targets, profiles, self.limits).await,
        })
    }
}

fn address(endpoint: &Endpoint) -> (&str, u16) {
    match endpoint {
        Endpoint::ModbusTcp { host, port } | Endpoint::SolarmanV5 { host, port } => (host, *port),
        Endpoint::Sim(_) => ("", 0),
    }
}

/// Connects to every target, then identifies each that took the connection, in target order.
async fn sweep(targets: Vec<Endpoint>, profiles: &[Arc<Profile>], limits: Limits) -> Vec<Found> {
    let open: Vec<Endpoint> = stream::iter(targets)
        .map(|endpoint| async move {
            let (host, port) = address(&endpoint);
            let connect = TcpStream::connect((host, port));
            let open = matches!(
                tokio::time::timeout(limits.connect, connect).await,
                Ok(Ok(_))
            );
            open.then_some(endpoint)
        })
        .buffered(limits.connects)
        .filter_map(std::future::ready)
        .collect()
        .await;
    stream::iter(open)
        .map(|endpoint| identify(endpoint, profiles, limits))
        .buffered(limits.identifies)
        .collect()
        .await
}

/// One identify probe.
enum Probe<'a> {
    /// One word of a profile's first planned register.
    Register(&'a Profile, u16),
    /// The built-in SunSpec binding's: the `SunS` marker, then the model chain.
    SunSpec,
}

impl Probe<'_> {
    /// What `unit` answered; `None` when it answered but not as this probe looks for.
    async fn run(&self, client: &mut Client, unit: u8) -> Result<Option<Proposal>, Error> {
        match self {
            Self::Register(profile, start) => {
                match client.read_holding(unit, *start, &mut [0]).await {
                    Ok(()) => Ok(Some(Proposal {
                        profile: profile.id.clone(),
                        unit,
                        variant: None,
                    })),
                    Err(Error::Exception(_)) => Ok(None),
                    Err(e) => Err(e),
                }
            }
            Self::SunSpec => Ok(sunspec::discover(client, unit)
                .await?
                .map(|chain| Proposal {
                    profile: sunspec::PROFILE.to_owned(),
                    unit,
                    variant: chain.variant(),
                })),
        }
    }
}

/// Runs each profile's probe, then SunSpec's, at each of [`UNITS`], one request at a time.
async fn identify(endpoint: Endpoint, profiles: &[Arc<Profile>], limits: Limits) -> Found {
    let framing = endpoint.framing();
    let probes = profiles
        .iter()
        .filter_map(|profile| {
            let first = profile.read_plan(framing.gap_tolerance()).first()?.start;
            Some(Probe::Register(profile, first))
        })
        .chain([Probe::SunSpec]);
    let mut devices = Vec::new();
    let mut client = None;
    'probes: for probe in probes {
        for unit in UNITS {
            let mut connected = match client.take() {
                Some(connected) => connected,
                None => match Client::read_only(&endpoint, limits.probe).await {
                    Ok(connected) => connected,
                    Err(_) => break 'probes,
                },
            };
            // After an error the wire may hold half a reply: reconnect.
            if let Ok(found) = probe.run(&mut connected, unit).await {
                devices.extend(found);
                client = Some(connected);
            }
        }
    }
    let (host, port) = address(&endpoint);
    Found {
        transport: match endpoint.framing() {
            Framing::SolarmanV5 => Transport::SolarmanV5,
            Framing::Tcp | Framing::RtuOverTcp => Transport::ModbusTcp,
        },
        host: host.to_owned(),
        port,
        devices,
    }
}
