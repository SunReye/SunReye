//! A read that finds the database busy is a 503 the client retries, never a 500.

use std::io::Write;
use std::sync::Mutex;

use super::*;
use crate::store::{NewConnection, NewDevice, StoreError, refused};

const NOW: i64 = 1_772_323_350_000;
/// Long enough that no statement of the test's own outlasts it, short enough to end a held pool fast.
const PATIENCE: Duration = Duration::from_millis(200);

fn fixed_clock() -> i64 {
    NOW
}

/// What a stranger reads with the kiosk view on.
const READS: [&str; 4] =
    ["/api/capabilities", "/api/profile", "/api/history/recent", "/api/history/rollup?metric=pv_power"];

/// What only a session reads, beside [`READS`].
const SESSION_READS: [&str; 3] = ["/api/sources", "/api/forecast", "/api/forecast/usable"];

#[tokio::test]
async fn a_history_read_that_waits_out_the_pool_is_a_503_with_retry_after() {
    let core = Core::open_waiting(&dir("busy-pool"), fixed_clock, PATIENCE).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await.status, StatusCode::OK);
    let stranger = admin.anonymous();
    let held = core.store.hold().await;
    for path in READS {
        let busy = get(&stranger, path).await;
        assert_eq!(busy.status, StatusCode::SERVICE_UNAVAILABLE, "{path}");
        assert_eq!(busy.retry_after.as_deref(), Some("1"), "{path}");
        assert_eq!(busy.json(), json!({"error": "The database is busy: try again"}), "{path}");
    }
    drop(held);
    for path in READS {
        let answered = get(&stranger, path).await;
        assert!(!answered.status.is_server_error(), "released: {path}: {}", answered.status);
    }
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_signed_in_read_that_waits_out_the_pool_is_a_503_with_retry_after() {
    let core = Core::open_waiting(&dir("busy-session"), fixed_clock, PATIENCE).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    let held = core.store.hold().await;
    for path in READS.into_iter().chain(SESSION_READS) {
        let busy = get(&admin, path).await;
        assert_eq!(busy.status, StatusCode::SERVICE_UNAVAILABLE, "{path}: {:?}", busy.body);
        assert_eq!(busy.retry_after.as_deref(), Some("1"), "{path}");
    }
    drop(held);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_failure_that_is_not_busy_stays_a_500_that_names_nothing() {
    let core = Core::open_waiting(&dir("busy-genuine"), fixed_clock, PATIENCE).await.expect("core");
    let connection = NewConnection {
        transport: crate::modbus::Transport::Tcp,
        host: "10.0.0.5".into(),
        port: 502,
        logger_serial: None,
    };
    let connection = core.store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: PROFILE.into(), unit_id: 1 };
    core.store.add_device(&device).await.expect("device");
    let (core, admin) = signed_in(core, &Config::default()).await;
    let mut held = core.store.hold().await;
    sqlx::query("DROP TABLE reading_minute").execute(&mut *held).await.expect("drop");
    drop(held);
    let failed = get(&admin, "/api/history/recent").await;
    assert_eq!(
        (failed.status, failed.retry_after.clone(), failed.json()),
        (StatusCode::INTERNAL_SERVER_ERROR, None, json!({"error": "internal error"}))
    );
    drop(admin);
    core.stop().await;
}

/// Collects what `tracing` writes while a closure runs.
#[derive(Clone, Default)]
struct Log(Arc<Mutex<Vec<u8>>>);

impl Write for Log {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("log").extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// What a store failure answers, and the log lines it wrote.
async fn answered(error: StoreError) -> (Answer, Vec<String>) {
    let log = Log::default();
    let writer = log.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .with_max_level(tracing::Level::TRACE)
        .finish();
    let response = tracing::subscriber::with_default(subscriber, || ApiError::from(error).into_response());
    let text = String::from_utf8(log.0.lock().expect("log").clone()).expect("utf8");
    (answer(response).await, text.lines().map(str::to_owned).collect())
}

#[tokio::test]
async fn busy_locked_and_timed_out_stores_answer_503_and_warn_once_with_the_cause() {
    let cases = [
        (refused("5"), "(code: 5)"),
        (refused("517"), "(code: 517)"),
        (refused("6"), "(code: 6)"),
        (refused("262"), "(code: 262)"),
        (StoreError::Sqlx(sqlx::Error::PoolTimedOut), "pool timed out"),
        (StoreError::Sessions(sqlx::Error::PoolTimedOut.to_string()), "pool timed out"),
    ];
    for (error, cause) in cases {
        let (response, log) = answered(error).await;
        assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE, "{cause}");
        assert_eq!(response.retry_after.as_deref(), Some("1"), "{cause}");
        assert_eq!(response.json(), json!({"error": "The database is busy: try again"}), "{cause}");
        assert_eq!(log.len(), 1, "{cause}: {log:?}");
        assert!(log[0].contains("WARN") && log[0].contains(cause), "{cause}: {log:?}");
    }
}

#[tokio::test]
async fn a_store_failure_that_is_not_busy_answers_500_and_logs_one_error() {
    let genuine = [
        refused("1"),
        refused("11"),
        StoreError::Sqlx(sqlx::Error::RowNotFound),
        StoreError::Corrupt("minute"),
    ];
    for error in genuine {
        let label = error.to_string();
        let (response, log) = answered(error).await;
        assert_eq!(
            (response.status, response.retry_after.clone(), response.json()),
            (StatusCode::INTERNAL_SERVER_ERROR, None, json!({"error": "internal error"})),
            "{label}"
        );
        assert_eq!(log.len(), 1, "{label}: {log:?}");
        assert!(log[0].contains("ERROR"), "{label}: {log:?}");
    }
}
