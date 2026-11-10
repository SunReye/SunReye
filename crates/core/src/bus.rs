//! The bus of typed readings (ADR 6). Endpoint tasks publish; storage, the live API, integrations
//! and write read-back subscribe. No consumer decodes registers.

use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use sunreye_profile::Unit;
use tokio::sync::broadcast;

/// Readings a subscriber may fall behind by before it loses the oldest.
const CAPACITY: usize = 1024;
/// The gap threshold's floor (ADR 3).
const MIN_GAP: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceId(pub u32);

/// An interned series; [`Bus::series`] names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SeriesId(usize);

/// One role at one index.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Series {
    pub role: String,
    pub index: Option<u32>,
}

impl Series {
    /// The series a name such as `pv.mppt.power[2]` names; `None` for a malformed index.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        let (role, index) = match name.strip_suffix(']') {
            Some(indexed) => {
                let (role, index) = indexed.split_once('[')?;
                (role, Some(index.parse().ok()?))
            }
            None => (name, None),
        };
        let valid = !role.is_empty() && !role.contains(['[', ']']);
        valid.then(|| Self {
            role: role.to_owned(),
            index,
        })
    }
}

/// Named like `pv.mppt.power[2]`; an unindexed role is its own name.
impl fmt::Display for Series {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.index {
            Some(index) => write!(f, "{}[{index}]", self.role),
            None => f.write_str(&self.role),
        }
    }
}

/// One decoded value of a series from a device at an instant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    pub device: DeviceId,
    pub series: SeriesId,
    pub value: f64,
    pub unit: Option<Unit>,
    pub time: SystemTime,
    /// How often its publisher sends the series again, which sets its gap threshold (ADR 3).
    pub cadence: Duration,
}

impl Reading {
    /// The silence after which the reading no longer holds (ADR 3): three cadences, at least 15 s.
    #[must_use]
    pub fn gap_threshold(&self) -> Duration {
        self.cadence.saturating_mul(3).max(MIN_GAP)
    }
}

/// A handle to the one bus; clones share it.
#[derive(Debug, Clone)]
pub struct Bus(Arc<Inner>);

#[derive(Debug)]
struct Inner {
    sender: broadcast::Sender<Reading>,
    series: Mutex<Vec<Series>>,
}

impl Default for Bus {
    fn default() -> Self {
        Self(Arc::new(Inner {
            sender: broadcast::channel(CAPACITY).0,
            series: Mutex::default(),
        }))
    }
}

impl Bus {
    /// Readings published from now on. A subscriber more than the bus's capacity behind loses the
    /// oldest and is told how many.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<Reading> {
        self.0.sender.subscribe()
    }

    pub fn publish(&self, reading: Reading) {
        // No subscriber is not an error: the reading is simply not wanted yet.
        self.0.sender.send(reading).ok();
    }

    /// The id of `role` at `index`, the same for every caller.
    #[must_use]
    pub fn intern(&self, role: &str, index: Option<u32>) -> SeriesId {
        let mut series = crate::lock(&self.0.series);
        let id = series
            .iter()
            .position(|s| s.role == role && s.index == index)
            .unwrap_or(series.len());
        if id == series.len() {
            series.push(Series {
                role: role.to_owned(),
                index,
            });
        }
        drop(series);
        SeriesId(id)
    }

    #[must_use]
    pub fn series(&self, id: SeriesId) -> Option<Series> {
        let series = crate::lock(&self.0.series);
        series.get(id.0).cloned()
    }
}
