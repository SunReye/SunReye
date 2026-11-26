//! RTU over TCP replayed through `sim`. v4's `rtu-over-tcp` corpus lines carry MBAP bytes (its
//! client stripped the CRC), so these captures take the RTU frames, CRC included, that v4's
//! `solarman-v5` cases carry inside their V5 envelopes. Expected words come from those cases'
//! recorded `device` registers.

use sunreye_profile::Framing;

use super::{Capture, Client, Endpoint, Error, Exchange, TIMEOUT, device, read, unhex};

/// Each step is a request, or a reply as its chunks.
fn rtu(steps: &[&[&str]]) -> Capture {
    let exchanges = steps
        .iter()
        .map(|step| match step {
            [request] if request.starts_with('>') => Exchange::Request(unhex(&request[1..])),
            chunks => Exchange::Reply(chunks.iter().map(|c| unhex(c)).collect()),
        })
        .collect();
    Capture {
        framing: Framing::RtuOverTcp,
        exchanges,
    }
}

async fn sim(steps: &[&[&str]]) -> Client {
    Client::connect(&Endpoint::Sim(rtu(steps)), TIMEOUT)
        .await
        .unwrap()
}

const READ_UNIT_1: &str = ">010301f40005c5c7";
const REPLY_UNIT_1: &str = "01030a0901fc181234000100954d00";

#[tokio::test]
async fn a_read_is_the_unit_pdu_and_crc_and_its_reply_is_unwrapped_the_same_way() {
    let cases = [
        ("solarman-v5/read-unit-1", 1, READ_UNIT_1, REPLY_UNIT_1),
        (
            "solarman-v5/read-unit-0",
            0,
            ">000301f40005c416",
            "00030a0901fc181234000100954f81",
        ),
    ];
    for (name, unit, request, reply) in cases {
        let mut client = sim(&[&[request], &[reply]]).await;
        assert_eq!(
            read(&mut client, unit, 500, 5).await,
            Ok(device(name, 500, 5)),
            "{name}"
        );
    }
}

#[tokio::test]
async fn a_reply_split_across_reads_is_reassembled() {
    let mut client = sim(&[&[READ_UNIT_1], &["01", "030a0901fc", "181234000100954d00"]]).await;
    assert_eq!(
        read(&mut client, 1, 500, 5).await,
        Ok(device("solarman-v5/read-unit-1", 500, 5))
    );
}

#[tokio::test]
async fn an_exception_leaves_the_connection_usable_for_the_split_reads() {
    let name = "solarman-v5/exception-2-split";
    let mut client = sim(&[
        &[">010301f40015c40b"],
        &["018302c0f1"],
        &[READ_UNIT_1],
        &[REPLY_UNIT_1],
        &[">0103020800010470"],
        &["0103020007f986"],
    ])
    .await;
    assert_eq!(
        read(&mut client, 1, 500, 21).await,
        Err(Error::Exception(2))
    );
    assert_eq!(read(&mut client, 1, 500, 5).await, Ok(device(name, 500, 5)));
    assert_eq!(read(&mut client, 1, 520, 1).await, Ok(device(name, 520, 1)));
}

#[tokio::test(start_paused = true)]
async fn a_silent_unit_times_out_and_the_next_unit_is_probed_on_the_same_connection() {
    let mut client = sim(&[
        &[">000301f40001c5d5"],
        &[">010301f40001c404"],
        &["01030209017fd4"],
    ])
    .await;
    assert_eq!(read(&mut client, 0, 500, 1).await, Err(Error::Timeout));
    assert_eq!(
        read(&mut client, 1, 500, 1).await,
        Ok(device("solarman-v5/probe-unit", 500, 1))
    );
}

#[tokio::test]
async fn a_write_is_function_16_and_the_echo_confirms_it() {
    let name = "solarman-v5/write-register";
    let mut client = sim(&[&[">011001f800010200956347"], &["011001f8000181c4"]]).await;
    assert_eq!(
        client.write_registers(1, 504, &device(name, 504, 1)).await,
        Ok(())
    );
}

#[tokio::test]
async fn a_reply_with_a_bad_crc_or_from_another_unit_is_a_protocol_error() {
    let cases = [
        ("01030a0901fc181234000100954d01", "bad CRC"),
        ("00030a0901fc181234000100954f81", "unit id mismatch"),
    ];
    for (reply, why) in cases {
        let mut client = sim(&[&[READ_UNIT_1], &[reply]]).await;
        assert_eq!(
            read(&mut client, 1, 500, 5).await,
            Err(Error::Protocol(why)),
            "{why}"
        );
    }
}
