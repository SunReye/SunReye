//! The running core: the store, one polling task per stored device, the retention pass and the HTTP
//! server over them.

use std::future::{Future, IntoFuture};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rustls::pki_types::CertificateDer;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot, watch};
use tokio::task::JoinSet;
use tokio::time::MissedTickBehavior;

use crate::live::Live;
use crate::modbus::Client;
use crate::poll::DevicePoller;
use crate::profile::{Bundle, Profile};
use crate::retention::retain;
use crate::samples::{ClosedMinute, MinuteBuffer, Sample};
use crate::settings::{INTERVAL_KEY, TIMEOUT_KEY, poll_interval, poll_timeout};
use crate::sources::{find_profile, installed};
use crate::store::{DeviceRow, Store, StoreError};

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("bundled profiles are unreadable: {0}")]
    Profiles(serde_json::Error),
    #[error("http server failed: {0}")]
    Serve(#[from] std::io::Error),
}

/// What the HTTP handlers act on: the store, the profiles this binary ships and the device tasks.
#[derive(Debug)]
pub struct Core {
    pub store: Arc<Store>,
    pub bundle: Bundle,
    /// Certificate authorities trusted besides the built-in store when a profile source is fetched.
    pub roots: Vec<CertificateDer<'static>>,
    /// Every decoded reading, as the `/ws` frames.
    pub live: Arc<Live>,
    /// Unix milliseconds now; a field so a test can stand the clock where its readings are.
    now: fn() -> i64,
    polling: Polling,
    retention: Mutex<Option<Running>>,
}

impl Core {
    /// Opens the store under `data_dir` and polls every device in it.
    pub async fn open(data_dir: &Path) -> Result<Arc<Self>, RunError> {
        Self::open_trusting(data_dir, Vec::new()).await
    }

    /// [`Core::open`] that also trusts `roots` for profile sources, for a private certificate authority.
    pub async fn open_trusting(
        data_dir: &Path,
        roots: Vec<CertificateDer<'static>>,
    ) -> Result<Arc<Self>, RunError> {
        Self::open_clocked(data_dir, roots, now_ms).await
    }

    /// [`Core::open`] with the clock standing where `now` says.
    #[cfg(test)]
    pub(crate) async fn open_at(data_dir: &Path, now: fn() -> i64) -> Result<Arc<Self>, RunError> {
        Self::open_clocked(data_dir, Vec::new(), now).await
    }

    async fn open_clocked(
        data_dir: &Path,
        roots: Vec<CertificateDer<'static>>,
        now: fn() -> i64,
    ) -> Result<Arc<Self>, RunError> {
        let store = Arc::new(Store::open(data_dir).await?);
        let bundle = Bundle::official().map_err(RunError::Profiles)?;
        let live = Arc::default();
        let retention = Mutex::new(Some(spawn_retention(&store, now)));
        let core = Arc::new(Self { store, bundle, roots, live, now, polling: Polling::default(), retention });
        core.apply().await?;
        Ok(core)
    }

    pub fn now_ms(&self) -> i64 {
        (self.now)()
    }

    /// The compiled-in profile `id`, else the one a profile source supplied.
    pub async fn profile(&self, id: &str) -> Result<Option<Arc<Profile>>, StoreError> {
        let installed = installed(&self.store).await?;
        Ok(find_profile(&self.bundle, &installed, id))
    }

    /// Polls the devices the store describes now; called after every settings change.
    pub async fn apply(&self) -> Result<(), StoreError> {
        self.polling.restart(&self.store, &self.bundle, &self.live).await
    }

    /// Stops the device tasks, each storing its open minute, and the retention pass, and closes the store.
    pub async fn stop(self: Arc<Self>) {
        self.polling.stop().await;
        stop(self.retention.lock().await.take()).await;
        if let Some(core) = Arc::into_inner(self)
            && let Some(store) = Arc::into_inner(core.store)
        {
            store.close().await;
        }
    }
}

/// Serves HTTP on `listener` and polls every device in the store under `data_dir`. Returns once
/// `shutdown` resolves, in-flight requests are answered and each device's open minute is stored.
pub async fn run(
    data_dir: &Path,
    web: &crate::web::Config,
    listener: TcpListener,
    shutdown: impl Future<Output = ()>,
) -> Result<(), RunError> {
    let core = Core::open(data_dir).await?;
    warn_if_sign_up_is_exposed(&core, &listener).await;
    let served = serve(listener, crate::web::router(Arc::clone(&core), web), shutdown).await;
    core.stop().await;
    Ok(served?)
}

/// Until the admin exists, whoever reaches sign-up first becomes it.
async fn warn_if_sign_up_is_exposed(core: &Core, listener: &TcpListener) {
    let Ok(listen) = listener.local_addr() else { return };
    let admin_exists = matches!(core.store.has_accounts().await, Ok(true));
    if listen.ip().is_loopback() || admin_exists {
        return;
    }
    tracing::warn!(
        %listen,
        "listen address is not loopback and sign-up is open: anyone who reaches it first becomes the admin; \
         sign up the admin now, or restart with --listen 127.0.0.1:<port>"
    );
}

async fn serve(
    listener: TcpListener,
    app: axum::Router,
    shutdown: impl Future<Output = ()>,
) -> std::io::Result<()> {
    let (signal, signalled) = oneshot::channel::<()>();
    let app = app.into_make_service_with_connect_info::<std::net::SocketAddr>();
    let server = axum::serve(listener, app).with_graceful_shutdown(async { drop(signalled.await) });
    let mut server = std::pin::pin!(server.into_future());
    tokio::select! {
        result = &mut server => result,
        () = shutdown => {
            signal.send(()).ok();
            server.await
        }
    }
}

/// The running device tasks. [`Polling::restart`] replaces them with the ones the store describes.
#[derive(Debug, Default)]
pub struct Polling {
    running: Mutex<Option<Running>>,
}

#[derive(Debug)]
struct Running {
    stop: watch::Sender<bool>,
    tasks: JoinSet<()>,
}

impl Polling {
    /// Stops the running tasks, each storing its open minute, then polls every device in the store.
    pub async fn restart(
        &self,
        store: &Arc<Store>,
        bundle: &Bundle,
        live: &Arc<Live>,
    ) -> Result<(), StoreError> {
        let mut running = self.running.lock().await;
        stop(running.take()).await;
        *running = Some(spawn_devices(store, bundle, live).await?);
        Ok(())
    }

    /// Stops the tasks once each device's open minute is stored.
    pub async fn stop(&self) {
        stop(self.running.lock().await.take()).await;
    }
}

async fn stop(running: Option<Running>) {
    let Some(Running { stop, mut tasks }) = running else { return };
    stop.send_replace(true);
    while tasks.join_next().await.is_some() {}
}

async fn spawn_devices(store: &Arc<Store>, bundle: &Bundle, live: &Arc<Live>) -> Result<Running, StoreError> {
    let interval = poll_interval(store.setting(INTERVAL_KEY).await?.as_deref());
    let timeout = poll_timeout(store.setting(TIMEOUT_KEY).await?.as_deref());
    let (stop, stopped) = watch::channel(false);
    let mut tasks = JoinSet::new();
    let installed = installed(store).await?;
    let mut polled = Vec::new();
    for device in store.devices().await? {
        match find_profile(bundle, &installed, &device.profile_id) {
            Some(profile) => {
                polled.push(device.id);
                let task = DeviceTask::new(Arc::clone(store), Arc::clone(live), device, profile, timeout);
                tasks.spawn(task.run(interval, stopped.clone()));
            }
            None => log_unknown_profile(&device),
        }
    }
    live.roster(&polled);
    Ok(Running { stop, tasks })
}

fn spawn_retention(store: &Arc<Store>, now: fn() -> i64) -> Running {
    let (stop, stopped) = watch::channel(false);
    let mut tasks = JoinSet::new();
    tasks.spawn(retention(Arc::clone(store), now, stopped));
    Running { stop, tasks }
}

const RETENTION_EVERY: Duration = Duration::from_hours(1);

/// Runs the retention pass at start and hourly until `stopped` changes.
async fn retention(store: Arc<Store>, now: fn() -> i64, mut stopped: watch::Receiver<bool>) {
    let mut ticker = tokio::time::interval(RETENTION_EVERY);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = stopped.changed() => break,
            _ = ticker.tick() => retain_now(&store, now()).await,
        }
    }
}

async fn retain_now(store: &Store, now_ms: i64) {
    let now = jiff::Timestamp::from_millisecond(now_ms).unwrap_or(jiff::Timestamp::MAX);
    if let Err(error) = retain(store, now).await {
        tracing::error!(%error, "retention pass failed");
    }
}

fn log_unknown_profile(device: &DeviceRow) {
    tracing::error!(device = device.id, profile = %device.profile_id, "unknown profile, device not polled");
}

/// One device's polling state: its connection, its plan and the minute in progress.
struct DeviceTask {
    store: Arc<Store>,
    live: Arc<Live>,
    device: DeviceRow,
    poller: DevicePoller,
    buffer: MinuteBuffer,
    client: Option<Client>,
    timeout: Duration,
}

impl DeviceTask {
    fn new(
        store: Arc<Store>,
        live: Arc<Live>,
        device: DeviceRow,
        profile: Arc<Profile>,
        timeout: Duration,
    ) -> Self {
        let poller = DevicePoller::new(profile, device.unit_id);
        Self { store, live, device, poller, buffer: MinuteBuffer::default(), client: None, timeout }
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
        self.live.publish(self.device.id, &sample);
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
            none => none.insert(
                Client::connect(
                    self.device.transport,
                    &self.device.host,
                    self.device.port,
                    self.device.logger_serial,
                    self.timeout,
                )
                .await?,
            ),
        };
        self.poller.poll(client).await
    }
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
    use std::time::{Duration, Instant};

    use sunreye_sim::{FC_READ_HOLDING, Simulator, profile_case};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use jiff::Timestamp;

    use super::*;
    use crate::modbus::Transport;
    use crate::rollup::Tier;
    use crate::samples::{MINUTE_MS, Sample, minute_of};
    use crate::settings::INTERVAL_KEY;
    use crate::store::{NewConnection, NewDevice};
    use crate::web::Config;

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
        store.set_setting(INTERVAL_KEY, interval).await.expect("interval");
        let connection = store
            .add_connection(&NewConnection { transport, host: "127.0.0.1".into(), port, logger_serial: None })
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

    async fn wait(signal: oneshot::Receiver<()>) {
        signal.await.ok();
    }

    async fn listener() -> TcpListener {
        TcpListener::bind("127.0.0.1:0").await.expect("bind")
    }

    #[tokio::test]
    async fn a_polled_device_is_stored_when_the_core_stops() {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let case = profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
        let sim = Simulator::start(case.registers, &[1]).await.expect("sim");
        let dir = dir("stop");
        let device = seed(&dir, sim.addr.port(), "deye-sg05lp3", "50").await;

        run(&dir, &Config::default(), listener().await, wait_for_requests(&sim, 40)).await.expect("run");

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
        let free = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = free.local_addr().expect("addr").port();
        drop(free);
        let dir = dir("unreachable");
        let device = seed(&dir, port, "deye-sg05lp3", "20").await;
        run(&dir, &Config::default(), listener().await, tokio::time::sleep(Duration::from_millis(200)))
            .await
            .expect("run");
        assert_eq!(stored(&dir, device).await, []);
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn the_running_core_drops_buckets_past_retention_and_keeps_the_rest() {
        let dir = dir("retention");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        let store = Store::open(&dir).await.expect("store");
        let now = now_ms();
        for at_ms in [now - 91 * 24 * 60 * MINUTE_MS, now - 89 * 24 * 60 * MINUTE_MS] {
            let sample = Sample { at_ms, values: vec![("power".into(), 1.0)] };
            let minute = ClosedMinute { minute: minute_of(at_ms), samples: vec![sample] };
            store.append_minute(device, &minute).await.expect("append");
        }
        store.close().await;

        run(&dir, &Config::default(), listener().await, tokio::time::sleep(Duration::from_millis(200)))
            .await
            .expect("run");

        let store = Store::open(&dir).await.expect("store");
        let minutes = store.buckets(Tier::Minute, device, "power").await.expect("buckets");
        let kept = Timestamp::from_millisecond(minute_of(now - 89 * 24 * 60 * MINUTE_MS) * MINUTE_MS);
        assert_eq!(minutes.iter().map(|b| b.start).collect::<Vec<_>>(), [kept.expect("instant")]);
        assert_eq!(store.buckets(Tier::Hour, device, "power").await.expect("buckets").len(), 2);
        store.close().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_settings_change_runs_no_retention_pass() {
        let dir = dir("apply-retention");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        let core = Core::open(&dir).await.expect("open");
        tokio::time::sleep(Duration::from_millis(200)).await;
        let at_ms = now_ms() - 91 * 24 * 60 * MINUTE_MS;
        let sample = Sample { at_ms, values: vec![("power".into(), 1.0)] };
        let minute = ClosedMinute { minute: minute_of(at_ms), samples: vec![sample] };
        core.store.append_minute(device, &minute).await.expect("append");

        core.apply().await.expect("apply");
        tokio::time::sleep(Duration::from_millis(200)).await;

        let minutes = core.store.buckets(Tier::Minute, device, "power").await.expect("buckets");
        assert_eq!(minutes.len(), 1, "the next pass is an hour after start");
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_device_with_an_unknown_profile_is_skipped() {
        let dir = dir("unknown");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        run(&dir, &Config::default(), listener().await, tokio::time::sleep(Duration::from_millis(100)))
            .await
            .expect("run");
        assert_eq!(stored(&dir, device).await, []);
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn the_core_answers_http_until_it_is_told_to_stop() {
        let dir = dir("http");
        let listener = listener().await;
        let addr = listener.local_addr().expect("addr");
        let (stop, stopped) = oneshot::channel::<()>();
        let core = tokio::spawn(async move { run(&dir, &Config::default(), listener, wait(stopped)).await });
        let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let request = "GET /api/profile-status HTTP/1.1\r\nhost: sunreye\r\nconnection: close\r\n\r\n";
        stream.write_all(request.as_bytes()).await.expect("send");
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.expect("reply");
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        stop.send(()).ok();
        core.await.expect("join").expect("run");
    }
}
