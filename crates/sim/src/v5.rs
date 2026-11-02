//! The Solarman V5 envelope as a logging stick speaks it, seen from the stick: what a client sends is
//! `A5`, length, control `0x4510`, sequence, logger serial, a 15-byte business field and an RTU frame;
//! what comes back is the same with control `0x1510` and a 14-byte business field.

use tokio::io::{AsyncRead, AsyncReadExt};

use crate::server::crc16;

const START: u8 = 0xa5;
const END: u8 = 0x15;
/// Start, length, control, sequence, serial.
const HEADER: usize = 11;
/// Checksum and end byte.
const TRAILER: usize = 2;
const REQUEST_BUSINESS: usize = 15;
const RESPONSE_BUSINESS: usize = 14;
const CONTROL_RESPONSE: u16 = 0x1510;
/// The stick's own frame counter, in the high byte of every sequence it sends.
const STICK_COUNTER: u16 = 0x0d00;
/// Unit id, function, one byte of body, CRC.
const MIN_RTU: usize = 5;
/// The V5 status of a request naming a serial the stick does not have.
const STATUS_WRONG_SERIAL: u8 = 6;

/// A request frame that passed its checksum.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Incoming {
    pub seq: u16,
    /// Whether the frame names this stick; if not it is answered with a reject, not forwarded.
    pub addressed: bool,
    /// The RTU frame inside: unit id, PDU, CRC; empty for a frame that is not addressed.
    pub rtu: Vec<u8>,
}

/// The next request frame whose checksum, end byte and inner CRC hold; anything else is dropped
/// unanswered and the scan goes on from the next start byte.
pub(crate) async fn read_request<R: AsyncRead + Unpin>(stream: &mut R, stick: u32) -> Option<Incoming> {
    loop {
        let mut byte = [0_u8; 1];
        while byte[0] != START {
            stream.read_exact(&mut byte).await.ok()?;
        }
        let mut length = [0_u8; 2];
        stream.read_exact(&mut length).await.ok()?;
        let mut frame = vec![START, length[0], length[1]];
        frame.resize(HEADER + usize::from(u16::from_le_bytes(length)) + TRAILER, 0);
        stream.read_exact(&mut frame[3..]).await.ok()?;
        if let Some(incoming) = parse(&frame, stick) {
            return Some(incoming);
        }
    }
}

fn parse(frame: &[u8], stick: u32) -> Option<Incoming> {
    let (body, trailer) = frame.split_at(frame.len() - TRAILER);
    if trailer[1] != END || trailer[0] != checksum(body) || body.len() < HEADER + REQUEST_BUSINESS + MIN_RTU {
        return None;
    }
    let seq = u16::from_le_bytes([frame[5], frame[6]]);
    let serial = u32::from_le_bytes([frame[7], frame[8], frame[9], frame[10]]);
    if serial != stick {
        return Some(Incoming { seq, addressed: false, rtu: Vec::new() });
    }
    let rtu = &body[HEADER + REQUEST_BUSINESS..];
    let (data, crc) = rtu.split_at(rtu.len() - 2);
    (crc16(data).to_le_bytes() == crc).then(|| Incoming { seq, addressed: true, rtu: rtu.to_vec() })
}

/// The low byte of the sum of the bytes after the start byte, up to the checksum itself.
fn checksum(body: &[u8]) -> u8 {
    body[1..].iter().fold(0, |sum, byte| sum.wrapping_add(*byte))
}

/// A reply from `stick` to the request of sequence `seq`: its business field, then `payload`.
pub(crate) fn response(stick: u32, seq: u16, payload: &[u8]) -> Vec<u8> {
    let length = u16::try_from(RESPONSE_BUSINESS + payload.len()).unwrap_or_default();
    let mut frame = vec![START];
    frame.extend_from_slice(&length.to_le_bytes());
    frame.extend_from_slice(&CONTROL_RESPONSE.to_le_bytes());
    frame.extend_from_slice(&(STICK_COUNTER | (seq & 0xff)).to_le_bytes());
    frame.extend_from_slice(&stick.to_le_bytes());
    frame.extend_from_slice(&[0x02, 0x01]);
    frame.extend_from_slice(&[0; RESPONSE_BUSINESS - 2]);
    frame.extend_from_slice(payload);
    frame.push(checksum(&frame));
    frame.push(END);
    frame
}

/// The reply to a request that named another serial.
pub(crate) fn reject(stick: u32, seq: u16) -> Vec<u8> {
    response(stick, seq, &[STATUS_WRONG_SERIAL, 0])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex")).collect()
    }

    // Frames recorded in `fixtures/oracle/transport.ndjson`, case `solarman-v5/read-unit-1`.
    const STICK: u32 = 3_168_930_341;
    const PROBE: &str = "a51700104500000000000002000000000000000000000000000001030003000635c87815";
    const REJECT: &str = "a510001015000d250ae2bc020100000000000000000000000006001815";
    const READ: &str = "a5170010450100250ae2bc020000000000000000000000000000010301f40005c5c7c615";
    const REPLY: &str =
        "a51d001015010d250ae2bc020100000000000000000000000001030a0901fc181234000100954d007515";

    #[tokio::test]
    async fn a_request_is_read_with_its_sequence_and_inner_rtu_frame() {
        let got = read_request(&mut hex(READ).as_slice(), STICK).await;
        assert_eq!(got, Some(Incoming { seq: 1, addressed: true, rtu: hex("010301f40005c5c7") }));
    }

    #[tokio::test]
    async fn a_request_naming_another_serial_is_not_addressed() {
        let got = read_request(&mut hex(PROBE).as_slice(), STICK).await;
        assert_eq!(got, Some(Incoming { seq: 0, addressed: false, rtu: vec![] }));
    }

    #[tokio::test]
    async fn a_frame_with_a_bad_checksum_end_byte_or_crc_is_skipped_for_the_next_one() {
        let good = hex(READ);
        let mut checksum_off = good.clone();
        checksum_off[good.len() - 2] ^= 1;
        let mut end_off = good.clone();
        end_off[good.len() - 1] = 0x16;
        let mut crc_off = good.clone();
        crc_off[good.len() - 4] ^= 1;
        crc_off[good.len() - 3] ^= 1;
        let last = crc_off.len() - 2;
        crc_off[last] = checksum(&crc_off[..last]);
        for damaged in [checksum_off, end_off, crc_off] {
            let wire = [damaged, good.clone()].concat();
            let got = read_request(&mut wire.as_slice(), STICK).await;
            assert_eq!(got.map(|i| i.seq), Some(1));
        }
    }

    #[tokio::test]
    async fn bytes_before_the_start_byte_are_skipped_and_a_stream_that_ends_is_no_frame() {
        let wire = [vec![0xde, 0xad], hex(READ)].concat();
        assert_eq!(read_request(&mut wire.as_slice(), STICK).await.map(|i| i.seq), Some(1));
        assert_eq!(read_request(&mut hex(READ)[..20].as_ref(), STICK).await, None);
        assert_eq!(read_request(&mut [].as_slice(), STICK).await, None);
    }

    #[test]
    fn a_response_and_a_reject_are_the_recorded_frames() {
        let payload = hex("01030a0901fc181234000100954d00");
        assert_eq!(response(STICK, 1, &payload), hex(REPLY));
        assert_eq!(reject(STICK, 0), hex(REJECT));
    }
}
