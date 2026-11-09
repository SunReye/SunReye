//! v4's transport corpus (`fixtures/transport.ndjson`, the `tcp` and `solarman-v5` lines of v4's
//! `fixtures/oracle/transport.ndjson`) replayed through `sim`. Expected words come from each case's
//! recorded `device` registers, not from the reply bytes.

mod rtu;
mod solarman;

use std::time::Duration;

use serde_json::Value;
use sunreye_profile::Framing;

use super::{Capture, Client, Endpoint, Error, Exchange};

const TIMEOUT: Duration = Duration::from_millis(250);

fn case(name: &str) -> Value {
    include_str!("../../fixtures/transport.ndjson")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|row| row["case"] == name)
        .unwrap()
}

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

fn capture(name: &str) -> Capture {
    let row = case(name);
    let framing = match row["framing"].as_str().unwrap() {
        "tcp" => Framing::Tcp,
        "solarman-v5" => Framing::SolarmanV5,
        other => panic!("framing {other}"),
    };
    let exchanges = row["exchanges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| match step["dir"].as_str().unwrap() {
            "tx" => Exchange::Request(unhex(step["hex"].as_str().unwrap())),
            _ => Exchange::Reply(
                step["chunks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| unhex(c.as_str().unwrap()))
                    .collect(),
            ),
        })
        .collect();
    Capture { framing, exchanges }
}

/// The recorded device's registers from `start`.
fn device(name: &str, start: u16, count: u16) -> Vec<u16> {
    let registers = &case(name)["device"];
    (start..start + count)
        .map(|addr| u16::try_from(registers[addr.to_string()].as_u64().unwrap()).unwrap())
        .collect()
}

fn unit(name: &str) -> u8 {
    u8::try_from(case(name)["unitId"].as_u64().unwrap()).unwrap()
}

async fn sim(name: &str) -> Client {
    Client::connect(&Endpoint::Sim(capture(name)), TIMEOUT)
        .await
        .unwrap()
}

async fn read(client: &mut Client, unit: u8, start: u16, count: u16) -> Result<Vec<u16>, Error> {
    let mut words = vec![0; usize::from(count)];
    client
        .read_holding(unit, start, &mut words)
        .await
        .map(|()| words)
}

#[tokio::test]
async fn a_read_sends_the_recorded_request_and_decodes_the_recorded_reply() {
    for name in ["tcp/read-unit-1", "tcp/read-unit-0", "tcp/fragmented-reply"] {
        let mut client = sim(name).await;
        assert_eq!(
            read(&mut client, unit(name), 500, 5).await,
            Ok(device(name, 500, 5)),
            "{name}"
        );
    }
}

#[tokio::test]
async fn bytes_before_a_reply_are_a_protocol_error_not_a_misread() {
    let mut client = sim("tcp/leading-junk").await;
    assert_eq!(
        read(&mut client, 1, 500, 5).await,
        Err(Error::Protocol("transaction id mismatch"))
    );
}

#[tokio::test]
async fn an_exception_leaves_the_connection_usable_for_the_split_reads() {
    let name = "tcp/exception-2-split";
    let mut client = sim(name).await;
    assert_eq!(
        read(&mut client, 1, 500, 21).await,
        Err(Error::Exception(2))
    );
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
    assert_eq!(read(&mut client, 1, 520, 1).await, Ok(device(name, 520, 1)));
}

#[tokio::test(start_paused = true)]
async fn a_silent_unit_times_out_and_the_next_unit_is_probed_on_the_same_connection() {
    let name = "tcp/probe-unit";
    let mut client = sim(name).await;
    assert_eq!(read(&mut client, 0, 500, 1).await, Err(Error::Timeout));
    assert_eq!(read(&mut client, 1, 500, 1).await, Ok(device(name, 500, 1)));
}

#[tokio::test]
async fn sim_refuses_a_request_that_differs_from_the_capture_by_one_byte() {
    let mut client = sim("tcp/read-unit-1").await;
    assert!(matches!(
        read(&mut client, 1, 501, 5).await,
        Err(Error::Io(_))
    ));
}

#[tokio::test]
async fn sim_refuses_a_request_past_the_end_of_the_capture() {
    let mut client = sim("tcp/read-unit-1").await;
    read(&mut client, 1, 500, 5).await.unwrap();
    assert!(matches!(
        read(&mut client, 1, 500, 5).await,
        Err(Error::Io(_))
    ));
}

#[tokio::test]
async fn sim_replays_each_reply_chunk_as_its_own_read() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let capture = capture("tcp/fragmented-reply");
    let [Exchange::Request(request), Exchange::Reply(chunks)] = capture.exchanges.as_slice() else {
        panic!()
    };
    let mut wire = super::sim::Sim::new(capture.clone());
    wire.write_all(request).await.unwrap();
    for chunk in chunks {
        let mut got = [0; 64];
        let read = wire.read(&mut got).await.unwrap();
        assert_eq!(&got[..read], chunk.as_slice());
    }
}

#[tokio::test]
async fn a_write_is_function_16_even_for_one_word_and_the_echo_confirms_it() {
    let name = "tcp/write-register";
    let mut client = sim(name).await;
    assert_eq!(
        client.write_registers(1, 504, &device(name, 504, 1)).await,
        Ok(())
    );
}

#[tokio::test]
async fn modbus_tcp_reads_over_a_socket_as_over_sim() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let name = "tcp/read-unit-1";
    let [Exchange::Request(request), Exchange::Reply(reply)]: [Exchange; 2] =
        capture(name).exchanges.try_into().ok().unwrap()
    else {
        panic!()
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut got = vec![0; request.len()];
        stream.read_exact(&mut got).await.unwrap();
        assert_eq!(got, request);
        stream.write_all(&reply.concat()).await.unwrap();
    });
    let endpoint = Endpoint::ModbusTcp {
        host: "127.0.0.1".into(),
        port,
    };
    let mut client = Client::connect(&endpoint, TIMEOUT).await.unwrap();
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
    server.await.unwrap();
}

#[tokio::test]
async fn a_count_outside_the_pdu_limit_is_refused_before_anything_is_sent() {
    let mut client = sim("tcp/read-unit-1").await;
    for count in [0, 126] {
        assert_eq!(
            read(&mut client, 1, 500, count).await,
            Err(Error::Protocol("count out of range"))
        );
    }
    for count in [0, 124] {
        let words = vec![0; count];
        assert_eq!(
            client.write_registers(1, 500, &words).await,
            Err(Error::Protocol("count out of range"))
        );
    }
    assert_eq!(
        read(&mut client, 1, 500, 5).await,
        Ok(device("tcp/read-unit-1", 500, 5)),
        "the capture is untouched"
    );
}

/// The setup scan's guard (ADR 6) sits on the wire, as a capture's does: a write through a
/// read-only client never leaves, and reads still pass.
#[tokio::test]
async fn a_read_only_client_refuses_a_write_before_it_reaches_the_device() {
    use super::fake;
    for mut fake in [
        fake::serve().await,
        fake::serve_rtu().await,
        fake::serve_solarman().await,
    ] {
        let mut client = Client::read_only(&fake.endpoint(), TIMEOUT).await.unwrap();

        let refused = client.write_registers(1, 500, &[1]).await;

        assert!(matches!(refused, Err(Error::Io(_))), "{refused:?}");
        assert!(
            fake.writes.try_recv().is_err(),
            "the write reached the device"
        );
        let mut client = Client::read_only(&fake.endpoint(), TIMEOUT).await.unwrap();
        assert_eq!(read(&mut client, 1, 500, 2).await, Ok(vec![500, 501]));
    }
}
