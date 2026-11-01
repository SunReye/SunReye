//! The running core: one polling task per configured device, readings committed minute by minute.

use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::watch;
use tokio::task::JoinSet;
use tokio::time::MissedTickBehavior;

use crate::modbus::Client;
use crate::poll::DevicePoller;
use crate::profile::{Bundle, Profile};
use crate::samples::{ClosedMinute, MinuteBuffer, Sample};
use crate::store::{DeviceRow, Store, StoreError};

const INTERVAL_SETTING: &str = "poll.interval_ms";
const DEFAULT_INTERVAL: Duration = Duration::from_secs(5);
/// Bounds the connect and every read of one poll.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("bundled profiles are unreadable: {0}")]
    Profiles(serde_json::Error),
}

/// Opens the store under `data_dir`, polls every device in it, and returns once `shutdown` resolves and
/// each device's open minute is stored.
pub async fn run(data_dir: &Path, shutdown: impl Future<Output = ()>) -> Result<(), RunError> {
    let store = Arc::new(Store::open(data_dir).await?);
    let (stop, stopped) = watch::channel(false);
    let mut tasks = spawn_devices(&store, &stopped).await?;
    shutdown.await;
    stop.send_replace(true);
    while tasks.join_next().await.is_some() {}
    if let Some(store) = Arc::into_inner(store) {
        store.close().await;
    }
    Ok(())
}

async fn spawn_devices(store: &Arc<Store>, stopped: &watch::Receiver<bool>) -> Result<JoinSet<()>, RunError> {
    let bundle = Bundle::official().map_err(RunError::Profiles)?;
    let interval = configured_interval(store).await?;
    let mut tasks = JoinSet::new();
    for device in store.devices().await? {
        match bundle.profile(&device.profile_id) {
            Some(profile) => {
                let task = DeviceTask::new(Arc::clone(store), device, Arc::clone(profile));
                tasks.spawn(task.run(interval, stopped.clone()));
            }
            None => log_unknown_profile(&device),
        }
    }
    Ok(tasks)
}

fn log_unknown_profile(device: &DeviceRow) {
    tracing::error!(device = device.id, profile = %device.profile_id, "unknown profile, device not polled");
}

async fn configured_interval(store: &Store) -> Result<Duration, StoreError> {
    Ok(poll_interval(store.setting(INTERVAL_SETTING).await?.as_deref()))
}

/// The configured interval; a missing, malformed or zero value falls back to the default.
fn poll_interval(setting: Option<&str>) -> Duration {
    match setting.map(str::parse::<u64>) {
        Some(Ok(millis @ 1..)) => Duration::from_millis(millis),
        Some(_) => {
            tracing::warn!(
                setting = INTERVAL_SETTING,
                "not a positive number of milliseconds, using the default"
            );
            DEFAULT_INTERVAL
        }
        None => DEFAULT_INTERVAL,
    }
}

/// One device's polling state: its connection, its plan and the minute in progress.
struct DeviceTask {
    store: Arc<Store>,
    device: DeviceRow,
    poller: DevicePoller,
    buffer: MinuteBuffer,
    client: Option<Client>,
}

impl DeviceTask {
    fn new(store: Arc<Store>, device: DeviceRow, profile: Arc<Profile>) -> Self {
        let poller = DevicePoller::new(profile, device.unit_id);
        Self { store, device, poller, buffer: MinuteBuffer::default(), client: None }
    }

    /// Polls every `interval` until `stopped` changes, then stores the minute in progress.
    async fn run(mut self, interval: Duration, mut stopped: watch::Receiver<bool>) {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                biased;
                _ = stopped.changed() => break,
                _ = ticker.tick() => self.tick().await,
            }
        }
        if let Some(closed) = self.buffer.take() {
            save(&self.store, self.device.id, &closed).await;
        }
    }

    async fn tick(&mut self) {
        let at_ms = now_ms();
        match self.poll_once().await {
            Ok(values) => self.record(Sample { at_ms, values }).await,
            Err(error) => self.lost(&error),
        }
    }

    async fn record(&mut self, sample: Sample) {
        if let Some(closed) = self.buffer.push(sample) {
            save(&self.store, self.device.id, &closed).await;
        }
    }

    /// The connection is dropped: the next tick dials again.
    fn lost(&mut self, error: &crate::modbus::Error) {
        tracing::warn!(device = self.device.id, %error, "poll failed");
        self.client = None;
    }

    async fn poll_once(&mut self) -> Result<Vec<(String, f64)>, crate::modbus::Error> {
        let client = match &mut self.client {
            Some(client) => client,
            none => none.insert(connect(&self.device).await?),
        };
        self.poller.poll(client).await
    }
}

async fn connect(device: &DeviceRow) -> Result<Client, crate::modbus::Error> {
    Client::connect(device.transport, &device.host, device.port, REQUEST_TIMEOUT).await
}

async fn save(store: &Store, device_id: i64, closed: &ClosedMinute) {
    if let Err(error) = store.append_minute(device_id, closed).await {
        tracing::error!(device = device_id, minute = closed.minute, %error, "minute not stored");
    }
}

fn now_ms() -> i64 {
    let since_epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    i64::try_from(since_epoch.as_millis()).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Instant;

    use sunreye_sim::{FC_READ_HOLDING, Simulator, profile_case};

    use super::*;
    use crate::modbus::Transport;
    use crate::store::{NewConnection, NewDevice};

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sunreye-run-{name}-{}", std::process::id()));
        drop(std::fs::remove_dir_all(&dir));
        dir
    }

    async fn seed(dir: &Path, port: u16, profile: &str, interval: &str) -> i64 {
        seed_over(Transport::Tcp, dir, port, profile, interval).await
    }

    async fn seed_over(transport: Transport, dir: &Path, port: u16, profile: &str, interval: &str) -> i64 {
        let store = Store::open(dir).await.expect("store");
        store.set_setting(INTERVAL_SETTING, interval).await.expect("interval");
        let connection = store
            .add_connection(&NewConnection { transport, host: "127.0.0.1".into(), port })
            .await
            .expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: profile.into(), unit_id: 1 };
        let id = store.add_device(&device).await.expect("device");
        store.close().await;
        id
    }

    async fn stored(dir: &Path, device: i64) -> Vec<Sample> {
        let store = Store::open(dir).await.expect("store");
        let samples = store.readings(device, 0, i64::MAX).await.expect("readings");
        store.close().await;
        samples
    }

    async fn wait_for_requests(sim: &Simulator, at_least: usize) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while sim.requests().len() < at_least {
            assert!(Instant::now() < deadline, "the simulator was not polled");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[test]
    fn the_interval_is_the_setting_or_the_default() {
        assert_eq!(poll_interval(Some("250")), Duration::from_millis(250));
        assert_eq!(poll_interval(Some("1")), Duration::from_millis(1));
        assert_eq!(poll_interval(None), DEFAULT_INTERVAL);
        for bad in ["0", "-5", "soon", "", "1.5"] {
            assert_eq!(poll_interval(Some(bad)), DEFAULT_INTERVAL, "{bad:?}");
        }
    }

    #[tokio::test]
    async fn a_polled_device_is_stored_when_the_core_stops() {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let case = profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
        let sim = Simulator::start(case.registers, &[1]).await.expect("sim");
        let dir = dir("stop");
        let device = seed(&dir, sim.addr.port(), "deye-sg05lp3", "50").await;

        run(&dir, wait_for_requests(&sim, 40)).await.expect("run");

        assert!(sim.requests().iter().all(|r| r.function == FC_READ_HOLDING), "the core only reads");
        let samples = stored(&dir, device).await;
        assert!(samples.len() >= 2, "{} samples", samples.len());
        let mut want: Vec<(String, f64)> = case.readings.into_iter().collect();
        want.sort_by(|a, b| a.0.cmp(&b.0));
        for sample in &samples {
            let mut got = sample.values.clone();
            got.sort_by(|a, b| a.0.cmp(&b.0));
            assert_eq!(got, want);
        }
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn an_unreachable_device_stores_nothing_and_does_not_stop_the_core() {
        let free = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = free.local_addr().expect("addr").port();
        drop(free);
        let dir = dir("unreachable");
        let device = seed(&dir, port, "deye-sg05lp3", "20").await;
        run(&dir, tokio::time::sleep(Duration::from_millis(200))).await.expect("run");
        assert_eq!(stored(&dir, device).await, []);
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_device_with_an_unknown_profile_is_skipped() {
        let dir = dir("unknown");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        run(&dir, tokio::time::sleep(Duration::from_millis(100))).await.expect("run");
        assert_eq!(stored(&dir, device).await, []);
        drop(std::fs::remove_dir_all(&dir));
    }
}
