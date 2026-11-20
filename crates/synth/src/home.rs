//! The reference plant's physics, one poll at a time.
//!
//! PV from the `pv` model under the synthetic sky, the house load as noise around a daily profile
//! with appliances, a heat pump by the season, EV charging sessions, a battery cycling on the
//! surplus, and the grid as the balance. Every lifetime counter integrates its power over the
//! poll.

use jiff::tz::TimeZone;

use crate::model::Model;
use crate::noise::{Noise, Stream};
use crate::plant::{STRING_COUNT, STRING_INVERTERS};
use crate::sky::Sky;

/// Seconds between polls (ADR 6).
pub const POLL: i64 = 5;
pub const HOURS_PER_POLL: f64 = 5.0 / 3600.0;

const LOAD: Stream = Stream(20);
const EVENT: Stream = Stream(21);
const EVENT_KIND: Stream = Stream(22);
const PRESENT: Stream = Stream(23);
const ARRIVAL: Stream = Stream(24);
const ARRIVAL_SOC: Stream = Stream(25);
const MODE: Stream = Stream(26);
const VOLTAGE: Stream = Stream(27);
const FREQUENCY: Stream = Stream(28);
const JITTER: Stream = Stream(29);
const PHASE: Stream = Stream(30);

/// kWh and W of the hybrid's battery; its state of charge stays within these percentages.
pub const BATTERY_KWH: f64 = 10.0;
const BATTERY_W: f64 = 5_000.0;
pub const SOC_MIN: f64 = 10.0;
pub const SOC_MAX: f64 = 100.0;
const CHARGE_EFFICIENCY: f64 = 0.95;
/// The EV's battery and the wallbox's three phases at 16 A, and their least at 6 A.
const EV_KWH: f64 = 60.0;
const EV_MAX_W: f64 = 11_000.0;
const EV_MIN_W: f64 = 4_140.0;
const EV_LIMIT: f64 = 80.0;
/// DC to AC.
const INVERTER_EFFICIENCY: f64 = 0.97;

/// One MPPT input's operating point.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Input {
    pub power: f64,
    pub voltage: f64,
    pub current: f64,
}

/// One inverter's PV side.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Inverter {
    pub inputs: [Input; 2],
    /// DC watts, the inputs summed.
    pub pv: f64,
    /// AC watts out of its PV.
    pub output: f64,
    /// kWh, lifetime.
    pub energy: f64,
    pub temperature: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Battery {
    /// W, positive while charging (ADR 4).
    pub power: f64,
    /// %.
    pub soc: f64,
    pub voltage: f64,
    pub current: f64,
    pub temperature: f64,
    /// kWh, lifetime.
    pub charged: f64,
    pub discharged: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Ev {
    pub power: f64,
    pub soc: f64,
    /// kWh this session.
    pub session: f64,
    pub connected: bool,
    pub charging: bool,
    /// EVCC's mode: 1 now, 3 PV.
    pub mode: f64,
    pub limit: f64,
}

/// The plant at one poll.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Now {
    pub unix: i64,
    pub inverters: [Inverter; 2],
    /// Each string's DC watts, in the layout's order.
    pub strings: [f64; STRING_COUNT],
    pub battery: Battery,
    /// W the house uses beside the heat pump and the EV.
    pub house: f64,
    /// W of the house on the hybrid's backup port, and its lifetime and daily kWh.
    pub ups: f64,
    pub ups_energy: f64,
    pub ups_today: f64,
    pub heat_pump: f64,
    pub ev: Ev,
    /// W, positive while importing (ADR 4), and its lifetime kWh each way.
    pub grid: f64,
    pub imported: f64,
    pub exported: f64,
    /// Each phase's share of the grid's power.
    pub phases: [f64; 3],
    pub voltages: [f64; 3],
    pub frequency: f64,
    /// °C outside.
    pub air: f64,
}

/// The physics between polls; a clone is a checkpoint to run on from.
#[derive(Debug, Clone)]
pub struct Home {
    sky: Sky,
    noise: Noise,
    zone: TimeZone,
    /// Each inverter's AC rating.
    ratings: [f64; 2],
    /// The local offset, cached per hour.
    offset: Option<(i64, i64)>,
    load: f64,
    day: i64,
    now: Now,
}

impl Home {
    #[must_use]
    pub fn new(seed: u64, sky: Sky, zone: TimeZone, ratings: [f64; 2]) -> Self {
        Self {
            sky,
            noise: Noise::new(seed ^ 0x5eed),
            zone,
            ratings,
            offset: None,
            load: 0.0,
            day: i64::MIN,
            now: Now {
                battery: Battery {
                    soc: 50.0,
                    ..Battery::default()
                },
                ev: Ev {
                    soc: 50.0,
                    mode: 3.0,
                    limit: EV_LIMIT,
                    ..Ev::default()
                },
                ..Now::default()
            },
        }
    }

    /// The plant at the poll at `unix`, the counters carried on from the last poll, with PV from
    /// `model`.
    pub fn step(&mut self, unix: i64, model: &Model) -> Now {
        let local = unix + self.offset(unix);
        let mut now = self.now;
        now.unix = unix;
        let air = self.sky.at(unix);
        now.air = air.temperature;
        self.photovoltaics(unix, air.ghi, model, &mut now);
        now.house = self.house(unix, local);
        now.ups = now.house * 0.3;
        now.heat_pump = self.heat_pump(unix, local, air.temperature);
        let pv: f64 = now.inverters.iter().map(|i| i.output).sum();
        self.ev(local, pv - now.house - now.heat_pump, &mut now.ev);
        let surplus = pv - now.house - now.heat_pump - now.ev.power;
        battery(surplus, &mut now.battery, air.temperature);
        now.grid = now.house + now.heat_pump + now.ev.power + now.battery.power - pv;
        self.lines(unix, &mut now);
        self.count(local, &mut now);
        self.now = now;
        now
    }

    fn offset(&mut self, unix: i64) -> i64 {
        let hour = unix.div_euclid(3600);
        if let Some((at, offset)) = self.offset
            && at == hour
        {
            return offset;
        }
        let offset = jiff::Timestamp::from_second(unix)
            .map_or(0, |t| i64::from(self.zone.to_offset(t).seconds()));
        self.offset = Some((hour, offset));
        offset
    }

    /// PV from the model's knot, scaled to the irradiance at the poll, and capped at each
    /// inverter's AC rating.
    fn photovoltaics(&self, unix: i64, ghi: f64, model: &Model, now: &mut Now) {
        let knot = model.at(unix);
        let ratio = if knot.ghi > 1.0 {
            (ghi / knot.ghi).clamp(0.0, 1.3)
        } else {
            0.0
        };
        // The share of each inverter's DC its AC rating lets through.
        let mut kept = [1.0; 2];
        for (((inverter, modelled), rating), kept) in now
            .inverters
            .iter_mut()
            .zip(knot.inputs)
            .zip(self.ratings)
            .zip(kept.iter_mut())
        {
            let ac = modelled.iter().map(|i| i.power * ratio).sum::<f64>() * INVERTER_EFFICIENCY;
            if ac > rating {
                *kept = rating / ac;
            }
            for (input, model) in inverter.inputs.iter_mut().zip(modelled) {
                *input = scaled(model, ratio * *kept);
            }
            inverter.pv = inverter.inputs.iter().map(|i| i.power).sum();
            inverter.output = inverter.pv * INVERTER_EFFICIENCY;
            inverter.temperature = inverter.output.mul_add(0.0015, now.air + 8.0);
        }
        for ((string, power), inverter) in now
            .strings
            .iter_mut()
            .zip(knot.strings)
            .zip(STRING_INVERTERS)
        {
            *string = power * ratio * kept.get(inverter).copied().unwrap_or(1.0);
        }
    }

    /// W: a daily profile by local hour, noise drifting around it, and appliances switched on.
    fn house(&mut self, unix: i64, local: i64) -> f64 {
        let hour = local.rem_euclid(86_400) / 3600;
        let weekend = matches!(local.div_euclid(86_400).rem_euclid(7), 2 | 3);
        let base = profile(hour, weekend);
        self.load = self
            .noise
            .normal(LOAD, unix)
            .mul_add(12.0, self.load * 0.97);
        let window = unix.div_euclid(600);
        let chance = if (17..22).contains(&hour) || (7..9).contains(&hour) {
            0.35
        } else if (0..6).contains(&hour) {
            0.03
        } else {
            0.15
        };
        let appliance = if self.noise.unit(EVENT, window) < chance {
            let kind = self.noise.unit(EVENT_KIND, window);
            let (watts, seconds) = if kind < 0.4 {
                (2_000.0, 180)
            } else if kind < 0.7 {
                (2_200.0, 540)
            } else {
                (1_900.0, 420)
            };
            if unix.rem_euclid(600) < seconds {
                watts
            } else {
                0.0
            }
        } else {
            0.0
        };
        (self.load.mul_add(4.0, base) + appliance).max(60.0)
    }

    /// W: space heating by the outdoor temperature, cycling under 900 W, and hot water at noon.
    fn heat_pump(&self, unix: i64, local: i64, air: f64) -> f64 {
        let demand = ((15.0 - air) * 110.0).clamp(0.0, 3_500.0);
        let into_window = unix.rem_euclid(1_800);
        let heating = if demand >= 900.0 {
            self.noise.smooth(JITTER, unix, 60).mul_add(40.0, demand)
        } else {
            #[expect(clippy::cast_precision_loss, reason = "seconds of a half hour")]
            let on = (into_window as f64) < demand / 900.0 * 1_800.0;
            if on { 900.0 } else { 0.0 }
        };
        let second = local.rem_euclid(86_400);
        let hot_water = if (12 * 3600..12 * 3600 + 2_400).contains(&second) {
            2_400.0
        } else {
            0.0
        };
        let running = heating + hot_water;
        if running > 0.0 { running } else { 4.0 }
    }

    /// The EV: home some evenings and weekends, charging now or on PV `surplus` until its limit.
    fn ev(&self, local: i64, surplus: f64, ev: &mut Ev) {
        let day = local.div_euclid(86_400);
        let second = local.rem_euclid(86_400);
        let weekend = matches!(day.rem_euclid(7), 2 | 3);
        let present = |day: i64| self.noise.unit(PRESENT, day) < 0.6;
        let arrival = |day: i64| {
            let early = matches!(day.rem_euclid(7), 2 | 3);
            let hour = if early { 10.0 } else { 16.5 };
            #[expect(clippy::cast_possible_truncation, reason = "seconds of a day")]
            let arrival = (self.noise.unit(ARRIVAL, day).mul_add(3.0, hour) * 3600.0) as i64;
            arrival
        };
        // A session of yesterday lasts until 07:00; today's starts at its arrival.
        let today = present(day) && second >= arrival(day);
        let overnight = present(day - 1) && second < 7 * 3600;
        let connected = today || overnight;
        if connected && !ev.connected {
            ev.soc = self.noise.unit(ARRIVAL_SOC, day).mul_add(35.0, 25.0);
            ev.session = 0.0;
            ev.mode = if weekend || self.noise.unit(MODE, day) < 0.7 {
                3.0
            } else {
                1.0
            };
        }
        ev.connected = connected;
        let room = ev.soc < ev.limit;
        ev.power = match (connected && room, ev.mode >= 3.0) {
            (true, false) => EV_MAX_W,
            (true, true) if surplus >= EV_MIN_W => (surplus / 230.0).floor() * 230.0,
            _ => 0.0,
        }
        .min(EV_MAX_W);
        ev.charging = ev.power > 0.0;
        let kwh = ev.power * HOURS_PER_POLL / 1_000.0;
        ev.session += kwh;
        ev.soc = (kwh * 0.92 / EV_KWH).mul_add(100.0, ev.soc).min(100.0);
    }

    /// Phase shares, voltages and frequency, each drifting and jittering as a meter reads them.
    fn lines(&self, unix: i64, now: &mut Now) {
        let mut shares = [0.0; 3];
        for (k, share) in (0..3).zip(shares.iter_mut()) {
            *share = self
                .noise
                .smooth(PHASE, unix + k * 1_000_003, 900)
                .mul_add(0.08, 1.0 / 3.0);
        }
        let total: f64 = shares.iter().sum();
        for ((phase, share), (k, voltage)) in now
            .phases
            .iter_mut()
            .zip(shares)
            .zip((0..3).zip(now.voltages.iter_mut()))
        {
            *phase = now.grid * share / total;
            let drift = self.noise.smooth(VOLTAGE, unix + k * 7_000_003, 600) * 3.0;
            let jitter = self.noise.unit(VOLTAGE, unix * 3 + k) - 0.5;
            *voltage = jitter.mul_add(1.2, 231.0 + drift);
        }
        let jitter = self.noise.unit(FREQUENCY, unix) - 0.5;
        let drift = self.noise.smooth(FREQUENCY, unix, 120).mul_add(0.04, 50.0);
        now.frequency = jitter.mul_add(0.012, drift);
    }

    /// Lifetime counters integrate this poll's powers; the backup port's daily counter starts
    /// again each local day.
    fn count(&mut self, local: i64, now: &mut Now) {
        let kwh = |watts: f64| watts * HOURS_PER_POLL / 1_000.0;
        for inverter in &mut now.inverters {
            inverter.energy += kwh(inverter.output);
        }
        now.imported += kwh(now.grid.max(0.0));
        now.exported += kwh((-now.grid).max(0.0));
        now.battery.charged += kwh(now.battery.power.max(0.0));
        now.battery.discharged += kwh((-now.battery.power).max(0.0));
        now.ups_energy += kwh(now.ups);
        let day = local.div_euclid(86_400);
        if day != self.day {
            self.day = day;
            now.ups_today = 0.0;
        }
        now.ups_today += kwh(now.ups);
    }
}

/// The battery follows the `surplus` within its power and its state of charge's bounds.
fn battery(surplus: f64, battery: &mut Battery, air: f64) {
    let hours = HOURS_PER_POLL;
    let stored = battery.soc / 100.0 * BATTERY_KWH;
    let room = (SOC_MAX / 100.0).mul_add(BATTERY_KWH, -stored).max(0.0);
    let left = (SOC_MIN / 100.0).mul_add(-BATTERY_KWH, stored).max(0.0);
    let power = if surplus > 0.0 {
        surplus
            .min(BATTERY_W)
            .min(room * 1_000.0 / hours / CHARGE_EFFICIENCY)
    } else {
        -(-surplus).min(BATTERY_W).min(left * 1_000.0 / hours)
    };
    let stored = if power > 0.0 {
        (power * hours / 1_000.0).mul_add(CHARGE_EFFICIENCY, stored)
    } else {
        stored + power * hours / 1_000.0
    };
    battery.power = power;
    battery.soc = (stored / BATTERY_KWH * 100.0).clamp(SOC_MIN, SOC_MAX);
    battery.voltage = battery.soc.mul_add(0.6, 300.0);
    battery.current = power / battery.voltage;
    battery.temperature = power.abs().mul_add(0.0008, air.clamp(5.0, 25.0) + 3.0);
}

/// W the house draws through a day, by local hour.
const fn profile(hour: i64, weekend: bool) -> f64 {
    match (hour, weekend) {
        (0..=5, _) => 220.0,
        (6, false) | (8, true) => 500.0,
        (7..=8, false) | (9..=10, true) => 900.0,
        (12..=13, _) => 700.0,
        (17..=21, _) => 1_100.0,
        (22.., _) => 400.0,
        _ => 450.0,
    }
}

/// `model`'s operating point with its current scaled by `factor`; no current, no voltage.
fn scaled(model: Input, factor: f64) -> Input {
    let current = model.current * factor;
    let voltage = if current > 0.0 { model.voltage } else { 0.0 };
    Input {
        power: voltage * current,
        voltage,
        current,
    }
}
