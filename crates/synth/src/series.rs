//! Every series the reference plant stores.
//!
//! Each with the policy the core stores it in and how its value is read from the plant at a poll:
//! each device's profile quantities, the plant's aggregates (ADR 14), the string estimates
//! (ADR 17), the spot price (ADR 12) and the clear-sky index (ADR 23).

use std::collections::HashMap;
use std::time::Duration;

use sunreye_core::bus::{Bus, DeviceId, SeriesId};
use sunreye_core::endpoint;
use sunreye_core::storage::Policy;
use sunreye_core::topology::{Balance, Point, balance};
use sunreye_core::{plant, spot, weather};
use sunreye_profile::{Profile, RoleKind, StorageClass, Unit};

use crate::home::{Now, POLL};
use crate::meters::Meter;
use crate::plant::{Kind, STRING_INVERTERS};

/// The spot price's market time unit and the clear-sky index's quarter.
const QUARTER: Duration = Duration::from_mins(15);
/// The plant's own roles and the steps it stores them in, as its device declares them.
const PLANT_STEPS: &[(&str, Unit, f64)] = &[
    ("battery.soc", Unit::Percent, 0.1),
    ("battery.capacity", Unit::KilowattHour, 0.01),
];

/// The plant at one poll, with what is derived from it.
#[derive(Debug, Clone)]
pub struct Frame {
    pub now: Now,
    /// The topology balanced over the devices' readings.
    pub balance: Balance,
    /// EUR/kWh of the slot that begins at this poll.
    pub price: Option<f64>,
    /// The clear-sky index of the quarter that begins at this poll.
    pub clearness: Option<f64>,
}

/// How a series' value is read.
#[derive(Debug, Clone, PartialEq)]
enum Read {
    Device(Meter),
    /// A plant total by its role.
    Total(&'static str),
    /// A measured point's own consumption.
    Own(u32),
    /// A string's estimate: its MPPT input's measured power, split by modelled power over the
    /// strings on that input, by their place in the layout.
    String {
        inverter: usize,
        input: usize,
        string: usize,
        siblings: Vec<usize>,
    },
    Price,
    Clearness,
}

/// One stored series.
#[derive(Debug, Clone, PartialEq)]
pub struct Stored {
    pub device: DeviceId,
    pub series: SeriesId,
    /// Named like `pv.mppt.power[2]`.
    pub name: String,
    pub policy: Policy,
    /// Polls between its readings.
    pub every: i64,
    read: Read,
}

impl Stored {
    fn new(
        device: DeviceId,
        (role, index): (&str, Option<u32>),
        policy: Policy,
        read: Read,
        bus: &Bus,
    ) -> Self {
        Self {
            device,
            series: bus.intern(role, index),
            name: name(role, index),
            every: every(policy.cadence),
            policy,
            read,
        }
    }

    /// Its value in `frame`; none where nothing is read, which the store keeps as a gap.
    #[must_use]
    pub fn read(&self, frame: &Frame) -> Option<f64> {
        let now = &frame.now;
        match &self.read {
            Read::Device(meter) => meter.read(now),
            Read::Total(role) => frame
                .balance
                .totals
                .iter()
                .find(|(r, _)| r == role)
                .map(|&(_, value)| value),
            Read::Own(point) => frame.balance.own.get(point).copied(),
            Read::String {
                inverter,
                input,
                string,
                siblings,
            } => {
                let measured = now.inverters.get(*inverter)?.inputs.get(*input)?.power;
                let modelled = |i: &usize| now.strings.get(*i).copied().unwrap_or(0.0);
                let total: f64 = siblings.iter().map(modelled).sum();
                #[expect(clippy::cast_precision_loss, reason = "a handful of strings")]
                let share = if total > 0.0 {
                    modelled(string) / total
                } else {
                    1.0 / siblings.len().max(1) as f64
                };
                Some(measured * share)
            }
            Read::Price => frame.price,
            Read::Clearness => frame.clearness,
        }
    }
}

/// The plant's stored series and the topology its aggregates are balanced over.
#[derive(Debug, Clone)]
pub struct Plant {
    pub stored: Vec<Stored>,
    points: Vec<Point>,
    /// Each device's unindexed roles, as the plant device reads them.
    roles: HashMap<(u32, String), Meter>,
}

/// A device of the plant: its id, kind and profile.
pub struct Member<'a> {
    pub id: u32,
    pub kind: Kind,
    pub profile: &'a Profile,
}

impl Plant {
    /// Every series of `members`, the plant over `points`, the estimates of `strings` (each id
    /// and MPPT input, in the layout's order), the spot price and the clear-sky index.
    #[must_use]
    pub fn new(
        members: &[Member<'_>],
        points: Vec<Point>,
        strings: &[(u32, u32)],
        bus: &Bus,
    ) -> Self {
        let mut plant = Self {
            stored: Vec::new(),
            points,
            roles: HashMap::new(),
        };
        for member in members {
            plant.measured(member, bus);
        }
        plant.aggregates(bus);
        plant.estimates(members, strings, bus);
        plant.quarters(bus);
        plant
    }

    /// A device's series: each quantity of its profile that keeps history, once.
    fn measured(&mut self, member: &Member<'_>, bus: &Bus) {
        let device = DeviceId(member.id);
        for q in member.profile.quantities() {
            let meter = Meter::new(member.kind, q);
            if q.index.is_none() {
                self.roles
                    .entry((member.id, q.role.clone()))
                    .or_insert(meter);
            }
            let series = bus.intern(&q.role, q.index);
            let known = self
                .stored
                .iter()
                .any(|s| s.device == device && s.series == series);
            if known || q.storage() == StorageClass::NoHistory {
                continue;
            }
            let cycle = Duration::from_secs(POLL.cast_unsigned());
            let cadence = endpoint::cadence(cycle, q.cadence());
            let mut policy = Policy::new(q.kind(), q.unit(), q.step(), cadence);
            policy.deadband = q.deadband().unwrap_or(policy.deadband);
            let at = (q.role.as_str(), q.index);
            self.stored
                .push(Stored::new(device, at, policy, Read::Device(meter), bus));
        }
    }

    /// The plant's aggregates (ADR 14).
    fn aggregates(&mut self, bus: &Bus) {
        // The roles a balance yields depend on what the topology claims, not on the values.
        let sample = self.balance(&Now::default());
        for (role, _) in &sample.totals {
            let (unit, step) = PLANT_STEPS
                .iter()
                .find(|(r, ..)| r == role)
                .map_or((Unit::Watt, 1.0), |&(_, unit, step)| (unit, step));
            let policy = Policy::new(RoleKind::Measurement, Some(unit), step, endpoint::CADENCE);
            let stored = Stored::new(plant::DEVICE, (role, None), policy, Read::Total(role), bus);
            self.stored.push(stored);
        }
        for point in sample.own.keys() {
            let at = ("point.power", Some(*point));
            let stored = Stored::new(plant::DEVICE, at, watts(), Read::Own(*point), bus);
            self.stored.push(stored);
        }
    }

    /// Each string's estimate, on its inverter (ADR 17).
    fn estimates(&mut self, members: &[Member<'_>], strings: &[(u32, u32)], bus: &Bus) {
        let inverters: Vec<u32> = members
            .iter()
            .filter(|m| matches!(m.kind, Kind::Inverter(_)))
            .map(|m| m.id)
            .collect();
        for (string, (&(id, input), &inverter)) in strings.iter().zip(&STRING_INVERTERS).enumerate()
        {
            let Some(&device) = inverters.get(inverter) else {
                continue;
            };
            let siblings = strings
                .iter()
                .zip(&STRING_INVERTERS)
                .enumerate()
                .filter(|(_, (s, i))| s.1 == input && **i == inverter)
                .map(|(k, _)| k)
                .collect();
            let read = Read::String {
                inverter,
                input: usize::try_from(input.saturating_sub(1)).unwrap_or(0),
                string,
                siblings,
            };
            let at = ("pv.string.power", Some(id));
            self.stored
                .push(Stored::new(DeviceId(device), at, watts(), read, bus));
        }
    }

    /// The spot price and the clear-sky index, each by the quarter.
    fn quarters(&mut self, bus: &Bus) {
        let price = Policy::new(RoleKind::Measurement, None, 0.000_01, QUARTER).in_unit("EUR/kWh");
        let at = ("price.spot", None);
        self.stored
            .push(Stored::new(spot::DEVICE, at, price, Read::Price, bus));
        let index = Policy::new(RoleKind::Measurement, None, 0.001, QUARTER);
        let at = (weather::CLEAR_SKY_INDEX, None);
        self.stored.push(Stored::new(
            weather::DEVICE,
            at,
            index,
            Read::Clearness,
            bus,
        ));
    }

    /// The topology balanced over the devices' readings `now`, as the plant device balances it.
    #[must_use]
    pub fn balance(&self, now: &Now) -> Balance {
        balance(&self.points, |device, role| {
            self.roles.get(&(device, role.to_owned()))?.read(now)
        })
    }
}

/// A derived power's policy: whole watts at the core's cadence.
const fn watts() -> Policy {
    Policy::new(
        RoleKind::Measurement,
        Some(Unit::Watt),
        1.0,
        endpoint::CADENCE,
    )
}

fn name(role: &str, index: Option<u32>) -> String {
    index.map_or_else(|| role.to_owned(), |i| format!("{role}[{i}]"))
}

fn every(cadence: Duration) -> i64 {
    (i64::try_from(cadence.as_secs()).unwrap_or(POLL) / POLL).max(1)
}
