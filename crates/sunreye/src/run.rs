//! The running core: the store, one polling task per stored device, the retention pass and the HTTP
//! server over them.

use std::future::{Future, IntoFuture};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use std::time::Duration;

use rustls::pki_types::CertificateDer;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, oneshot, watch};
use tokio::task::JoinSet;
use tokio::time::MissedTickBehavior;

use crate::conditions::{Conditions, Reading};
use crate::events::{Bus, Changed, Events};
use crate::learn;
use crate::live::Live;
use crate::modbus::Client;
use crate::mqtt::{self, Exports, config::MqttConfig};
use crate::open_meteo;
use crate::plant::{self, Aggregates};
use crate::poll::DevicePoller;
use crate::profile::{Bundle, Profile};
use crate::refresh;
use crate::retention::hourly;
use crate::samples::{ClosedMinute, Sample, Unstored};
use crate::settings::{INTERVAL_KEY, TIMEOUT_KEY, kiosk, poll_interval, poll_timeout, set_kiosk};
use crate::solar::{Served, Solar};
use crate::sources::{find_profile, installed};
use crate::store::{DeviceRow, Store, StoreError};

mod clock;

pub(crate) use clock::Clock;

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("bundled profiles are unreadable: {0}")]
    Profiles(serde_json::Error),
    #[error("http server failed: {0}")]
    Serve(#[from] std::io::Error),
    #[error("the held archive upload cannot be removed: {0}")]
    Upload(std::io::Error),
}

/// The store serialises reads on one connection: strangers keep no more than this in flight, so a
/// session's read never queues behind a crowd of them.
const STRANGER_READS: usize = 6;

/// The fetch URLs of a test core that is not given a stand-in.
#[cfg(test)]
fn offline() -> (String, String) {
    let url = &crate::support::Offline::shared().url;
    (url.clone(), url.clone())
}

/// What the HTTP handlers act on: the store, the profiles this binary ships and the device tasks.
#[derive(Debug)]
pub struct Core {
    pub store: Arc<Store>,
    pub bundle: Bundle,
    /// Certificate authorities trusted besides the built-in store when a profile source is fetched.
    pub roots: Vec<CertificateDer<'static>>,
    /// The core's topics; `/ws` is one subscriber.
    pub bus: Arc<Bus>,
    /// Folds every decoded reading into the plant and publishes both.
    pub live: Arc<Live>,
    /// Each device's polled readings not yet in the store.
    pub unstored: Arc<Unstored>,
    pub solar: Solar,
    pub conditions: Conditions,
    /// The MQTT export of every in-service device.
    pub exports: Arc<Exports>,
    /// Open-Meteo's reanalysis archive, or a stand-in.
    pub archive_url: String,
    /// The kiosk view as last stored, so a stranger's `/ws` closes when it turns off.
    kiosk: watch::Sender<bool>,
    stranger_reads: Arc<Semaphore>,
    /// Stamps every poll and decides "now" for retention, the refreshes and the requests.
    clock: Clock,
    polling: Polling,
    retention: Mutex<Option<Running>>,
    learning: Mutex<Option<Running>>,
    /// The conditions and forecast refresh loops.
    refreshing: Mutex<Option<Running>>,
    /// Restarts the MQTT export when a store change alters what it plans from, and feeds it the forecast.
    exporting: Mutex<Option<Running>>,
    /// Held for a whole archive import and while a device is added, so a device cannot appear between the
    /// import's empty-store check and its landing; holds the upload awaiting the guard's confirmation,
    /// with the admin who sent it. In memory: a restart drops it, and the held upload with it.
    pub imports: Arc<Mutex<Option<crate::web::Awaiting>>>,
    /// Archive imports, each its own task so a dropped request does not stop it; [`Core::stop`] waits for them.
    importing: Mutex<Option<Running>>,
    /// Where an uploaded archive waits for its import.
    pub upload: PathBuf,
    #[cfg(test)]
    pub(crate) seams: Arc<Seams>,
}

/// Signalled when an import reaches it; the import goes on once the receiver resolves and panics when its
/// sender is dropped.
#[cfg(test)]
pub(crate) type Pause = (oneshot::Sender<()>, oneshot::Receiver<()>);

/// What `apply` does on a test core instead of its next restart.
#[cfg(test)]
#[derive(Debug)]
pub(crate) enum Fault {
    Fail,
    Panic,
}

/// What a test core observes and holds; shared, so a test reads it after [`Core::stop`].
#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct Seams {
    /// Set by [`Core::open_unpolled`]: `apply` records itself and polls nothing.
    unpolled: std::sync::atomic::AtomicBool,
    /// `"apply"` for each `apply` of an unpolled core; `"polling stopped"` and `"store closed"` as `stop` does
    /// them.
    pub events: std::sync::Mutex<Vec<&'static str>>,
    /// Where an import waits before it lands.
    pub import_pause: std::sync::Mutex<Option<Pause>>,
    /// Where an import waits after it lands, before it polls what it added.
    pub apply_pause: std::sync::Mutex<Option<Pause>>,
    /// Taken one per `apply`, before it polls.
    pub apply_faults: std::sync::Mutex<std::collections::VecDeque<Fault>>,
}

#[cfg(test)]
impl Seams {
    fn record(&self, event: &'static str) {
        self.events.lock().expect("events").push(event);
    }

    /// What `apply` answers instead of polling, if anything.
    fn apply(&self) -> Option<Result<(), StoreError>> {
        let fault = self.apply_faults.lock().expect("faults").pop_front();
        match fault {
            Some(Fault::Fail) => return Some(Err(StoreError::Corrupt("setting"))),
            Some(Fault::Panic) => panic!("apply fault"),
            None => {}
        }
        self.unpolled.load(std::sync::atomic::Ordering::SeqCst).then(|| {
            self.record("apply");
            Ok(())
        })
    }
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
        let urls = (open_meteo::URL.into(), open_meteo::ARCHIVE_URL.into());
        Self::open_clocked(data_dir, roots, Clock::wall(), urls, learn::learn_logged).await
    }

    /// [`Core::open`] on `clock`.
    #[cfg(test)]
    pub(crate) async fn open_at(data_dir: &Path, clock: Clock) -> Result<Arc<Self>, RunError> {
        let urls = offline();
        Self::open_clocked(data_dir, Vec::new(), clock, urls, learn::learn_logged).await
    }

    /// [`Core::open_at`] on the wall clock, learning with `job`.
    #[cfg(test)]
    pub(crate) async fn open_learning(data_dir: &Path, job: learn::Job) -> Result<Arc<Self>, RunError> {
        let urls = offline();
        Self::open_clocked(data_dir, Vec::new(), Clock::wall(), urls, job).await
    }

    /// [`Core::open_at`] fetching the forecast and the archive from `urls`, trusting `roots`.
    #[cfg(test)]
    pub(crate) async fn open_forecasting(
        data_dir: &Path,
        roots: Vec<CertificateDer<'static>>,
        urls: (String, String),
        clock: Clock,
    ) -> Result<Arc<Self>, RunError> {
        Self::open_clocked(data_dir, roots, clock, urls, learn::learn_logged).await
    }

    async fn open_clocked(
        data_dir: &Path,
        roots: Vec<CertificateDer<'static>>,
        clock: Clock,
        (forecast_url, archive_url): (String, String),
        learn: learn::Job,
    ) -> Result<Arc<Self>, RunError> {
        let core = Self::start(data_dir, roots, clock, (forecast_url, archive_url)).await?;
        core.spawn_background(learn).await;
        *core.exporting.lock().await = Some(spawn_export(&core));
        core.apply().await?;
        Ok(core)
    }

    /// [`Core::open_at`] that polls no device.
    #[cfg(test)]
    pub(crate) async fn open_unpolled(data_dir: &Path, clock: Clock) -> Result<Arc<Self>, RunError> {
        let urls = offline();
        let core = Self::start(data_dir, Vec::new(), clock, urls).await?;
        core.spawn_background(learn::learn_logged).await;
        core.seams.unpolled.store(true, std::sync::atomic::Ordering::SeqCst);
        core.apply().await?;
        Ok(core)
    }

    /// [`Core::open_at`] fetching everything from `url`, with no refresh loop or learn run: only a request
    /// path fetches.
    #[cfg(test)]
    pub(crate) async fn open_still(
        data_dir: &Path,
        url: String,
        clock: Clock,
    ) -> Result<Arc<Self>, RunError> {
        let core = Self::start(data_dir, Vec::new(), clock, (url.clone(), url)).await?;
        *core.exporting.lock().await = Some(spawn_export(&core));
        core.apply().await?;
        Ok(core)
    }

    async fn start(
        data_dir: &Path,
        roots: Vec<CertificateDer<'static>>,
        clock: Clock,
        (forecast_url, archive_url): (String, String),
    ) -> Result<Arc<Self>, RunError> {
        let store = Arc::new(Store::open(data_dir).await?);
        let upload = data_dir.join(crate::web::UPLOAD_FILE);
        for left in [&upload, &data_dir.join(crate::web::PART_FILE)] {
            if let Err(error) = std::fs::remove_file(left)
                && error.kind() != std::io::ErrorKind::NotFound
            {
                return Err(RunError::Upload(error));
            }
        }
        let bundle = Bundle::official().map_err(RunError::Profiles)?;
        let bus = Arc::new(Bus { changed: store.changed().clone(), ..Bus::default() });
        let retention = Mutex::new(Some(spawn_retention(&store, clock)));
        #[cfg(test)]
        let seams = Arc::<Seams>::default();
        let polling = Polling {
            #[cfg(test)]
            seams: Arc::clone(&seams),
            ..Polling::default()
        };
        let kiosk = watch::Sender::new(kiosk(&store).await?);
        let core = Arc::new(Self {
            store,
            bundle,
            roots,
            live: Arc::new(Live::new(Arc::clone(&bus))),
            bus,
            unstored: Arc::default(),
            conditions: Conditions::new(forecast_url.clone()),
            solar: Solar::new(forecast_url),
            exports: Arc::default(),
            archive_url,
            kiosk,
            stranger_reads: Arc::new(Semaphore::new(STRANGER_READS)),
            clock,
            polling,
            retention,
            learning: Mutex::new(None),
            refreshing: Mutex::new(None),
            exporting: Mutex::new(None),
            imports: Arc::default(),
            importing: Mutex::new(Some(Running { stop: watch::Sender::new(false), tasks: JoinSet::new() })),
            upload,
            #[cfg(test)]
            seams,
        });
        Ok(core)
    }

    /// The correction's learn runs and the weather refresh loops.
    async fn spawn_background(self: &Arc<Self>, learn: learn::Job) {
        *self.learning.lock().await = Some(spawn_learning(self, learn));
        *self.refreshing.lock().await = Some(spawn_refreshing(self));
    }

    pub async fn switch_kiosk(&self, on: bool) -> Result<(), StoreError> {
        set_kiosk(&self.store, on).await?;
        self.kiosk.send_replace(on);
        Ok(())
    }

    pub fn watch_kiosk(&self) -> watch::Receiver<bool> {
        self.kiosk.subscribe()
    }

    /// Open `/ws` connections without a session: each holds a [`Core::watch_kiosk`].
    pub fn strangers(&self) -> usize {
        self.kiosk.receiver_count()
    }

    /// One of [`STRANGER_READS`], held for a history read without a session; `None` when none frees
    /// within `wait`. Waiters are served in turn, and one dropped while waiting leaves the queue.
    pub async fn stranger_permit(&self, wait: Duration) -> Option<OwnedSemaphorePermit> {
        let permit = Arc::clone(&self.stranger_reads).acquire_owned();
        tokio::time::timeout(wait, permit).await.ok()?.ok()
    }

    pub fn now_ms(&self) -> i64 {
        self.clock.now_ms()
    }

    /// The forecast from the irradiance the last refresh landed.
    pub async fn forecast(&self) -> Result<Option<Served>, StoreError> {
        self.solar.serve(&self.store, &self.clock, &self.bundle, &self.unstored).await
    }

    /// The conditions the last refresh landed.
    pub async fn weather(&self) -> Result<Option<Reading>, StoreError> {
        self.conditions.serve(&self.store, &self.clock).await
    }

    /// The compiled-in profile `id`, else the one a profile source supplied.
    pub async fn profile(&self, id: &str) -> Result<Option<Arc<Profile>>, StoreError> {
        let installed = installed(&self.store).await?;
        Ok(find_profile(&self.bundle, &installed, id))
    }

    /// Polls the in-service devices the store describes now; called after a roster or polling settings change.
    pub async fn apply(&self) -> Result<(), StoreError> {
        #[cfg(test)]
        if let Some(applied) = self.seams.apply() {
            return applied;
        }
        let sinks = (&self.live, &self.unstored, &self.exports);
        self.polling.restart(&self.store, &self.bundle, sinks, self.clock).await
    }

    /// Restarts the MQTT export from the stored settings and devices unless they are what it was `last` planned
    /// from, so a write it does not read never bounces its connections.
    async fn export(&self, last: &mut Option<ExportInputs>) -> Result<(), StoreError> {
        let config = MqttConfig::load(&self.store).await?;
        let installed = installed(&self.store).await?;
        let devices = self.store.devices().await?;
        let inputs = ExportInputs {
            config: config.clone(),
            devices: devices
                .iter()
                .filter(|device| device.in_service())
                .map(|device| {
                    let text =
                        installed.iter().find(|p| p.id == device.profile_id).map(|p| Arc::clone(&p.text));
                    (device.id, device.profile_id.clone(), text)
                })
                .collect(),
        };
        if last.as_ref() == Some(&inputs) {
            #[cfg(test)]
            self.seams.record("export kept");
            return Ok(());
        }
        let planned =
            mqtt::plan(&config, &devices, |id| find_profile(&self.bundle, &installed, id), &self.roots);
        self.exports.restart(planned).await;
        *last = Some(inputs);
        Ok(())
    }

    /// Stops what restarts the export and the forecast feed, then each export, which publishes `offline`.
    async fn stop_export(&self) {
        stop(self.exporting.lock().await.take()).await;
        self.exports.stop().await;
    }

    /// Runs `import` as a task [`Core::stop`] waits for, handing it what turns true once the core stops. Once
    /// stopped, `import` is dropped unrun.
    pub async fn spawn_import<F>(&self, import: impl FnOnce(watch::Receiver<bool>) -> F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        if let Some(running) = self.importing.lock().await.as_mut() {
            while running.tasks.try_join_next().is_some() {}
            running.tasks.spawn(import(running.stop.subscribe()));
        }
    }

    /// Waits for the imports, then stops the device tasks, each storing its open minute, and the retention
    /// pass, and closes the store.
    pub async fn stop(self: Arc<Self>) {
        // First: an import's last step restarts polling.
        stop(self.importing.lock().await.take()).await;
        self.polling.stop().await;
        self.stop_export().await;
        self.stop_background().await;
        self.close().await;
    }

    /// The retention pass, the learn runs and the refresh loops, none of which holds the core once stopped.
    async fn stop_background(&self) {
        stop(self.retention.lock().await.take()).await;
        stop(self.learning.lock().await.take()).await;
        stop(self.refreshing.lock().await.take()).await;
    }

    /// Closes the store once this is its last holder.
    async fn close(self: Arc<Self>) {
        if let Some(core) = Arc::into_inner(self)
            && let Some(store) = Arc::into_inner(core.store)
        {
            store.close().await;
            #[cfg(test)]
            core.seams.record("store closed");
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
    #[cfg(test)]
    seams: Arc<Seams>,
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
        sinks: Sinks<'_>,
        clock: Clock,
    ) -> Result<(), StoreError> {
        let mut running = self.running.lock().await;
        stop(running.take()).await;
        *running = Some(spawn_devices(store, bundle, sinks, clock).await?);
        Ok(())
    }

    /// Stops the tasks once each device's open minute is stored.
    pub async fn stop(&self) {
        stop(self.running.lock().await.take()).await;
        #[cfg(test)]
        self.seams.record("polling stopped");
    }
}

async fn stop(running: Option<Running>) {
    let Some(Running { stop, mut tasks }) = running else { return };
    stop.send_replace(true);
    while tasks.join_next().await.is_some() {}
}

/// Where each reading goes: the live feed, the open minute, the MQTT export.
type Sinks<'a> = (&'a Arc<Live>, &'a Arc<Unstored>, &'a Arc<Exports>);

async fn spawn_devices(
    store: &Arc<Store>,
    bundle: &Bundle,
    (live, unstored, exports): Sinks<'_>,
    clock: Clock,
) -> Result<Running, StoreError> {
    let interval = poll_interval(store.setting(INTERVAL_KEY).await?.as_deref());
    let timeout = poll_timeout(store.setting(TIMEOUT_KEY).await?.as_deref());
    let (stop, stopped) = watch::channel(false);
    let mut tasks = JoinSet::new();
    let installed = installed(store).await?;
    let devices = store.devices().await?;
    let members = plant::members(&devices, true);
    // The first member with a known profile decides how the plant folds; a meter's never does.
    let primary = members.iter().find_map(|device| find_profile(bundle, &installed, &device.profile_id));
    let aggregates = primary.map(|profile| Aggregates::of_profile(&profile)).unwrap_or_default();
    live.roster(&members.iter().map(|device| device.id).collect::<Vec<_>>(), aggregates);
    for device in devices.into_iter().filter(DeviceRow::in_service) {
        match find_profile(bundle, &installed, &device.profile_id) {
            Some(profile) => {
                let task = DeviceTask {
                    store: Arc::clone(store),
                    live: Arc::clone(live),
                    unstored: Arc::clone(unstored),
                    exports: Arc::clone(exports),
                    poller: DevicePoller::new(profile, device.unit_id),
                    device,
                    client: None,
                    timeout,
                    clock,
                };
                tasks.spawn(task.run(interval, stopped.clone()));
            }
            None => log_unknown_profile(&device),
        }
    }
    Ok(Running { stop, tasks })
}

fn spawn_retention(store: &Arc<Store>, clock: Clock) -> Running {
    let (stop, stopped) = watch::channel(false);
    let mut tasks = JoinSet::new();
    tasks.spawn(hourly(Arc::clone(store), clock, stopped));
    Running { stop, tasks }
}

/// Holds the core weakly, so the task never keeps it from stopping.
fn spawn_learning(core: &Arc<Core>, job: learn::Job) -> Running {
    let (stop, stopped) = watch::channel(false);
    let core = Arc::downgrade(core);
    let mut tasks = JoinSet::new();
    tasks.spawn(learn::schedule(move || core.upgrade().map(|core| async move { job(&core).await }), stopped));
    Running { stop, tasks }
}

/// One loop per cache, so a dead conditions fetch never delays the forecast. Holds the core weakly, so a loop
/// never keeps it from stopping.
fn spawn_refreshing(core: &Arc<Core>) -> Running {
    let (stop, stopped) = watch::channel(false);
    let mut tasks = JoinSet::new();
    let weak = Arc::downgrade(core);
    let conditions = move || {
        let core = weak.upgrade()?;
        Some(async move {
            let refreshed = core.conditions.refresh(&core.store, &core.clock, &core.roots).await;
            refreshed.unwrap_or_else(|error| {
                tracing::warn!(%error, "weather not refreshed");
                false
            })
        })
    };
    tasks.spawn(refresh::keep_fresh(conditions, core.bus.changed.subscribe(), stopped.clone()));
    let weak = Arc::downgrade(core);
    let solar = move || {
        let core = weak.upgrade()?;
        Some(async move {
            core.solar.refresh(&core.store, &core.clock, &core.roots).await.unwrap_or_else(|error| {
                tracing::warn!(%error, "forecast not refreshed");
                false
            })
        })
    };
    tasks.spawn(refresh::keep_fresh(solar, core.bus.changed.subscribe(), stopped));
    Running { stop, tasks }
}

/// What an export plan reads: the export settings and each in-service device's profile, with the installed
/// text it parses from.
#[derive(PartialEq)]
struct ExportInputs {
    config: MqttConfig,
    devices: Vec<ExportedDevice>,
}

/// A device's id, its profile id and that profile's installed text, if any.
type ExportedDevice = (i64, String, Option<Arc<str>>);

/// How often the plant forecast is published, as in 3.x.
const FORECAST_EXPORT_EVERY: Duration = Duration::from_mins(5);

/// Restarts the export now and once for each burst of store changes, and publishes the forecast while an export
/// runs. Holds the core weakly, so neither task keeps it from stopping.
fn spawn_export(core: &Arc<Core>) -> Running {
    let (stop, stopped) = watch::channel(false);
    let mut tasks = JoinSet::new();
    tasks.spawn(follow_changes(Arc::downgrade(core), core.bus.changed.subscribe(), stopped.clone()));
    tasks.spawn(publish_forecast(core, stopped));
    Running { stop, tasks }
}

/// A burst that outruns the ring still restarts the export once more: it re-reads the store.
async fn follow_changes(core: Weak<Core>, mut changes: Events<Changed>, mut stopped: watch::Receiver<bool>) {
    let mut last = None;
    while export_logged(&core, &mut last).await {
        tokio::select! {
            biased;
            _ = stopped.changed() => return,
            change = changes.newest() => if change.is_none() { return },
        }
    }
}

/// False once the core is gone.
async fn export_logged(core: &Weak<Core>, last: &mut Option<ExportInputs>) -> bool {
    let Some(core) = core.upgrade() else { return false };
    if let Err(error) = core.export(last).await {
        tracing::warn!(%error, "MQTT export not restarted");
    }
    true
}

fn publish_forecast(
    core: &Arc<Core>,
    mut stopped: watch::Receiver<bool>,
) -> impl Future<Output = ()> + use<> {
    let exports = Arc::clone(&core.exports);
    let core = Arc::downgrade(core);
    async move {
        let mut ticker = tokio::time::interval(FORECAST_EXPORT_EVERY);
        loop {
            tokio::select! {
                _ = stopped.changed() => return,
                _ = ticker.tick() => {}
                () = exports.restarted.notified() => {}
            }
            let Some(core) = core.upgrade() else { return };
            if !core.exports.active() {
                continue;
            }
            match core.forecast().await {
                Ok(Some(served)) => core.exports.forecast(served.forecast),
                Ok(None) => {}
                Err(error) => tracing::warn!(%error, "forecast not exported"),
            }
        }
    }
}

fn log_unknown_profile(device: &DeviceRow) {
    tracing::error!(device = device.id, profile = %device.profile_id, "unknown profile, device not polled");
}

/// One device's polling state: its connection and its plan; its open minute is in [`Unstored`].
struct DeviceTask {
    store: Arc<Store>,
    live: Arc<Live>,
    device: DeviceRow,
    poller: DevicePoller,
    unstored: Arc<Unstored>,
    exports: Arc<Exports>,
    client: Option<Client>,
    timeout: Duration,
    clock: Clock,
}

impl DeviceTask {
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
        if let Some(closed) = self.unstored.newest(self.device.id) {
            self.save(&closed).await;
        }
    }

    async fn tick(&mut self) {
        let at_ms = self.clock.now_ms();
        match self.poll_once().await {
            Ok(values) => self.record(Sample { at_ms, values }).await,
            Err(error) => self.lost(&error),
        }
    }

    async fn record(&mut self, sample: Sample) {
        self.live.publish(self.device.id, &sample);
        self.exports.sample(self.device.id, &sample);
        if let Some(closed) = self.unstored.push(self.device.id, sample) {
            self.save(&closed).await;
        }
    }

    /// Writes `closed`, then lets it go: a failed write loses the minute rather than holding it.
    async fn save(&self, closed: &ClosedMinute) {
        let device = self.device.id;
        if let Err(error) = self.store.append_minute(device, closed).await {
            tracing::error!(device, minute = closed.minute, %error, "minute not stored");
        }
        self.unstored.release(device, closed.minute);
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    use sunreye_sim::profile_case;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use jiff::Timestamp;

    use super::*;
    use crate::modbus::Transport;
    use crate::rollup::Tier;
    use crate::samples::{MINUTE_MS, Sample, minute_of};
    use crate::settings::INTERVAL_KEY;
    use crate::store::tests::published;
    use crate::store::{DeviceEdit, NewConnection, NewDevice};
    use crate::test_net::closed_port;
    use crate::web::Config;

    use crate::support::{Sim, core_at, hold_still};

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

    async fn wait_for_requests(sim: &Sim, at_least: usize) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while sim.requests().len() < at_least {
            assert!(Instant::now() < deadline, "the simulator was not polled");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Yields until `done`, failing after 20 s.
    async fn until(done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !done() {
            assert!(Instant::now() < deadline, "condition not reached");
            tokio::task::yield_now().await;
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
        let sim = Sim::start(case.registers, &[1]).await;
        let dir = dir("stop");
        let device = seed(&dir, sim.addr.port(), "deye-sg05lp3", "50").await;

        run(&dir, &Config::default(), listener().await, wait_for_requests(&sim, 40)).await.expect("run");

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

    fn oracle_case(profile: &str) -> sunreye_sim::ProfileCase {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        profile_case(&oracle, profile, "ramp").expect("case")
    }

    /// A second device on a connection of its own, in the store `seed` wrote.
    async fn seed_another(dir: &Path, port: u16, profile: &str) -> i64 {
        let store = Store::open(dir).await.expect("store");
        let endpoint =
            NewConnection { transport: Transport::Tcp, host: "127.0.0.1".into(), port, logger_serial: None };
        let connection = store.add_connection(&endpoint).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: profile.into(), unit_id: 1 };
        let id = store.add_device(&device).await.expect("device");
        store.close().await;
        id
    }

    /// Readings of `device` polled so far, stored or held.
    async fn polled(core: &Core, device: i64) -> usize {
        let stored = core.store.readings(device, 0, i64::MAX).await.expect("readings");
        let held = core.unstored.held(device);
        stored.len() + held.iter().filter(|s| !stored.iter().any(|t| t.at_ms == s.at_ms)).count()
    }

    /// Waits until `device` has `count` readings, failing after 20 s. Counted in the core, not at a
    /// simulator: a parallel test's core may still dial a port the simulator reused.
    async fn until_polled(core: &Core, device: i64, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while polled(core, device).await < count {
            assert!(Instant::now() < deadline, "device {device} not polled {count} times");
            tokio::task::yield_now().await;
        }
    }

    /// Raw readings of `device` in the store.
    async fn raw(core: &Core, device: i64) -> Vec<i64> {
        core.store.readings(device, 0, i64::MAX).await.expect("readings").iter().map(|s| s.at_ms).collect()
    }

    /// Waits until `device`'s raw readings are `want`, failing after 20 s.
    async fn until_raw(core: &Core, device: i64, want: &[i64]) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while raw(core, device).await != want {
            assert!(Instant::now() < deadline, "device {device} raw readings never {want:?}");
            tokio::task::yield_now().await;
        }
    }

    fn sorted(values: &[(String, f64)]) -> Vec<(String, f64)> {
        let mut values = values.to_vec();
        values.sort_by(|a, b| a.0.cmp(&b.0));
        values
    }

    /// Every stored reading, minute bucket and the open hour of `device` hold the case's decoded value.
    async fn assert_holds(store: &Store, device: i64, case: &sunreye_sim::ProfileCase) {
        let want: Vec<(String, f64)> = case.readings.clone().into_iter().collect();
        let samples = store.readings(device, 0, i64::MAX).await.expect("readings");
        assert!(!samples.is_empty(), "device {device} stored readings");
        assert!(samples.iter().all(|sample| sorted(&sample.values) == want), "device {device} readings");
        for (metric, value) in &want {
            assert_rolled_up(store, device, metric, *value).await;
        }
    }

    async fn assert_rolled_up(store: &Store, device: i64, metric: &str, value: f64) {
        let all = crate::store::BucketWindow { from: Timestamp::MIN, to: Timestamp::MAX, limit: 50_000 };
        let minutes = store.buckets(Tier::Minute, device, metric).await.expect("minutes");
        let hours = store.buckets_between(Tier::Hour, device, metric, all).await.expect("hours");
        assert!(!minutes.is_empty() && !hours.is_empty(), "device {device} {metric} rolled up");
        for bucket in minutes.iter().chain(&hours) {
            assert_eq!((bucket.max, bucket.min), (value, value), "{device} {metric}");
            // A time-weighted mean of one value is that value to the last few bits.
            assert!((bucket.avg - value).abs() <= 1e-12 * value.abs(), "{device} {metric}: {}", bucket.avg);
        }
    }

    #[tokio::test]
    async fn two_devices_on_two_connections_poll_store_and_roll_up_independently() {
        let (low, high) = (oracle_case("deye-sg05lp3"), oracle_case("deye-sg01hp3"));
        let low_sim = Sim::start(low.registers.clone(), &[1]).await;
        let high_sim = Sim::start(high.registers.clone(), &[1]).await;
        let dir = dir("two-devices");
        let first = seed(&dir, low_sim.addr.port(), "deye-sg05lp3", "50").await;
        let second = seed_another(&dir, high_sim.addr.port(), "deye-sg01hp3").await;
        let core = Core::open_at(&dir, Clock::wall()).await.expect("core");
        until_polled(&core, first, 2).await;
        until_polled(&core, second, 2).await;

        low_sim.stop();
        // A poll in flight when the simulator stopped may still land; the other's next polls outlast it.
        until_polled(&core, second, polled(&core, second).await + 3).await;
        let (first_at_stop, second_at_stop) = (polled(&core, first).await, polled(&core, second).await);
        until_polled(&core, second, second_at_stop + 5).await;
        assert_eq!(polled(&core, first).await, first_at_stop, "the stopped device gains nothing");
        assert!(polled(&core, second).await > second_at_stop, "the other keeps growing");
        core.stop().await;

        let store = Store::open(&dir).await.expect("store");
        assert_eq!(store.readings(first, 0, i64::MAX).await.expect("readings").len(), first_at_stop);
        assert_holds(&store, first, &low).await;
        assert_holds(&store, second, &high).await;
        store.close().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    fn members(core: &Core) -> Vec<String> {
        let frame =
            core.bus.plant.subscribe().borrow().as_ref().map(|frame| frame.0.to_string()).unwrap_or_default();
        let frame: serde_json::Value = serde_json::from_str(&frame).unwrap_or_default();
        let members = frame["data"]["members"].as_array().cloned().unwrap_or_default();
        members.iter().filter_map(|m| m.as_str().map(str::to_owned)).collect()
    }

    /// A device of `role` on a connection of its own, in the store at `dir`.
    async fn seed_role(dir: &Path, port: u16, profile: &str, role: &str) -> i64 {
        let store = Store::open(dir).await.expect("store");
        store.set_setting(INTERVAL_KEY, "50").await.expect("interval");
        let endpoint =
            NewConnection { transport: Transport::Tcp, host: "127.0.0.1".into(), port, logger_serial: None };
        let connection = store.add_connection(&endpoint).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: profile.into(), unit_id: 1 };
        let id = store.create_device(&device, None, role).await.expect("device");
        store.close().await;
        id
    }

    fn plant_data(core: &Core) -> serde_json::Value {
        let frame =
            core.bus.plant.subscribe().borrow().as_ref().map(|frame| frame.0.to_string()).unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&frame).unwrap_or_default()["data"].clone()
    }

    #[tokio::test]
    async fn the_live_plant_is_its_inverters_folded_by_the_first_members_profile_and_never_a_meter() {
        let case = oracle_case("deye-sg05lp3");
        let sim = Sim::start(case.registers.clone(), &[1]).await;
        let dir = dir("live-roster");
        // The meter comes first in the roster: its profile must not decide how the plant folds.
        let meter = seed_role(&dir, 1, "acme-meter", "meter").await;
        let known = seed_role(&dir, sim.addr.port(), "deye-sg05lp3", "inverter").await;
        let unknown = seed_role(&dir, 1, "no-such-profile", "inverter").await;
        let core = Core::open(&dir).await.expect("core");
        until_polled(&core, known, 1).await;
        let data = plant_data(&core);
        core.stop().await;

        assert_eq!(
            data["members"],
            serde_json::json!([known.to_string(), unknown.to_string()]),
            "meter {meter}"
        );
        assert_eq!(data["stale"], serde_json::json!([unknown.to_string()]), "an unpolled inverter is stale");
        let metrics = data["metrics"].as_object().expect("metrics");
        assert_eq!(
            metrics.get("dc.total_power").and_then(serde_json::Value::as_f64),
            Some(case.readings["dc.total_power"])
        );
        assert!(!metrics.contains_key("ac.l1.voltage"), "a per-device role has no plant value: {metrics:?}");
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_retired_device_is_not_polled_and_leaves_the_plant_and_a_restored_one_returns() {
        let case = oracle_case("deye-sg05lp3");
        let (kept_sim, retired_sim) =
            (Sim::start(case.registers.clone(), &[1]).await, Sim::start(case.registers.clone(), &[1]).await);
        let dir = dir("retired");
        let kept = seed(&dir, kept_sim.addr.port(), "deye-sg05lp3", "50").await;
        let retired = seed_another(&dir, retired_sim.addr.port(), "deye-sg05lp3").await;
        let core = Core::open_at(&dir, Clock::wall()).await.expect("core");
        until_polled(&core, retired, 2).await;

        let retire =
            DeviceEdit { retired_at: Some(Some("2026-11-03T10:00:00.000Z".into())), ..DeviceEdit::default() };
        core.store.edit_device(retired, &retire).await.expect("retire");
        core.apply().await.expect("apply");
        let asked = polled(&core, retired).await;
        until_polled(&core, kept, polled(&core, kept).await + 5).await;
        assert_eq!(polled(&core, retired).await, asked, "a retired device is not polled");
        assert_eq!(members(&core), [kept.to_string()]);
        assert!(
            !core.store.readings(retired, 0, i64::MAX).await.expect("readings").is_empty(),
            "history kept"
        );

        let restore = DeviceEdit { retired_at: Some(None), ..DeviceEdit::default() };
        core.store.edit_device(retired, &restore).await.expect("restore");
        core.apply().await.expect("apply");
        until_polled(&core, retired, asked + 2).await;
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn the_bus_carries_a_poll_a_settings_write_and_a_retire_and_stop_leaves_no_subscriber_behind() {
        let case = oracle_case("deye-sg05lp3");
        let sim = Sim::start(case.registers.clone(), &[1]).await;
        let dir = dir("bus");
        let device = seed(&dir, sim.addr.port(), "deye-sg05lp3", "50").await;
        let core = Core::open_at(&dir, Clock::wall()).await.expect("core");
        let (bus, seams) = (Arc::clone(&core.bus), Arc::clone(&core.seams));
        let (mut metrics, mut changes) = (bus.metrics.subscribe(), bus.changed.subscribe());

        let polled = tokio::time::timeout(Duration::from_secs(20), metrics.next()).await.expect("no poll");
        let frame: serde_json::Value = serde_json::from_str(&polled.expect("a frame").0).expect("json");
        assert_eq!(frame["data"]["inverterId"], device.to_string(), "{frame}");
        core.store.set_setting(INTERVAL_KEY, "60").await.expect("interval");
        let retire =
            DeviceEdit { retired_at: Some(Some("2026-11-03T10:00:00.000Z".into())), ..DeviceEdit::default() };
        core.store.edit_device(device, &retire).await.expect("retire");
        assert_eq!(published(&mut changes), [Changed::Settings, Changed::Devices]);

        core.stop().await;
        let subscribers = (bus.metrics.subscribers(), bus.changed.subscribers());
        assert_eq!(subscribers, (1, 1), "only this test's own: every core task ended");
        let closed = seams.events.lock().expect("events").iter().filter(|e| **e == "store closed").count();
        assert_eq!(closed, 1);
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_store_write_the_export_does_not_read_keeps_the_running_export() {
        let dir = dir("export-kept");
        let (_closed, broker) = closed_port();
        seed(&dir, 1, "deye-sg05lp3", "50").await;
        let store = Store::open(&dir).await.expect("store");
        let on = serde_json::json!({"enabled": true, "brokerUrl": format!("mqtt://127.0.0.1:{broker}")});
        store.set_setting(mqtt::config::KEY, &on.to_string()).await.expect("mqtt");
        store.close().await;
        let core = Core::open_at(&dir, Clock::wall()).await.expect("core");

        core.switch_kiosk(true).await.expect("kiosk");
        let seams = Arc::clone(&core.seams);
        until(|| seams.events.lock().expect("events").contains(&"export kept")).await;
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_restart_mid_minute_stores_the_held_minute_once_and_holds_only_what_follows() {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let case = profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
        let sim = Sim::start(case.registers, &[1]).await;
        let dir = dir("restart-held");
        let device = seed(&dir, sim.addr.port(), "deye-sg05lp3", "20").await;
        let core = Core::open_at(&dir, Clock::wall()).await.expect("core");
        wait_for_requests(&sim, 20).await;
        let held = core.unstored.held(device);
        assert!(!held.is_empty(), "the poll loop holds what it has not stored");

        core.apply().await.expect("restart");

        let stored_ms: Vec<i64> = core
            .store
            .readings(device, 0, i64::MAX)
            .await
            .expect("readings")
            .iter()
            .map(|s| s.at_ms)
            .collect();
        assert!(stored_ms.windows(2).all(|w| w[0] < w[1]), "no sample stored twice: {stored_ms:?}");
        assert!(
            held.iter().all(|s| stored_ms.contains(&s.at_ms)),
            "the held minute is stored at the restart"
        );
        let after = core.unstored.held(device);
        assert!(after.iter().all(|s| !stored_ms.contains(&s.at_ms)), "nothing stored stays held");
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_device_that_drops_every_connection_stores_nothing_and_does_not_stop_the_core() {
        let device_end = listener().await;
        let port = device_end.local_addr().expect("addr").port();
        let (dialled, dial) = oneshot::channel::<()>();
        tokio::spawn(async move {
            // The first poll dials in and is hung up on.
            drop(device_end.accept().await);
            dialled.send(()).ok();
        });
        let dir = dir("unreachable");
        let device = seed(&dir, port, "deye-sg05lp3", "20").await;
        run(&dir, &Config::default(), listener().await, wait(dial)).await.expect("run");
        assert_eq!(stored(&dir, device).await, []);
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_device_on_a_closed_port_fails_its_poll_with_the_refused_connect_and_holds_nothing() {
        let (_closed, port) = closed_port();
        let dir = dir("refused");
        let id = seed(&dir, port, "deye-sg05lp3", "20").await;
        let store = Arc::new(Store::open(&dir).await.expect("store"));
        let device =
            store.devices().await.expect("devices").into_iter().find(|d| d.id == id).expect("device");
        let profile =
            find_profile(&Bundle::official().expect("bundle"), &[], &device.profile_id).expect("profile");
        let mut task = DeviceTask {
            store: Arc::clone(&store),
            live: Arc::default(),
            unstored: Arc::default(),
            exports: Arc::default(),
            poller: DevicePoller::new(profile, device.unit_id),
            device,
            client: None,
            // Only a refusal ends the dial: a hang never reaches this timeout within the deadline below.
            timeout: Duration::from_hours(1),
            clock: Clock::wall(),
        };
        let polled = tokio::time::timeout(Duration::from_secs(20), task.poll_once()).await;
        match polled.expect("the dial hung") {
            Err(crate::modbus::Error::Io(error)) => assert!(error.contains("refused"), "{error}"),
            other => panic!("not a refused connect: {other:?}"),
        }
        tokio::time::timeout(Duration::from_secs(20), task.tick()).await.expect("the tick hung");
        assert!(task.client.is_none(), "no connection kept");
        assert_eq!(task.unstored.held(id), [], "no reading held");
        drop(task);
        Arc::into_inner(store).expect("one owner").close().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_minute_stays_held_while_its_write_waits_on_the_database() {
        let (_closed, port) = closed_port();
        let dir = dir("held-while-writing");
        let device = seed(&dir, port, "deye-sg05lp3", "20").await;
        let core = Core::open_at(&dir, Clock::wall()).await.expect("core");
        // Now, so the retention pass started by `open` keeps it.
        let at_ms = core.now_ms();
        core.unstored.push(device, Sample { at_ms, values: vec![("pv".into(), 1.0)] });
        // The pool's one connection, taken: the stopping task's write waits for it.
        let connection = core.store.hold().await;

        let before = core.unstored.lock_requests();
        let restarting = Arc::clone(&core);
        let restart = tokio::spawn(async move { restarting.apply().await });
        // The stopping task takes its minute, then first yields inside the write.
        until(|| core.unstored.lock_requests() > before).await;
        let held: Vec<i64> = core.unstored.held(device).iter().map(|s| s.at_ms).collect();
        assert_eq!(held, [at_ms], "a minute not yet written stays readable");

        drop(connection);
        restart.await.expect("join").expect("restart");
        let stored: Vec<i64> = core
            .store
            .readings(device, 0, i64::MAX)
            .await
            .expect("readings")
            .iter()
            .map(|s| s.at_ms)
            .collect();
        assert_eq!(stored, [at_ms]);
        assert_eq!(core.unstored.held(device), []);
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn the_core_drops_buckets_past_retention_and_keeps_the_rest() {
        let dir = dir("retention");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        let store = Store::open(&dir).await.expect("store");
        let now = Clock::wall().now_ms();
        for at_ms in [now - 91 * 24 * 60 * MINUTE_MS, now - 89 * 24 * 60 * MINUTE_MS] {
            let sample = Sample { at_ms, values: vec![("power".into(), 1.0)] };
            let minute = ClosedMinute { minute: minute_of(at_ms), samples: vec![sample] };
            store.append_minute(device, &minute).await.expect("append");
        }
        store.close().await;

        let core = Core::open(&dir).await.expect("open");
        let store = &core.store;
        let deadline = Instant::now() + Duration::from_secs(20);
        while store.buckets(Tier::Minute, device, "power").await.expect("buckets").len() > 1 {
            assert!(Instant::now() < deadline, "the first pass did not run");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let minutes = store.buckets(Tier::Minute, device, "power").await.expect("buckets");
        let kept = Timestamp::from_millisecond(minute_of(now - 89 * 24 * 60 * MINUTE_MS) * MINUTE_MS);
        assert_eq!(minutes.iter().map(|b| b.start).collect::<Vec<_>>(), [kept.expect("instant")]);
        assert_eq!(store.buckets(Tier::Hour, device, "power").await.expect("buckets").len(), 2);
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_device_with_an_unknown_profile_is_skipped() {
        let dir = dir("unknown");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        // Nothing is polled once the roster is read, so there is nothing left to wait for.
        Core::open(&dir).await.expect("open").stop().await;
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

    /// In the past of the real clock.
    const PAST: &str = "2026-03-01T00:02:30Z";
    const PAST_MS: i64 = 1_772_323_350_000;
    const DAY_MS: i64 = 24 * 60 * MINUTE_MS;

    async fn append_at(store: &Store, device: i64, at_ms: i64) {
        let sample = Sample { at_ms, values: vec![("power".into(), 1.0)] };
        let minute = ClosedMinute { minute: minute_of(at_ms), samples: vec![sample] };
        store.append_minute(device, &minute).await.expect("append");
    }

    #[tokio::test(start_paused = true)]
    async fn the_first_retention_pass_reads_the_core_clock_not_real_time() {
        hold_still();
        let dir = dir("retention-clock");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        let store = Store::open(&dir).await.expect("store");
        append_at(&store, device, PAST_MS - 8 * DAY_MS).await;
        append_at(&store, device, PAST_MS - 6 * DAY_MS).await;
        store.close().await;

        let core = core_at(&dir, PAST, "UTC").await;
        until_raw(&core, device, &[PAST_MS - 6 * DAY_MS]).await;
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test(start_paused = true)]
    async fn a_settings_change_runs_no_retention_pass_and_the_next_is_an_hour_after_start() {
        hold_still();
        let dir = dir("apply-retention");
        let device = seed(&dir, 1, "no-such-profile", "20").await;
        let stale_ms = PAST_MS - 8 * DAY_MS;
        let store = Store::open(&dir).await.expect("store");
        append_at(&store, device, stale_ms).await;
        store.close().await;
        let core = core_at(&dir, PAST, "UTC").await;
        until_raw(&core, device, &[]).await;
        append_at(&core.store, device, stale_ms).await;

        core.apply().await.expect("apply");
        tokio::time::advance(Duration::from_hours(1) - Duration::from_millis(1)).await;
        // Queued behind any pass the restart started: the store's one connection serves in turn.
        for _ in 0..20 {
            assert_eq!(raw(&core, device).await, [stale_ms], "a restart starts no pass");
        }
        tokio::time::advance(Duration::from_millis(1)).await;
        until_raw(&core, device, &[]).await;
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test(start_paused = true)]
    async fn the_core_stamps_its_polls_with_its_clock_not_the_wall_clock() {
        hold_still();
        let sim = Sim::start(oracle_case("deye-sg05lp3").registers, &[1]).await;
        let dir = dir("core-poll-clock");
        let device = seed(&dir, sim.addr.port(), "deye-sg05lp3", "3600000").await;

        let core = core_at(&dir, PAST, "UTC").await;
        until_polled(&core, device, 1).await;

        let at_ms = core.unstored.held(device)[0].at_ms;
        assert!((PAST_MS..PAST_MS + DAY_MS).contains(&at_ms), "stamped {at_ms}");
        core.stop().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_device_task_stamps_each_poll_with_the_paused_core_clock() {
        let sim = Sim::start(oracle_case("deye-sg05lp3").registers, &[1]).await;
        let dir = dir("task-poll-clock");
        let id = seed(&dir, sim.addr.port(), "deye-sg05lp3", "1000").await;
        let store = Arc::new(Store::open(&dir).await.expect("store"));
        let device =
            store.devices().await.expect("devices").into_iter().find(|d| d.id == id).expect("device");
        let profile =
            find_profile(&Bundle::official().expect("bundle"), &[], &device.profile_id).expect("profile");
        // After the store opened: a paused clock times its pool out.
        tokio::time::pause();
        let mut task = DeviceTask {
            store: Arc::clone(&store),
            live: Arc::default(),
            unstored: Arc::default(),
            exports: Arc::default(),
            poller: DevicePoller::new(profile, device.unit_id),
            device,
            client: None,
            timeout: Duration::from_secs(3),
            clock: Clock::at(PAST_MS),
        };

        task.tick().await;
        tokio::time::advance(Duration::from_millis(1500)).await;
        task.tick().await;

        let stamps: Vec<i64> = task.unstored.held(id).iter().map(|s| s.at_ms).collect();
        assert_eq!(stamps, [PAST_MS, PAST_MS + 1500]);
        tokio::time::resume();
        drop(task);
        Arc::into_inner(store).expect("one owner").close().await;
        drop(std::fs::remove_dir_all(&dir));
    }
}
