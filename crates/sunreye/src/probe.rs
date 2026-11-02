//! A throwaway connection test: dial the device, read it once with a profile, report what answered.

use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use utoipa::ToSchema;

use crate::modbus::Client;
use crate::poll::DevicePoller;
use crate::profile::Profile;
use crate::settings::InverterConfig;

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
        let mut client = Client::connect(config.host(), config.port(), config.timeout()).await?;
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
    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
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

    use sunreye_sim::{Registers, Simulator, profile_case};

    use super::*;
    use crate::profile::Bundle;
    use crate::settings::Transport;

    fn config(port: u16, unit: i64) -> InverterConfig {
        InverterConfig {
            host: Some("127.0.0.1".into()),
            port: i64::from(port),
            transport: Transport::Tcp,
            unit_id: unit,
            timeout_ms: 300,
            poll_interval_ms: 1_000,
            simulate: false,
        }
    }

    fn profile(id: &str) -> Arc<Profile> {
        Bundle::official().expect("bundle").profile(id).expect("profile").clone()
    }

    #[tokio::test]
    async fn a_device_that_answers_yields_every_decoded_metric_with_its_label() {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let case = profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
        let sim = Simulator::start(case.registers, &[1]).await.expect("sim");

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
    async fn nothing_listening_fails_with_the_connection_error() {
        let free = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = free.local_addr().expect("addr").port();
        drop(free);
        let result = test_connection(&profile("deye-sg05lp3"), &config(port, 1)).await;
        assert!(!result.ok);
        assert!(result.error.expect("error").starts_with("i/o error"), "a refused connection");
        assert!(result.metrics.is_none() && result.metric_count.is_none());
    }

    #[tokio::test]
    async fn a_device_that_refuses_every_read_is_not_a_pass() {
        let sim = Simulator::start(Registers::default(), &[1]).await.expect("sim");
        let result = test_connection(&profile("deye-sg05lp3"), &config(sim.addr.port(), 1)).await;
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("No register of the profile answered"));
    }

    #[tokio::test]
    async fn a_device_silent_on_the_unit_times_out() {
        let sim = Simulator::start(Registers::default(), &[]).await.expect("sim");
        let result = test_connection(&profile("deye-sg05lp3"), &config(sim.addr.port(), 1)).await;
        assert_eq!(result.error.as_deref(), Some("timed out"));
    }
}
