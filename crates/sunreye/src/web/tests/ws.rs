use std::future::Future;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::{WebSocketStream, client_async};

use super::*;
use crate::samples::Sample;

type Socket = WebSocketStream<TcpStream>;

/// The router on a real socket: an upgrade needs a connection to take over.
async fn serve(core: &Arc<Core>, config: &Config) -> std::net::SocketAddr {
    serve_until(core, config, std::future::pending()).await.0
}

/// [`serve`] until `shutdown` resolves; the handle ends once the server lets go of the core.
async fn serve_until(
    core: &Arc<Core>,
    config: &Config,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let app = router(Arc::clone(core), config).into_make_service_with_connect_info::<std::net::SocketAddr>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).with_graceful_shutdown(shutdown).await.expect("serve");
    });
    (addr, server)
}

async fn upgrade(addr: std::net::SocketAddr, api: &Api, origin: &str) -> Result<Socket, StatusCode> {
    let mut request = format!("ws://{HOST}/ws").into_client_request().expect("request");
    request.headers_mut().insert(header::ORIGIN, origin.parse().expect("origin"));
    if let Some(cookie) = &api.cookie {
        request.headers_mut().insert(header::COOKIE, cookie.parse().expect("cookie"));
    }
    let stream = TcpStream::connect(addr).await.expect("connect");
    match client_async(request, stream).await {
        Ok((socket, _)) => Ok(socket),
        Err(tungstenite::Error::Http(response)) => Err(response.status()),
        Err(error) => panic!("upgrade failed: {error}"),
    }
}

async fn connect(addr: std::net::SocketAddr, api: &Api) -> Socket {
    upgrade(addr, api, SAME_ORIGIN).await.expect("upgraded")
}

async fn send_text(socket: &mut Socket, text: &str) {
    socket.send(Message::text(text)).await.expect("send");
}

/// The next text frame, parsed; fails after two seconds of silence.
async fn next_json(socket: &mut Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("a frame within 2 s")
            .expect("open")
            .expect("frame");
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).expect("json");
        }
    }
}

/// Nothing arrives for 200 ms.
async fn silent(socket: &mut Socket) {
    let next = tokio::time::timeout(Duration::from_millis(200), socket.next()).await;
    assert!(next.is_err(), "unexpected frame: {next:?}");
}

async fn subscribe(socket: &mut Socket, topics: &str) -> Value {
    send_text(socket, &format!(r#"{{"t":"sub","topics":{topics}}}"#)).await;
    next_json(socket).await
}

fn reading(at_ms: i64, power: f64) -> Sample {
    Sample { at_ms, values: vec![("pv_power".into(), power)] }
}

async fn plain_user(core: &Core, admin: &Api) -> Api {
    let account = NewAccount {
        email: "viewer@example.org".into(),
        name: "Viewer".into(),
        password_hash: password::Passwords::new().hash(ADMIN_PASSWORD.into()).await.expect("hash"),
    };
    core.store.add_account(&account, false).await.expect("plain account");
    let signed_in = login(&admin.anonymous(), "viewer@example.org", ADMIN_PASSWORD, false).await;
    admin.with_cookie(&signed_in.session_cookie())
}

/// Waits until the core holds `count` live connections.
async fn connections(core: &Core, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while core.bus.metrics.subscribers() != count {
        assert!(Instant::now() < deadline, "{} connections, want {count}", core.bus.metrics.subscribers());
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn an_anonymous_upgrade_is_refused_and_any_session_is_accepted() {
    let (core, admin) = open(&dir("ws-gate")).await;
    let addr = serve(&core, &Config::default()).await;
    assert_eq!(upgrade(addr, &admin.anonymous(), SAME_ORIGIN).await.err(), Some(StatusCode::UNAUTHORIZED));
    assert_eq!(
        upgrade(addr, &admin.with_cookie("id=forged"), SAME_ORIGIN).await.err(),
        Some(StatusCode::UNAUTHORIZED)
    );
    let user = plain_user(&core, &admin).await;
    for api in [&admin, &user] {
        let mut socket = connect(addr, api).await;
        let ack = subscribe(&mut socket, r#"["metrics"]"#).await;
        assert_eq!(ack, json!({"topic": "__ack", "data": {"subscribed": ["metrics"], "denied": []}}));
    }
    drop((user, admin));
    core.stop().await;
}

#[tokio::test]
async fn with_the_kiosk_view_on_a_stranger_is_upgraded_and_fed_and_with_it_off_refused() {
    let (core, admin) = open(&dir("ws-kiosk")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    let stranger = admin.anonymous();
    assert_eq!(upgrade(addr, &stranger, SAME_ORIGIN).await.err(), Some(StatusCode::UNAUTHORIZED));

    put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await;
    let mut socket = connect(addr, &stranger).await;
    subscribe(&mut socket, r#"["metrics"]"#).await;
    core.live.publish(7, &reading(1_786_788_000_123, 42.0));
    assert_eq!(next_json(&mut socket).await["data"]["metrics"]["pv_power"], 42.0);
    assert_eq!(
        upgrade(addr, &stranger, "https://evil.example").await.err(),
        Some(StatusCode::FORBIDDEN),
        "the origin check holds for a stranger too"
    );

    put(&admin, "/api/settings/kiosk", &json!({"enabled": false})).await;
    assert_eq!(upgrade(addr, &stranger, SAME_ORIGIN).await.err(), Some(StatusCode::UNAUTHORIZED));
    drop((stranger, admin));
    core.stop().await;
}

/// The server closes `socket` within two seconds.
async fn closed(socket: &mut Socket) {
    let until = Instant::now() + Duration::from_secs(2);
    loop {
        let next = tokio::time::timeout_at(until.into(), socket.next()).await.expect("closed within 2 s");
        match next {
            Some(Ok(Message::Close(_)) | Err(_)) | None => return,
            Some(Ok(_)) => {}
        }
    }
}

#[tokio::test]
async fn switching_the_kiosk_view_off_closes_a_strangers_open_socket_and_keeps_a_session_open() {
    let (core, admin) = open(&dir("ws-kiosk-off")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await;
    let mut stranger = connect(addr, &admin.anonymous()).await;
    let mut session = connect(addr, &admin).await;
    for socket in [&mut stranger, &mut session] {
        subscribe(socket, r#"["metrics"]"#).await;
    }
    put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await;
    core.live.publish(7, &reading(1_786_788_000_000, 41.0));
    for socket in [&mut stranger, &mut session] {
        assert_eq!(next_json(socket).await["data"]["metrics"]["pv_power"], 41.0, "on again keeps it open");
    }

    put(&admin, "/api/settings/kiosk", &json!({"enabled": false})).await;
    closed(&mut stranger).await;
    connections(&core, 1).await;
    core.live.publish(7, &reading(1_786_788_000_123, 42.0));
    assert_eq!(next_json(&mut session).await["data"]["metrics"]["pv_power"], 42.0);
    drop(admin);
    core.stop().await;
}

/// Pings every 100 ms and closes a connection silent for 300 ms.
fn quick() -> Config {
    let live = LiveLimits {
        ping: Duration::from_millis(100),
        idle: Duration::from_millis(300),
        ..LiveLimits::default()
    };
    Config { live, ..Config::default() }
}

#[test]
fn a_connection_is_pinged_every_30_s_closed_after_120_s_silent_and_64_are_served_48_to_strangers() {
    let want = LiveLimits {
        ping: Duration::from_secs(30),
        idle: Duration::from_secs(120),
        connections: 64,
        strangers: 48,
    };
    assert_eq!(Config::default().live, want);
}

/// Subscribes to nothing; the pings that arrive before the ack, which also keeps the client heard.
async fn pings_before_ack(socket: &mut Socket) -> usize {
    send_text(socket, r#"{"t":"sub","topics":[]}"#).await;
    let mut pings = 0;
    loop {
        match socket.next().await.expect("open").expect("frame") {
            Message::Ping(_) => pings += 1,
            Message::Text(_) => return pings,
            other => panic!("unexpected {other:?}"),
        }
    }
}

#[tokio::test]
async fn the_server_pings_and_a_client_that_answers_stays_open() {
    let (core, admin) = open(&dir("ws-ping")).await;
    let addr = serve(&core, &quick()).await;
    let mut socket = connect(addr, &admin).await;
    // One second of virtual time in 10 ms steps: a 100 ms interval pings 10 times, give or take the
    // one tick at each edge that races the subscribe whose ack flushes the pings sent before it.
    tokio::time::pause();
    pings_before_ack(&mut socket).await;
    let mut pings = 0;
    for step in 1..=100 {
        tokio::time::advance(Duration::from_millis(10)).await;
        if step % 5 == 0 {
            pings += pings_before_ack(&mut socket).await;
        }
    }
    tokio::time::resume();
    assert!((8..=12).contains(&pings), "{pings} pings in 1 s at a 100 ms interval");
    let ack = subscribe(&mut socket, r#"["metrics"]"#).await;
    assert_eq!(ack["data"]["subscribed"], json!(["metrics"]), "open past three idle timeouts");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_client_that_stops_answering_is_closed_after_the_idle_timeout() {
    let (core, admin) = open(&dir("ws-idle")).await;
    let addr = serve(&core, &quick()).await;
    let socket = connect(addr, &admin).await;
    connections(&core, 1).await;
    // The connection is up and nothing else touches the store: the server's timers run on virtual time.
    tokio::time::pause();
    tokio::time::advance(Duration::from_millis(150)).await;
    assert_eq!(core.bus.metrics.subscribers(), 1, "open inside the timeout");
    tokio::time::advance(Duration::from_millis(200)).await;
    tokio::time::resume();
    connections(&core, 0).await;
    drop((socket, admin));
    core.stop().await;
}

/// A session socket whose receive buffer is a few KiB, so a large frame stalls the server's send.
async fn connect_narrow(addr: std::net::SocketAddr, api: &Api) -> Socket {
    let mut request = format!("ws://{HOST}/ws").into_client_request().expect("request");
    request.headers_mut().insert(header::ORIGIN, SAME_ORIGIN.parse().expect("origin"));
    let cookie = api.cookie.as_deref().expect("session");
    request.headers_mut().insert(header::COOKIE, cookie.parse().expect("cookie"));
    let tcp = tokio::net::TcpSocket::new_v4().expect("socket");
    tcp.set_recv_buffer_size(4 * 1024).expect("receive buffer");
    let stream = tcp.connect(addr).await.expect("connect");
    client_async(request, stream).await.expect("upgraded").0
}

#[tokio::test]
async fn a_client_that_stops_reading_mid_send_is_closed_after_the_idle_timeout() {
    let (core, admin) = open(&dir("ws-stalled")).await;
    let live = LiveLimits { idle: Duration::from_secs(1), ..LiveLimits::default() };
    let addr = serve(&core, &Config { live, ..Config::default() }).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    let mut socket = connect_narrow(addr, &admin).await;
    subscribe(&mut socket, r#"["metrics"]"#).await;
    // About 6 MB, past any send buffer (4 MiB at most on Linux): the send blocks with the select loop
    // unpolled, so only a bounded send reaches the deadline. Long keys, few of them: the plant fold
    // looks each key up linearly, so 250 000 short keys took minutes in a debug build.
    let wide: Vec<(String, f64)> =
        (0..4_000).map(|i| (format!("metric_{i:04}_{}", "x".repeat(1_500)), f64::from(i))).collect();
    core.live.publish(7, &Sample { at_ms: 0, values: wide });
    connections(&core, 0).await;
    drop((socket, admin));
    core.stop().await;
}

#[tokio::test]
async fn an_upgrade_past_the_connection_cap_is_refused_until_one_closes() {
    let (core, admin) = open(&dir("ws-cap")).await;
    let config = Config { live: LiveLimits { connections: 2, ..LiveLimits::default() }, ..Config::default() };
    let addr = serve(&core, &config).await;
    let first = connect(addr, &admin).await;
    let _second = connect(addr, &admin).await;
    assert_eq!(upgrade(addr, &admin, SAME_ORIGIN).await.err(), Some(StatusCode::SERVICE_UNAVAILABLE));
    connections(&core, 2).await;
    drop(first);
    connections(&core, 1).await;
    let mut third = connect(addr, &admin).await;
    assert_eq!(subscribe(&mut third, r#"["metrics"]"#).await["topic"], "__ack");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_upgrade_that_finds_the_database_busy_is_a_503_not_a_hang() {
    let (core, admin) = open(&dir("ws-busy")).await;
    let addr = serve(&core, &Config::default()).await;
    let held = core.store.hold().await;
    tokio::time::pause();
    assert_eq!(upgrade(addr, &admin, SAME_ORIGIN).await.err(), Some(StatusCode::SERVICE_UNAVAILABLE));
    tokio::time::resume();
    drop(held);
    drop(connect(addr, &admin).await);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn strangers_past_their_cap_are_refused_and_the_rest_stays_for_sessions() {
    let (core, admin) = open(&dir("ws-strangers")).await;
    let live = LiveLimits { connections: 3, strangers: 1, ..LiveLimits::default() };
    let addr = serve(&core, &Config { live, ..Config::default() }).await;
    put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await;
    let stranger = admin.anonymous();
    let first = connect(addr, &stranger).await;
    assert_eq!(upgrade(addr, &stranger, SAME_ORIGIN).await.err(), Some(StatusCode::SERVICE_UNAVAILABLE));
    let sessions = [connect(addr, &admin).await, connect(addr, &admin).await];
    connections(&core, 3).await;
    drop((first, sessions));
    connections(&core, 0).await;
    drop(connect(addr, &stranger).await);
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test]
async fn an_upgrade_from_an_untrusted_origin_is_refused() {
    let (core, admin) = open(&dir("ws-origin")).await;
    let addr = serve(&core, &Config::default()).await;
    assert_eq!(upgrade(addr, &admin, "https://evil.example").await.err(), Some(StatusCode::FORBIDDEN));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_reading_reaches_each_subscribed_topic_and_nothing_else() {
    let (core, admin) = open(&dir("ws-fan-out")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    let mut metrics_only = connect(addr, &admin).await;
    subscribe(&mut metrics_only, r#"["metrics"]"#).await;
    let mut both = connect(addr, &admin).await;
    subscribe(&mut both, r#"["metrics","plant"]"#).await;
    let mut none = connect(addr, &admin).await;
    subscribe(&mut none, r#"["logs"]"#).await;

    core.live.publish(7, &reading(1_786_788_000_123, 1234.5));

    let metrics = json!({"topic": "metrics", "data": {
        "time": "2026-08-15T10:00:00.123Z", "inverterId": "7", "metrics": {"pv_power": 1234.5}}});
    let plant = json!({"topic": "plant", "data": {
        "time": "2026-08-15T10:00:00.123Z", "metrics": {"pv_power": 1234.5}, "members": ["7"], "stale": []}});
    assert_eq!(next_json(&mut metrics_only).await, metrics);
    silent(&mut metrics_only).await;
    assert_eq!(next_json(&mut both).await, metrics);
    assert_eq!(next_json(&mut both).await, plant);
    silent(&mut none).await;

    send_text(&mut both, r#"{"t":"unsub","topics":["metrics"]}"#).await;
    send_text(&mut both, "not a frame").await;
    subscribe(&mut both, "[]").await;
    core.live.publish(7, &reading(1_786_788_001_123, 1.0));
    assert_eq!(next_json(&mut both).await["topic"], "plant", "unsub stopped metrics, junk closed nothing");
    silent(&mut both).await;
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_client_frame_publishes_nothing_and_anything_but_sub_or_unsub_is_ignored() {
    let (core, admin) = open(&dir("ws-no-publish")).await;
    let addr = serve(&core, &Config::default()).await;
    let mut listener = connect(addr, &admin).await;
    subscribe(&mut listener, r#"["metrics","plant"]"#).await;
    let mut client = connect(addr, &admin).await;
    subscribe(&mut client, r#"["metrics","plant"]"#).await;
    let metrics = r#"{"time":"2026-08-15T10:00:00.123Z","inverterId":"7","metrics":{"pv_power":1.0}}"#;
    let plant =
        r#"{"time":"2026-08-15T10:00:00.123Z","metrics":{"pv_power":1.0},"members":["7"],"stale":[]}"#;
    for text in [
        format!(r#"{{"topic":"metrics","data":{metrics}}}"#),
        format!(r#"{{"topic":"plant","data":{plant}}}"#),
        format!(r#"{{"t":"pub","topic":"plant","data":{plant}}}"#),
        format!(r#"{{"t":"publish","topics":["metrics"],"data":{metrics}}}"#),
    ] {
        send_text(&mut client, &text).await;
    }
    client.send(Message::binary(metrics.as_bytes().to_vec())).await.expect("send");

    silent(&mut listener).await;
    let ack = subscribe(&mut client, "[]").await;
    assert_eq!(ack["topic"], "__ack", "the sender is still served and was sent nothing else: {ack}");
    assert!(core.bus.plant.subscribe().borrow().is_none(), "the plant topic holds nothing");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_new_subscriber_gets_the_last_plant_fold_and_no_metrics_snapshot() {
    let (core, admin) = open(&dir("ws-snapshot")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    core.live.publish(7, &reading(1_786_788_000_123, 5.0));
    let mut socket = connect(addr, &admin).await;
    subscribe(&mut socket, r#"["metrics","plant"]"#).await;
    let snapshot = next_json(&mut socket).await;
    assert_eq!(snapshot["topic"], "plant");
    assert_eq!(snapshot["data"]["metrics"], json!({"pv_power": 5.0}));
    silent(&mut socket).await;
    subscribe(&mut socket, r#"["plant"]"#).await;
    silent(&mut socket).await;
    drop(admin);
    core.stop().await;
}

/// A `sub` frame for `metrics`, padded to `len` bytes.
fn sub_frame_of(len: usize) -> String {
    let head = r#"{"t":"sub","topics":["metrics"],"pad":""#;
    let tail = r#""}"#;
    format!("{head}{}{tail}", "x".repeat(len - head.len() - tail.len()))
}

#[tokio::test]
async fn a_client_frame_over_16_kib_closes_the_socket_and_one_at_16_kib_is_answered() {
    let (core, admin) = open(&dir("ws-inbound-cap")).await;
    let addr = serve(&core, &Config::default()).await;
    let mut socket = connect(addr, &admin).await;
    send_text(&mut socket, &sub_frame_of(16 * 1024)).await;
    assert_eq!(next_json(&mut socket).await["data"]["subscribed"], json!(["metrics"]));

    send_text(&mut socket, &sub_frame_of(16 * 1024 + 1)).await;
    let after = tokio::time::timeout(Duration::from_secs(2), socket.next()).await.expect("closed within 2 s");
    assert!(
        matches!(after, None | Some(Err(_) | Ok(Message::Close(_)))),
        "an oversized frame was answered: {after:?}"
    );
    drop(admin);
    core.stop().await;
}

/// `text` as two frames, a text frame then its final continuation.
async fn send_split(socket: &mut Socket, text: &str) {
    use tungstenite::protocol::frame::Frame;
    use tungstenite::protocol::frame::coding::{Data, OpCode};
    let (first, rest) = text.as_bytes().split_at(text.len() / 2);
    socket
        .feed(Message::Frame(Frame::message(first.to_vec(), OpCode::Data(Data::Text), false)))
        .await
        .expect("send");
    socket
        .send(Message::Frame(Frame::message(rest.to_vec(), OpCode::Data(Data::Continue), true)))
        .await
        .expect("send");
}

#[tokio::test]
async fn a_client_message_over_16_kib_split_across_frames_closes_the_socket() {
    let (core, admin) = open(&dir("ws-inbound-split-cap")).await;
    let addr = serve(&core, &Config::default()).await;
    let mut socket = connect(addr, &admin).await;
    send_split(&mut socket, &sub_frame_of(16 * 1024)).await;
    assert_eq!(next_json(&mut socket).await["data"]["subscribed"], json!(["metrics"]));

    send_split(&mut socket, &sub_frame_of(16 * 1024 + 1)).await;
    let after = tokio::time::timeout(Duration::from_secs(2), socket.next()).await.expect("closed within 2 s");
    assert!(
        matches!(after, None | Some(Err(_) | Ok(Message::Close(_)))),
        "an oversized message was answered: {after:?}"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn many_subscribers_each_get_every_frame() {
    let (core, admin) = open(&dir("ws-many")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    let mut sockets = Vec::new();
    for _ in 0..40 {
        let mut socket = connect(addr, &admin).await;
        subscribe(&mut socket, r#"["metrics"]"#).await;
        sockets.push(socket);
    }
    for power in [1.0, 2.0] {
        core.live.publish(7, &reading(1_786_788_000_000, power));
    }
    for socket in &mut sockets {
        assert_eq!(next_json(socket).await["data"]["metrics"]["pv_power"], 1.0);
        assert_eq!(next_json(socket).await["data"]["metrics"]["pv_power"], 2.0);
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_subscriber_that_stops_reading_skips_ahead_and_holds_up_no_one() {
    let (core, admin) = open(&dir("ws-slow")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    let mut slow = connect(addr, &admin).await;
    subscribe(&mut slow, r#"["metrics"]"#).await;
    let mut quick = connect(addr, &admin).await;
    subscribe(&mut quick, r#"["metrics"]"#).await;
    let wide: Vec<(String, f64)> = (0..2000).map(|i| (format!("metric_{i:04}"), f64::from(i))).collect();
    let published = 400;
    for at_ms in 0..published {
        core.live.publish(7, &Sample { at_ms, values: wide.clone() });
        assert_eq!(next_json(&mut quick).await["data"]["time"], json!(iso_ms(at_ms)));
    }
    let mut received = 0;
    loop {
        let frame = next_json(&mut slow).await;
        received += 1;
        if frame["data"]["time"] == json!(iso_ms(published - 1)) {
            break;
        }
    }
    assert!(received < published, "the lagging connection skipped frames, got {received}");
    drop(admin);
    core.stop().await;
}

fn iso_ms(at_ms: i64) -> String {
    format!("1970-01-01T00:00:00.{at_ms:03}Z")
}

#[tokio::test]
async fn a_subscriber_gone_mid_send_is_released_and_a_reconnect_is_served() {
    let (core, admin) = open(&dir("ws-gone")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    let mut first = connect(addr, &admin).await;
    subscribe(&mut first, r#"["metrics"]"#).await;
    connections(&core, 1).await;
    drop(first);
    for at_ms in 0..50 {
        core.live.publish(7, &reading(at_ms, 1.0));
    }
    connections(&core, 0).await;

    let mut again = connect(addr, &admin).await;
    subscribe(&mut again, r#"["metrics"]"#).await;
    core.live.publish(7, &reading(60, 2.0));
    assert_eq!(next_json(&mut again).await["data"]["metrics"]["pv_power"], 2.0);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn publishing_without_subscribers_keeps_no_frame() {
    let (core, admin) = open(&dir("ws-nobody")).await;
    let addr = serve(&core, &Config::default()).await;
    core.live.roster(&[7], crate::plant::Aggregates::default());
    for at_ms in 0..100 {
        core.live.publish(7, &reading(at_ms, 1.0));
    }
    let mut socket = connect(addr, &admin).await;
    subscribe(&mut socket, r#"["metrics"]"#).await;
    silent(&mut socket).await;
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn stopping_the_core_closes_its_live_connections() {
    let (core, admin) = open(&dir("ws-stop")).await;
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let (addr, server) = serve_until(&core, &Config::default(), async { drop(stopped.await) }).await;
    let mut socket = connect(addr, &admin).await;
    subscribe(&mut socket, r#"["metrics"]"#).await;
    drop(admin);
    stop.send(()).ok();
    server.await.expect("server");
    core.stop().await;
    let closed = tokio::time::timeout(Duration::from_secs(2), socket.next()).await;
    assert!(
        matches!(closed, Ok(Some(Ok(Message::Close(_))) | None)),
        "the connection outlived the core: {closed:?}"
    );
}

#[tokio::test]
async fn a_polled_device_is_published_with_the_oracle_values() {
    let (sim, case) = simulator().await;
    let (core, admin) = open(&dir("ws-oracle")).await;
    let addr = serve(&core, &Config::default()).await;
    let mut socket = connect(addr, &admin).await;
    subscribe(&mut socket, r#"["metrics","plant"]"#).await;
    put(&admin, "/api/settings/inverter", &connection(sim.addr.port())).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;

    let want: serde_json::Map<String, Value> =
        case.readings.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
    let metrics = next_json(&mut socket).await;
    let plant = next_json(&mut socket).await;
    let device = core.store.devices().await.expect("devices")[0].id.to_string();
    assert_eq!(metrics["topic"], "metrics");
    assert_eq!(metrics["data"]["inverterId"], device.as_str());
    assert_eq!(metrics["data"]["metrics"], Value::Object(want.clone()));
    assert_eq!(plant["topic"], "plant");
    assert_eq!(plant["data"]["metrics"], Value::Object(want));
    assert_eq!(plant["data"]["members"], json!([device]));
    assert_eq!(plant["data"]["stale"], json!([]));
    assert_eq!(plant["data"]["time"], metrics["data"]["time"]);
    drop(admin);
    core.stop().await;
}
