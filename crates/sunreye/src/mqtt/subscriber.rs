//! A connection that subscribes and hands on what the broker sends: dial, SUBSCRIBE, read, redial with the
//! export's backoff and subscribe again. It sends no PUBLISH: a subscriber cannot reach a register (ADR 0005).

use tokio::io::{AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::sync::watch;
use tokio::time::Instant;

use super::link::{
    CLOSE_TIMEOUT, CONNECT_TIMEOUT, KEEP_ALIVE, Link, SILENCE, Stream, WRITE_TIMEOUT, backoff, handshake,
    log_lost, log_unreachable, timed_out,
};
use super::wire;
pub use super::wire::Inbound;

/// What the subscriber hears, in order: each connection opens with `Connected` and, unless stopped, ends with
/// `Lost`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Heard {
    Connected,
    Message(Inbound),
    Lost,
}

/// The only packet id: one SUBSCRIBE per connection.
const PACKET_ID: u16 = 1;

/// Runs until `stop` turns true or its sender is gone, subscribing to `filters` on every connection.
pub async fn run(
    link: Link,
    filters: Vec<String>,
    mut heard: impl FnMut(Heard),
    mut stop: watch::Receiver<bool>,
) {
    let mut failures = 0;
    loop {
        let Some(stable) = session(&link, &filters, &mut heard, &mut stop).await else { return };
        heard(Heard::Lost);
        if stable {
            failures = 0;
        }
        let delay = backoff(failures, (link.jitter)());
        failures = failures.saturating_add(1);
        tokio::select! {
            () = (link.pause)(delay) => {}
            () = stopped(&mut stop) => return,
        }
    }
}

async fn stopped(stop: &mut watch::Receiver<bool>) {
    drop(stop.wait_for(|stopped| *stopped).await);
}

type Read = (ReadHalf<Box<dyn Stream>>, std::io::Result<(u8, Vec<u8>)>);

/// One packet, or the error that ends the connection; owns the half so a cancelled select loses no bytes.
async fn read(mut input: ReadHalf<Box<dyn Stream>>) -> Read {
    let packet = tokio::time::timeout(SILENCE, wire::read(&mut input)).await;
    (input, packet.unwrap_or_else(|_| Err(timed_out("no PINGRESP from the broker"))))
}

async fn write(out: &mut WriteHalf<Box<dyn Stream>>, bytes: &[u8]) -> std::io::Result<()> {
    let writing = async {
        out.write_all(bytes).await?;
        out.flush().await
    };
    tokio::time::timeout(WRITE_TIMEOUT, writing)
        .await
        .unwrap_or_else(|_| Err(timed_out("the broker stopped reading")))
}

/// `None` once stopped; else whether the connection lasted a keep-alive.
async fn session(
    link: &Link,
    filters: &[String],
    heard: &mut impl FnMut(Heard),
    stop: &mut watch::Receiver<bool>,
) -> Option<bool> {
    let stream = match dial(link, stop).await? {
        Ok(stream) => stream,
        Err(error) => {
            log_unreachable(&link.dial.broker, &error);
            return Some(false);
        }
    };
    let started = Instant::now();
    let error = subscribed(stream, filters, heard, stop).await?;
    log_lost(&error);
    Some(started.elapsed() >= KEEP_ALIVE)
}

/// The stream once the broker accepted it; `None` when stopped while dialling.
async fn dial(link: &Link, stop: &mut watch::Receiver<bool>) -> Option<Result<Box<dyn Stream>, String>> {
    tokio::select! {
        opened = tokio::time::timeout(CONNECT_TIMEOUT, handshake(link, None)) => {
            Some(opened.unwrap_or_else(|_| Err("no answer in time".into())))
        }
        () = stopped(stop) => None,
    }
}

/// Subscribes, then reads; `None` once stopped, else what ended the connection.
async fn subscribed(
    stream: Box<dyn Stream>,
    filters: &[String],
    heard: &mut impl FnMut(Heard),
    stop: &mut watch::Receiver<bool>,
) -> Option<std::io::Error> {
    let (input, mut out) = tokio::io::split(stream);
    if let Err(error) = write(&mut out, &wire::subscribe(PACKET_ID, filters)).await {
        return Some(error);
    }
    heard(Heard::Connected);
    listen(input, &mut out, heard, stop).await
}

/// Reads until the connection fails; `None` once stopped, after DISCONNECT.
async fn listen(
    input: ReadHalf<Box<dyn Stream>>,
    out: &mut WriteHalf<Box<dyn Stream>>,
    heard: &mut impl FnMut(Heard),
    stop: &mut watch::Receiver<bool>,
) -> Option<std::io::Error> {
    let mut reading = Box::pin(read(input));
    let mut ping = tokio::time::interval(KEEP_ALIVE / 2);
    ping.tick().await;
    loop {
        tokio::select! {
            biased;
            () = stopped(stop) => {
                drop(tokio::time::timeout(CLOSE_TIMEOUT, out.write_all(&wire::DISCONNECT)).await);
                return None;
            }
            (input, packet) = &mut reading => {
                let (first, body) = match packet {
                    Ok(packet) => packet,
                    Err(error) => return Some(error),
                };
                hear(first, &body, heard);
                reading = Box::pin(read(input));
            }
            _ = ping.tick() => if let Err(error) = write(out, &wire::PINGREQ).await {
                return Some(error);
            },
        }
    }
}

fn hear(first: u8, body: &[u8], heard: &mut impl FnMut(Heard)) {
    if first >> 4 == 3 {
        if let Some(inbound) = wire::inbound(first, body) {
            heard(Heard::Message(inbound));
        }
    } else if first == wire::SUBACK && wire::suback_refused(body) {
        log_refused();
    }
}

fn log_refused() {
    tracing::error!("MQTT broker refused a subscription: check its ACL");
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::sync::{mpsc, watch};

    use super::*;
    use crate::mqtt::config::Broker;
    use crate::mqtt::fixture::FakeBroker;
    use crate::mqtt::link::{Dial, Link, jitter};

    fn link(broker: &FakeBroker) -> Link {
        let dial = Dial {
            broker: Broker { tls: false, host: "broker".into(), port: 1883 },
            client_id: "sunreye-evcc".into(),
            username: None,
            password: None,
            roots: Vec::new(),
        };
        Link { dial, open: broker.open(), pause: Arc::new(|_| Box::pin(std::future::ready(()))), jitter }
    }

    fn filters() -> Vec<String> {
        vec!["evcc/status".into(), "evcc/loadpoints/#".into()]
    }

    /// Runs a subscriber against `broker`, handing on what it hears.
    fn spawn(
        broker: &FakeBroker,
    ) -> (mpsc::UnboundedReceiver<Heard>, watch::Sender<bool>, tokio::task::JoinHandle<()>) {
        let (heard, hearing) = mpsc::unbounded_channel();
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(run(link(broker), filters(), move |event| drop(heard.send(event)), stopped));
        (hearing, stop, task)
    }

    async fn next(hearing: &mut mpsc::UnboundedReceiver<Heard>) -> Heard {
        let next = tokio::time::timeout(Duration::from_secs(20), hearing.recv()).await;
        next.expect("in time").expect("heard")
    }

    fn message(topic: &str, payload: &str) -> Heard {
        Heard::Message(Inbound { topic: topic.into(), payload: payload.as_bytes().to_vec() })
    }

    #[tokio::test]
    async fn it_subscribes_after_the_connack_hands_on_what_matches_and_disconnects_on_stop() {
        let mut broker =
            FakeBroker::new(&[("evcc/status", "online"), ("other/x", "1"), ("evcc/loadpoints/1/mode", "pv")]);
        let (mut hearing, stop, task) = spawn(&broker);

        assert_eq!(next(&mut hearing).await, Heard::Connected);
        assert_eq!(next(&mut hearing).await, message("evcc/status", "online"));
        assert_eq!(next(&mut hearing).await, message("evcc/loadpoints/1/mode", "pv"));
        broker.send("evcc/loadpoints/1/chargePower", "4140");
        assert_eq!(next(&mut hearing).await, message("evcc/loadpoints/1/chargePower", "4140"));
        stop.send_replace(true);
        broker.until(14).await;
        task.await.expect("ended");

        let kinds: Vec<u8> = broker.log.iter().map(|seen| seen.kind).collect();
        assert_eq!(kinds, [1, 8, 14], "CONNECT, SUBSCRIBE, DISCONNECT and never a PUBLISH");
        assert_eq!(broker.log[1].filters(), filters());
        assert_eq!(broker.log[0].body[7] & 0b0000_0110, 0b10, "a clean session with no will");
    }

    #[tokio::test]
    async fn a_dropped_connection_is_heard_then_redialled_and_subscribed_again() {
        let mut broker = FakeBroker::new(&[("evcc/status", "online")]);
        let (mut hearing, stop, task) = spawn(&broker);
        assert_eq!(next(&mut hearing).await, Heard::Connected);
        assert_eq!(next(&mut hearing).await, message("evcc/status", "online"));
        broker.until(8).await;

        broker.kick();
        assert_eq!(next(&mut hearing).await, Heard::Lost);
        assert_eq!(next(&mut hearing).await, Heard::Connected);
        assert_eq!(next(&mut hearing).await, message("evcc/status", "online"), "the retained state again");
        let again = broker.until(8).await;
        assert_eq!((again.connection, again.filters()), (1, filters()));
        stop.send_replace(true);
        task.await.expect("ended");
        assert!(broker.log.iter().all(|seen| seen.kind != 3), "{:?}", broker.log);
    }

    #[tokio::test(start_paused = true)]
    async fn a_session_that_lasted_a_keep_alive_restarts_the_backoff() {
        let broker = FakeBroker::new(&[]);
        let paused = Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = Arc::clone(&paused);
        let link = Link {
            pause: Arc::new(move |delay| {
                recorded.lock().expect("delays").push(delay);
                Box::pin(std::future::ready(()))
            }),
            jitter: || 0.0,
            ..link(&broker)
        };
        let (heard, mut hearing) = mpsc::unbounded_channel();
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(run(link, filters(), move |event| drop(heard.send(event)), stopped));

        assert_eq!(next(&mut hearing).await, Heard::Connected);
        broker.kick();
        assert_eq!(next(&mut hearing).await, Heard::Lost);
        assert_eq!(next(&mut hearing).await, Heard::Connected);
        tokio::time::sleep(Duration::from_secs(61)).await;
        broker.kick();
        assert_eq!(next(&mut hearing).await, Heard::Lost);
        assert_eq!(next(&mut hearing).await, Heard::Connected);
        broker.kick();
        assert_eq!(next(&mut hearing).await, Heard::Lost);
        assert_eq!(next(&mut hearing).await, Heard::Connected);
        stop.send_replace(true);
        task.await.expect("ended");

        let ms = |ms| Duration::from_millis(ms);
        assert_eq!(*paused.lock().expect("delays"), [ms(500), ms(500), ms(1000)], "short, stable, short");
    }
}
