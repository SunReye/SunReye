//! Throwaway connection tests, reads only (ADR 0005): dial an endpoint, read a device once with a profile,
//! or find the unit id a device answers on.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use utoipa::ToSchema;

use crate::decode::plan_reads;
use crate::modbus::{Client, Error};
use crate::poll::DevicePoller;
use crate::profile::Profile;
use crate::settings::InverterConfig;
use crate::store::NewConnection;

/// One decoded value of a test read.
#[derive(Debug, Serialize, ToSchema)]
pub struct SnapshotMetric {
    pub key: String,
    pub label: String,
    #[schema(required = true)]
    pub unit: Option<String>,
    pub group: String,
    pub value: f64,
}

/// The outcome of a test read: an error, or the captured snapshot.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub metric_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub metrics: Option<Vec<SnapshotMetric>>,
}

impl TestResult {
    pub fn failed(error: impl Into<String>) -> Self {
        Self { ok: false, error: Some(error.into()), metric_count: None, duration_ms: None, metrics: None }
    }
}

/// Reads the device once. Only reads: the same client and plan a poll uses, so a green test means a
/// poll will answer.
pub async fn test_connection(profile: &Arc<Profile>, config: &InverterConfig) -> TestResult {
    let started = Instant::now();
    let read = async {
        let transport = config.transport.wire();
        let serial = config.logger_serial();
        let mut client =
            Client::connect(transport, config.host(), config.port(), serial, config.timeout()).await?;
        DevicePoller::new(Arc::clone(profile), config.unit()).poll(&mut client).await
    };
    match read.await {
        Ok(values) if !any_register(profile, &values) => {
            TestResult::failed("No register of the profile answered")
        }
        Ok(values) => snapshot(profile, values, started),
        Err(error) => TestResult::failed(error.to_string()),
    }
}

/// The stick that answered an endpoint probe.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
pub struct Logger {
    pub serial: u32,
}

/// Whether something accepted a connection at an endpoint, as 3.x answers it.
#[derive(Debug, Serialize, ToSchema)]
pub struct EndpointProbe {
    pub ok: bool,
    pub ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub error: Option<String>,
    /// Over Solarman V5: the serial the stick named itself with.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub logger: Option<Logger>,
}

/// Connects to the endpoint and closes again. A gateway is a TCP connect; a Solarman stick must also
/// name its serial, and be the stick a configured serial names.
pub async fn probe_endpoint(endpoint: &NewConnection, timeout: Duration) -> EndpointProbe {
    let started = Instant::now();
    let NewConnection { transport, host, port, logger_serial } = endpoint;
    // No configured serial: a stick that stays silent must fail, not echo the operator's guess back.
    let answered = Client::connect(*transport, host, *port, None, timeout).await;
    let ms = elapsed_ms(started);
    let failed = |error: String| EndpointProbe { ok: false, ms, error: Some(error), logger: None };
    match answered.map(|client| client.logger_serial()) {
        Err(error) => failed(error.to_string()),
        Ok(Some(serial)) if logger_serial.is_some_and(|configured| configured != serial) => failed(format!(
            "{host}:{port} is logger {serial}, not the {} configured here: a different stick",
            logger_serial.unwrap_or_default()
        )),
        Ok(serial) => {
            EndpointProbe { ok: true, ms, error: None, logger: serial.map(|serial| Logger { serial }) }
        }
    }
}

/// The unit id that answered, and how long its read took.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoundUnit {
    pub unit_id: u8,
    pub ms: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnitScan {
    /// Every id asked, in order, so a miss names what was ruled out.
    pub scanned: Vec<u8>,
    #[schema(required = true)]
    pub found: Option<FoundUnit>,
}

/// Asks each candidate for the profile's first planned register, one word, and stops at the first that
/// answers. Any refusal is a miss; after one that may leave a reply in flight the connection is replaced.
pub async fn scan_units(
    profile: &Profile,
    endpoint: &NewConnection,
    candidates: &[u8],
    timeout: Duration,
) -> Result<UnitScan, Error> {
    let Some(register) = plan_reads(profile).first().map(|block| block.start) else {
        return Err(Error::Protocol("the profile maps no register to scan with"));
    };
    let NewConnection { transport, host, port, logger_serial } = endpoint;
    let mut client: Option<Client> = None;
    let mut scanned = Vec::new();
    for &unit in candidates {
        let open = match client.as_mut() {
            Some(open) => open,
            None => client.insert(Client::connect(*transport, host, *port, *logger_serial, timeout).await?),
        };
        scanned.push(unit);
        let started = Instant::now();
        match open.read_holding(unit, register, 1).await {
            Ok(_) => {
                return Ok(UnitScan {
                    scanned,
                    found: Some(FoundUnit { unit_id: unit, ms: elapsed_ms(started) }),
                });
            }
            Err(Error::Exception(_)) => {}
            Err(_) => client = None,
        }
    }
    Ok(UnitScan { scanned, found: None })
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Computed metrics read as zero from nothing, so only a register's answer proves the device spoke.
fn any_register(profile: &Profile, values: &[(String, f64)]) -> bool {
    values.iter().any(|(key, _)| profile.metrics.iter().any(|m| m.key == *key && m.is_register()))
}

fn snapshot(profile: &Profile, values: Vec<(String, f64)>, started: Instant) -> TestResult {
    let mut metrics: Vec<SnapshotMetric> = values
        .into_iter()
        .filter_map(|(key, value)| {
            let metric = profile.metrics.iter().find(|metric| metric.key == key)?;
            Some(SnapshotMetric {
                key: key.clone(),
                label: metric.label.clone().unwrap_or_else(|| key.clone()),
                unit: metric.unit.clone(),
                group: metric.group.clone().unwrap_or_else(|| "other".to_owned()),
                value,
            })
        })
        .collect();
    metrics.sort_by(|a, b| a.group.cmp(&b.group).then_with(|| a.label.cmp(&b.label)));
    let duration_ms = elapsed_ms(started);
    TestResult {
        ok: true,
        error: None,
        metric_count: Some(metrics.len()),
        duration_ms: Some(duration_ms),
        metrics: Some(metrics),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use sunreye_sim::{FC_READ_HOLDING, Framing, Registers, profile_case};

    use super::*;
    use crate::modbus::Transport as Wire;
    use crate::profile::Bundle;
    use crate::settings::Transport;
    use crate::support::Sim;

    fn config(port: u16, unit: i64) -> InverterConfig {
        InverterConfig {
            host: Some("127.0.0.1".into()),
            port: i64::from(port),
            transport: Transport::Tcp,
            unit_id: unit,
            timeout_ms: 300,
            poll_interval_ms: 1_000,
            simulate: false,
            logger_serial: None,
        }
    }

    fn profile(id: &str) -> Arc<Profile> {
        Bundle::official().expect("bundle").profile(id).expect("profile").clone()
    }

    #[tokio::test]
    async fn a_device_that_answers_yields_every_decoded_metric_with_its_label() {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let case = profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
        let sim = Sim::start(case.registers, &[1]).await;

        let result = test_connection(&profile("deye-sg05lp3"), &config(sim.addr.port(), 1)).await;

        assert!(result.ok, "{:?}", result.error);
        let metrics = result.metrics.expect("metrics");
        assert_eq!(result.metric_count, Some(metrics.len()));
        assert_eq!(metrics.len(), case.readings.len());
        for metric in &metrics {
            assert_eq!(case.readings.get(&metric.key), Some(&metric.value), "{}", metric.key);
            assert!(!metric.label.is_empty() && !metric.group.is_empty(), "{}", metric.key);
        }
        let order: Vec<_> = metrics.iter().map(|m| (m.group.as_str(), m.label.as_str())).collect();
        assert!(order.is_sorted(), "metrics are listed by group then label");
        assert!(result.duration_ms.is_some());
    }

    #[tokio::test]
    async fn a_solarman_stick_is_read_under_the_serial_it_names_whatever_serial_is_configured() {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let case = profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
        let stick = Framing::SolarmanV5(3_168_930_341);
        let sim = Sim::start_with(stick, case.registers, &[1]).await;
        for configured in [None, Some(0x1122_3344)] {
            let config = InverterConfig {
                transport: Transport::SolarmanV5,
                logger_serial: configured,
                ..config(sim.addr.port(), 1)
            };
            let result = test_connection(&profile("deye-sg05lp3"), &config).await;
            assert!(result.ok, "{configured:?}: {:?}", result.error);
            assert_eq!(result.metric_count, Some(case.readings.len()));
        }
    }

    #[tokio::test]
    async fn nothing_listening_fails_with_the_connection_error() {
        let (_closed, port) = crate::test_net::closed_port();
        let result = test_connection(&profile("deye-sg05lp3"), &config(port, 1)).await;
        assert!(!result.ok);
        assert!(result.error.expect("error").starts_with("i/o error"), "a refused connection");
        assert!(result.metrics.is_none() && result.metric_count.is_none());
    }

    #[tokio::test]
    async fn a_device_that_refuses_every_read_is_not_a_pass() {
        let sim = Sim::start(Registers::default(), &[1]).await;
        let result = test_connection(&profile("deye-sg05lp3"), &config(sim.addr.port(), 1)).await;
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("No register of the profile answered"));
    }

    const STICK: u32 = 3_168_930_341;
    const QUICK: Duration = Duration::from_millis(200);

    fn endpoint(transport: crate::modbus::Transport, port: u16, serial: Option<u32>) -> NewConnection {
        NewConnection { transport, host: "127.0.0.1".into(), port, logger_serial: serial }
    }

    fn ramp() -> sunreye_sim::ProfileCase {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case")
    }

    #[tokio::test]
    async fn a_gateway_probe_is_a_connect_and_sends_nothing() {
        let sim = Sim::start(ramp().registers, &[1]).await;
        let probe = probe_endpoint(&endpoint(Wire::Tcp, sim.addr.port(), None), QUICK).await;
        assert!(probe.ok && probe.error.is_none() && probe.logger.is_none(), "{probe:?}");
        assert_eq!(sim.requests(), []);
    }

    #[tokio::test]
    async fn a_stick_probe_names_the_stick_and_refuses_one_that_is_not_the_configured_serial() {
        let sim = Sim::start_with(Framing::SolarmanV5(STICK), ramp().registers, &[1]).await;
        let port = sim.addr.port();
        for configured in [None, Some(STICK)] {
            let probe = probe_endpoint(&endpoint(Wire::SolarmanV5, port, configured), QUICK).await;
            assert!(probe.ok, "{configured:?}: {probe:?}");
            assert_eq!(probe.logger.map(|logger| logger.serial), Some(STICK));
        }
        let other = probe_endpoint(&endpoint(Wire::SolarmanV5, port, Some(1234)), QUICK).await;
        assert!(!other.ok && other.logger.is_none());
        assert_eq!(
            other.error.as_deref(),
            Some(
                format!(
                    "127.0.0.1:{port} is logger {STICK}, not the 1234 configured here: a different stick"
                )
                .as_str()
            )
        );
    }

    #[tokio::test]
    async fn a_probe_of_nothing_listening_fails_with_the_connection_error() {
        let (_closed, port) = crate::test_net::closed_port();
        let probe = probe_endpoint(&endpoint(Wire::Tcp, port, None), QUICK).await;
        assert!(!probe.ok);
        assert!(probe.error.expect("error").starts_with("i/o error"));
    }

    #[tokio::test]
    async fn a_scan_stops_at_the_first_unit_that_answers_and_sends_only_one_register_reads() {
        for framing in [Framing::Tcp, Framing::RtuOverTcp, Framing::SolarmanV5(STICK)] {
            let sim = Sim::start_with(framing, ramp().registers, &[2, 3]).await;
            let wire = match framing {
                Framing::Tcp => Wire::Tcp,
                Framing::RtuOverTcp => Wire::RtuOverTcp,
                Framing::SolarmanV5(_) => Wire::SolarmanV5,
            };
            let at = endpoint(wire, sim.addr.port(), None);
            let scan = scan_units(&profile("deye-sg05lp3"), &at, &[1, 0, 2, 3], QUICK).await.expect("scan");
            assert_eq!(scan.scanned, [1, 0, 2], "{framing:?}");
            assert_eq!(scan.found.map(|found| found.unit_id), Some(2), "{framing:?}");
            let requests = sim.requests();
            assert_eq!(requests.len(), 1, "{framing:?}: one read at the unit that answered");
            assert!(
                requests.iter().all(|r| r.function == FC_READ_HOLDING && r.count == 1 && r.unit == 2),
                "{framing:?}: {requests:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_scan_nobody_answers_names_every_id_it_ruled_out() {
        let sim = Sim::start(ramp().registers, &[]).await;
        let at = endpoint(Wire::Tcp, sim.addr.port(), None);
        let scan = scan_units(&profile("deye-sg05lp3"), &at, &[1, 0], QUICK).await.expect("scan");
        assert_eq!((scan.scanned, scan.found.is_none()), (vec![1, 0], true));
    }

    #[tokio::test]
    async fn a_scan_of_nothing_listening_is_the_connection_error() {
        let (_closed, port) = crate::test_net::closed_port();
        let scan = scan_units(&profile("deye-sg05lp3"), &endpoint(Wire::Tcp, port, None), &[1], QUICK).await;
        assert!(matches!(scan, Err(Error::Io(_))), "{scan:?}");
    }

    #[tokio::test]
    async fn a_device_silent_on_the_unit_times_out() {
        let sim = Sim::start(Registers::default(), &[]).await;
        let result = test_connection(&profile("deye-sg05lp3"), &config(sim.addr.port(), 1)).await;
        assert_eq!(result.error.as_deref(), Some("timed out"));
    }
}
