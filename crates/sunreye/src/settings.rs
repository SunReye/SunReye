//! The connection and polling settings the onboarding endpoints read and write, kept in the store's
//! `setting`, `connection` and `device` tables. The device row follows from the connection and the
//! active profile: it exists once both do.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::modbus::UnknownTransport;
use crate::store::{NewConnection, NewDevice, Store, StoreError};

pub const INTERVAL_KEY: &str = "poll.interval_ms";
pub const TIMEOUT_KEY: &str = "poll.timeout_ms";
pub const PROFILE_KEY: &str = "profile.active";
const UNIT_KEY: &str = "inverter.unit_id";

pub const DEFAULT_PORT: u16 = 502;
const DEFAULT_UNIT: u8 = 0;
const DEFAULT_INTERVAL: Duration = Duration::from_secs(5);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(3);
const INTERVAL_RANGE_MS: std::ops::RangeInclusive<i64> = 1_000..=3_600_000;
const TIMEOUT_RANGE_MS: std::ops::RangeInclusive<i64> = 100..=60_000;

/// How the connection is framed on the wire. Only `tcp` is polled so far.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Transport {
    Tcp,
    RtuOverTcp,
    SolarmanV5,
}

impl Transport {
    const fn name(self) -> &'static str {
        match self {
            Self::Tcp => "tcp",
            Self::RtuOverTcp => "rtu-over-tcp",
            Self::SolarmanV5 => "solarman-v5",
        }
    }

    /// The core's framing for this transport; none for one it cannot poll.
    pub const fn wire(self) -> Option<crate::modbus::Transport> {
        match self {
            Self::Tcp => Some(crate::modbus::Transport::Tcp),
            Self::RtuOverTcp => Some(crate::modbus::Transport::RtuOverTcp),
            Self::SolarmanV5 => None,
        }
    }
}

/// The inverter connection as the onboarding form edits it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InverterConfig {
    /// Null until a connection is saved.
    #[schema(required = true)]
    pub host: Option<String>,
    pub port: i64,
    pub transport: Transport,
    pub unit_id: i64,
    /// Bounds the connect and every read of one poll.
    pub timeout_ms: i64,
    pub poll_interval_ms: i64,
    /// Always false: the core has no fake device.
    pub simulate: bool,
}

impl InverterConfig {
    /// What a save or a test needs: a reachable-looking endpoint the core can poll.
    pub fn validate(&self) -> Result<(), String> {
        let host_missing = self.host.as_deref().is_none_or(|host| host.trim().is_empty());
        let checks = [
            (host_missing, "Host is required"),
            (!(1..=65_535).contains(&self.port), "Port must be 1–65535"),
            (!(0..=255).contains(&self.unit_id), "Unit id must be 0–255"),
            (!TIMEOUT_RANGE_MS.contains(&self.timeout_ms), "Timeout must be 100–60000 ms"),
            (!INTERVAL_RANGE_MS.contains(&self.poll_interval_ms), "Poll interval must be 1000–3600000 ms"),
            (self.simulate, "Simulation is not available in this core"),
            (self.transport != Transport::Tcp, "Only the tcp transport is supported"),
        ];
        match checks.into_iter().find(|(failed, _)| *failed) {
            Some((_, message)) => Err(message.to_owned()),
            None => Ok(()),
        }
    }

    /// The validated unit id; a value `validate` refused reads as the default.
    pub fn unit(&self) -> u8 {
        u8::try_from(self.unit_id).unwrap_or(DEFAULT_UNIT)
    }

    pub fn port(&self) -> u16 {
        u16::try_from(self.port).unwrap_or(DEFAULT_PORT)
    }

    pub fn host(&self) -> &str {
        self.host.as_deref().unwrap_or_default().trim()
    }

    pub fn timeout(&self) -> Duration {
        Duration::from_millis(u64::try_from(self.timeout_ms).unwrap_or(0))
    }
}

/// The saved connection, or the defaults while none is saved.
pub async fn read_inverter(store: &Store) -> Result<InverterConfig, StoreError> {
    let connection = store.connection().await?;
    let (host, port) = match connection {
        Some(row) => (Some(row.host), row.port),
        None => (None, DEFAULT_PORT),
    };
    Ok(InverterConfig {
        host,
        port: i64::from(port),
        transport: Transport::Tcp,
        unit_id: i64::from(unit_id(store.setting(UNIT_KEY).await?.as_deref())),
        timeout_ms: millis(poll_timeout(store.setting(TIMEOUT_KEY).await?.as_deref())),
        poll_interval_ms: millis(poll_interval(store.setting(INTERVAL_KEY).await?.as_deref())),
        simulate: false,
    })
}

/// Persists a validated config and brings the device row in line with it.
pub async fn save_inverter(store: &Store, config: &InverterConfig) -> Result<(), StoreError> {
    let Some(transport) = config.transport.wire() else {
        return Err(UnknownTransport(config.transport.name().to_owned()).into());
    };
    let connection = NewConnection {
        transport,
        host: config.host().to_owned(),
        port: config.port(),
    };
    store.save_connection(&connection).await?;
    store.set_setting(UNIT_KEY, &config.unit().to_string()).await?;
    store.set_setting(TIMEOUT_KEY, &config.timeout_ms.to_string()).await?;
    store.set_setting(INTERVAL_KEY, &config.poll_interval_ms.to_string()).await?;
    reconcile(store).await
}

/// The profile the core is set up with, if one was chosen.
pub async fn active_profile(store: &Store) -> Result<Option<String>, StoreError> {
    store.setting(PROFILE_KEY).await
}

pub async fn set_active_profile(store: &Store, id: &str) -> Result<(), StoreError> {
    store.set_setting(PROFILE_KEY, id).await?;
    reconcile(store).await
}

/// Writes the device row once a connection and a profile are both saved.
async fn reconcile(store: &Store) -> Result<(), StoreError> {
    let (Some(connection), Some(profile_id)) = (store.connection().await?, active_profile(store).await?)
    else {
        return Ok(());
    };
    let unit_id = unit_id(store.setting(UNIT_KEY).await?.as_deref());
    store.save_device(&NewDevice { connection_id: connection.id, profile_id, unit_id }).await?;
    Ok(())
}

fn millis(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

fn unit_id(setting: Option<&str>) -> u8 {
    setting.and_then(|raw| raw.parse().ok()).unwrap_or(DEFAULT_UNIT)
}

/// The configured poll interval; a missing, malformed or zero value falls back to the default.
pub fn poll_interval(setting: Option<&str>) -> Duration {
    duration(INTERVAL_KEY, setting, DEFAULT_INTERVAL)
}

/// The configured request timeout, with the same fallback.
pub fn poll_timeout(setting: Option<&str>) -> Duration {
    duration(TIMEOUT_KEY, setting, DEFAULT_TIMEOUT)
}

fn duration(key: &str, setting: Option<&str>, default: Duration) -> Duration {
    match setting.map(str::parse::<u64>) {
        Some(Ok(millis @ 1..)) => Duration::from_millis(millis),
        Some(_) => {
            tracing::warn!(setting = key, "not a positive number of milliseconds, using the default");
            default
        }
        None => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> InverterConfig {
        InverterConfig {
            host: Some("10.0.0.5".into()),
            port: 502,
            transport: Transport::Tcp,
            unit_id: 1,
            timeout_ms: 2_000,
            poll_interval_ms: 1_000,
            simulate: false,
        }
    }

    fn refusal(change: impl FnOnce(&mut InverterConfig)) -> String {
        let mut config = config();
        change(&mut config);
        config.validate().expect_err("refused")
    }

    #[test]
    fn a_complete_config_is_valid_at_its_boundaries() {
        assert_eq!(config().validate(), Ok(()));
        for (port, unit, timeout, interval) in [(1, 0, 100, 1_000), (65_535, 255, 60_000, 3_600_000)] {
            let edge = InverterConfig {
                port,
                unit_id: unit,
                timeout_ms: timeout,
                poll_interval_ms: interval,
                ..config()
            };
            assert_eq!(edge.validate(), Ok(()), "{edge:?}");
        }
    }

    #[test]
    fn every_field_outside_its_range_is_refused_by_name() {
        assert_eq!(refusal(|c| c.host = None), "Host is required");
        assert_eq!(refusal(|c| c.host = Some("  ".into())), "Host is required");
        assert_eq!(refusal(|c| c.port = 0), "Port must be 1–65535");
        assert_eq!(refusal(|c| c.port = 65_536), "Port must be 1–65535");
    }

    #[test]
    fn unit_timeout_and_interval_outside_their_ranges_are_refused_by_name() {
        assert_eq!(refusal(|c| c.unit_id = -1), "Unit id must be 0–255");
        assert_eq!(refusal(|c| c.unit_id = 256), "Unit id must be 0–255");
        assert_eq!(refusal(|c| c.timeout_ms = 99), "Timeout must be 100–60000 ms");
        assert_eq!(refusal(|c| c.timeout_ms = 60_001), "Timeout must be 100–60000 ms");
        assert_eq!(refusal(|c| c.poll_interval_ms = 999), "Poll interval must be 1000–3600000 ms");
        assert_eq!(refusal(|c| c.poll_interval_ms = 3_600_001), "Poll interval must be 1000–3600000 ms");
    }

    #[test]
    fn simulation_and_unpolled_transports_are_refused() {
        assert_eq!(refusal(|c| c.simulate = true), "Simulation is not available in this core");
        assert_eq!(refusal(|c| c.transport = Transport::RtuOverTcp), "Only the tcp transport is supported");
        assert_eq!(refusal(|c| c.transport = Transport::SolarmanV5), "Only the tcp transport is supported");
    }

    #[test]
    fn a_host_is_saved_without_its_padding() {
        let padded = InverterConfig { host: Some("  gateway ".into()), ..config() };
        assert_eq!(padded.host(), "gateway");
    }

    #[test]
    fn the_durations_are_the_setting_or_the_default() {
        assert_eq!(poll_interval(Some("250")), Duration::from_millis(250));
        assert_eq!(poll_interval(Some("1")), Duration::from_millis(1));
        assert_eq!(poll_interval(None), DEFAULT_INTERVAL);
        assert_eq!(poll_timeout(Some("1500")), Duration::from_millis(1_500));
        assert_eq!(poll_timeout(None), DEFAULT_TIMEOUT);
        for bad in ["0", "-5", "soon", "", "1.5"] {
            assert_eq!(poll_interval(Some(bad)), DEFAULT_INTERVAL, "{bad:?}");
            assert_eq!(poll_timeout(Some(bad)), DEFAULT_TIMEOUT, "{bad:?}");
        }
    }

    #[tokio::test]
    async fn an_unconfigured_store_reads_as_the_defaults_without_a_host() {
        let store = Store::in_memory().await.expect("store");
        let read = read_inverter(&store).await.expect("read");
        let defaults = InverterConfig {
            host: None,
            port: 502,
            transport: Transport::Tcp,
            unit_id: 0,
            timeout_ms: 3_000,
            poll_interval_ms: 5_000,
            simulate: false,
        };
        assert_eq!(read, defaults);
        assert_eq!(active_profile(&store).await.expect("profile"), None);
    }

    #[tokio::test]
    async fn a_saved_config_reads_back_and_makes_no_device_until_a_profile_is_chosen() {
        let store = Store::in_memory().await.expect("store");
        save_inverter(&store, &config()).await.expect("save");
        assert_eq!(read_inverter(&store).await.expect("read"), config());
        assert_eq!(store.devices().await.expect("devices"), []);
    }

    #[tokio::test]
    async fn choosing_a_profile_after_saving_makes_the_device_and_a_later_save_edits_it() {
        let store = Store::in_memory().await.expect("store");
        save_inverter(&store, &config()).await.expect("save");
        set_active_profile(&store, "deye-sg01hp3").await.expect("profile");
        let devices = store.devices().await.expect("devices");
        let seen: Vec<_> =
            devices.iter().map(|d| (d.profile_id.as_str(), d.unit_id, d.host.as_str())).collect();
        assert_eq!(seen, [("deye-sg01hp3", 1, "10.0.0.5")]);

        let moved = InverterConfig { host: Some("gateway".into()), unit_id: 9, ..config() };
        save_inverter(&store, &moved).await.expect("save");
        let devices = store.devices().await.expect("devices");
        let seen: Vec<_> = devices.iter().map(|d| (d.id, d.unit_id, d.host.as_str())).collect();
        assert_eq!(seen, [(devices[0].id, 9, "gateway")], "one device, edited in place");
    }

    #[tokio::test]
    async fn choosing_a_profile_before_saving_waits_for_the_connection() {
        let store = Store::in_memory().await.expect("store");
        set_active_profile(&store, "deye-sg05lp3").await.expect("profile");
        assert_eq!(store.devices().await.expect("devices"), []);
        save_inverter(&store, &config()).await.expect("save");
        assert_eq!(store.devices().await.expect("devices")[0].profile_id, "deye-sg05lp3");
    }
}
