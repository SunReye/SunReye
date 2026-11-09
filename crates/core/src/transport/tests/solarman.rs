//! v4's Solarman V5 cases. Each capture opens with the discovery probe: logger serial 0, which the
//! stick refuses with status `06` in a header that names its real serial.

use super::{Endpoint, Error, Exchange, TIMEOUT, capture, device, read, sim, unit};

#[tokio::test]
async fn a_read_is_wrapped_for_the_logger_the_probe_names_and_its_reply_unwrapped() {
    for name in [
        "solarman-v5/read-unit-1",
        "solarman-v5/read-unit-0",
        "solarman-v5/fragmented-reply",
        "solarman-v5/logger-serial-discovery",
    ] {
        let mut client = sim(name).await;
        assert_eq!(
            read(&mut client, unit(name), 500, 5).await,
            Ok(device(name, 500, 5)),
            "{name}"
        );
    }
}

#[tokio::test]
async fn a_heartbeat_a_stale_sequence_and_a_bad_checksum_are_skipped_for_the_real_reply() {
    let name = "solarman-v5/heartbeat-and-stray-frames";
    let mut client = sim(name).await;
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
}

#[tokio::test]
async fn a_transient_05_is_asked_once_more_with_a_fresh_sequence() {
    let name = "solarman-v5/transient-05-retried";
    let mut client = sim(name).await;
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
}

/// The capture ends after the second `05`: a third attempt would be a request it does not have.
#[tokio::test]
async fn a_05_twice_is_exception_2_without_a_third_attempt() {
    let mut client = sim("solarman-v5/persistent-05-is-exception-2").await;
    assert_eq!(read(&mut client, 1, 500, 5).await, Err(Error::Exception(2)));
}

#[tokio::test]
async fn a_wrong_serial_06_is_exception_10_not_an_address_verdict() {
    let mut client = sim("solarman-v5/wrong-serial-06").await;
    assert_eq!(
        read(&mut client, 1, 500, 5).await,
        Err(Error::Exception(10))
    );
}

#[tokio::test]
async fn an_inverter_exception_reaches_the_caller_and_the_split_reads_follow() {
    let name = "solarman-v5/exception-2-split";
    let mut client = sim(name).await;
    assert_eq!(
        read(&mut client, 1, 500, 21).await,
        Err(Error::Exception(2))
    );
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
    assert_eq!(read(&mut client, 1, 520, 1).await, Ok(device(name, 520, 1)));
}

#[tokio::test(start_paused = true)]
async fn a_silent_unit_times_out_and_the_next_unit_is_asked_with_the_next_sequence() {
    let name = "solarman-v5/probe-unit";
    let mut client = sim(name).await;
    assert_eq!(read(&mut client, 0, 500, 1).await, Err(Error::Timeout));
    assert_eq!(read(&mut client, 1, 500, 1).await, Ok(device(name, 500, 1)));
}

#[tokio::test]
async fn bytes_before_a_frame_are_a_protocol_error_not_a_misread() {
    let mut client = sim("solarman-v5/leading-junk").await;
    assert_eq!(
        read(&mut client, 1, 500, 5).await,
        Err(Error::Protocol("not a Solarman V5 frame"))
    );
}

#[tokio::test]
async fn a_write_is_function_16_inside_the_envelope() {
    let name = "solarman-v5/write-register";
    let mut client = sim(name).await;
    assert_eq!(
        client.write_registers(1, 504, &device(name, 504, 1)).await,
        Ok(())
    );
}

/// Plays the device's side of `exchanges` on `stream`.
async fn replay(mut stream: tokio::net::TcpStream, exchanges: Vec<Exchange>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for exchange in exchanges {
        match exchange {
            Exchange::Request(request) => {
                let mut got = vec![0; request.len()];
                stream.read_exact(&mut got).await.unwrap();
                assert_eq!(got, request);
            }
            Exchange::Reply(reply) => stream.write_all(&reply.concat()).await.unwrap(),
        }
    }
}

#[tokio::test]
async fn solarman_v5_reads_over_a_socket_as_over_sim() {
    let name = "solarman-v5/read-unit-1";
    let exchanges = capture(name).exchanges;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        replay(stream, exchanges).await;
    });
    let endpoint = Endpoint::SolarmanV5 {
        host: "127.0.0.1".into(),
        port,
    };
    let mut client = super::Client::connect(&endpoint, TIMEOUT).await.unwrap();
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
    server.await.unwrap();
}
