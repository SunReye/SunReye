//! Solarman V5 framing: a logging stick (port 8899) wraps each Modbus RTU frame, CRC included, in
//! an envelope of its own. Measured on the owner's stick in v4:
//!
//! - A request's business field is 15 bytes, a reply's 14.
//! - The stick echoes only the low byte of the sequence.
//! - It never forwards a Modbus exception for a request it refuses: it answers with a V5 status.
//!   `05` (the inverter did not answer) is transient under load, so it is asked once more before it
//!   counts as exception 2; `06` (wrong logger serial) maps to exception 10.
//! - Every reply, a refusal included, names the stick's serial, so a probe with serial 0 discovers
//!   it without touching the RS485 bus.

use std::ops::Range;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::Error;

const START: u8 = 0xa5;
const END: u8 = 0x15;
/// Start (1), length (2), control (2), sequence (2), logger serial (4).
const HEADER: usize = 11;
/// Checksum and end byte.
const TRAILER: usize = 2;
const REQUEST_BUSINESS: usize = 15;
const RESPONSE_BUSINESS: usize = 14;
const CONTROL_REQUEST: u16 = 0x4510;
const CONTROL_RESPONSE: u16 = 0x1510;
/// Frame type in the request's business field: solar inverter.
const FRAME_TYPE: u8 = 2;
/// Unit id, function, one byte, CRC: an exception reply. A shorter payload is a V5 status.
const MIN_RTU: usize = 5;
/// The largest RTU frame: unit id, a 253-byte PDU and the CRC.
const MAX_RTU: usize = 256;
/// The largest frame either way; a request's business field is the longer.
pub const MAX_FRAME: usize = HEADER + REQUEST_BUSINESS + MAX_RTU + TRAILER;
/// The inverter did not answer the request.
const STATUS_TRANSIENT: u8 = 5;
/// The request named a serial the stick does not have.
const STATUS_WRONG_SERIAL: u8 = 6;
/// Read holding registers 3 to 8 of unit 1. Sent with serial 0, the stick refuses it unforwarded.
const PROBE: [u8; 6] = [1, 3, 0, 3, 0, 6];
const NOT_V5: Error = Error::Protocol("not a Solarman V5 frame");

/// The stick one connection talks to.
#[derive(Debug)]
pub struct Logger {
    serial: u32,
    /// The sequence of the next request.
    seq: u8,
}

/// A frame from the stick that may answer a request.
enum Frame {
    /// A heartbeat, a corrupt frame, or anything else that answers nothing.
    Skip,
    /// A V5 status in place of an RTU frame.
    Status { serial: u32, seq: u8, status: u8 },
    /// An RTU frame at `rtu` in the buffer.
    Reply {
        serial: u32,
        seq: u8,
        rtu: Range<usize>,
    },
}

/// What came back for one request.
enum Answer {
    /// The reply's PDU, at this range in the buffer.
    Pdu(Range<usize>),
    Status(u8),
}

impl Logger {
    /// Sends the probe and takes the serial from whatever answers it.
    pub async fn discover<W: AsyncRead + AsyncWrite + Unpin + ?Sized>(
        wire: &mut W,
        buffer: &mut [u8; MAX_FRAME],
    ) -> Result<Self, Error> {
        let mut probe = Self { serial: 0, seq: 0 };
        probe.send(wire, &PROBE).await?;
        loop {
            match read_frame(wire, buffer).await? {
                Frame::Skip => {}
                Frame::Status { serial, .. } | Frame::Reply { serial, .. } => {
                    return Ok(Self {
                        serial,
                        seq: probe.seq,
                    });
                }
            }
        }
    }

    /// Sends `adu` (unit id and PDU) and returns where the reply's PDU sits in `buffer`.
    pub async fn exchange<W: AsyncRead + AsyncWrite + Unpin + ?Sized>(
        &mut self,
        wire: &mut W,
        adu: &[u8],
        buffer: &mut [u8; MAX_FRAME],
    ) -> Result<Range<usize>, Error> {
        let unit = adu
            .first()
            .copied()
            .ok_or(Error::Protocol("empty request"))?;
        let mut retried = false;
        loop {
            let seq = self.send(wire, adu).await?;
            match self.answer(wire, buffer, seq, unit).await? {
                Answer::Pdu(pdu) => return Ok(pdu),
                Answer::Status(STATUS_TRANSIENT) if !retried => retried = true,
                Answer::Status(status) => return Err(Error::Exception(exception(status))),
            }
        }
    }

    /// Wraps `adu` with its CRC under a fresh sequence, so a late answer to an earlier attempt
    /// stays stale.
    async fn send<W: AsyncWrite + Unpin + ?Sized>(
        &mut self,
        wire: &mut W,
        adu: &[u8],
    ) -> Result<u8, Error> {
        let seq = self.seq;
        self.seq = seq.wrapping_add(1);
        let mut frame = [0; MAX_FRAME];
        wire.write_all(encode(&mut frame, self.serial, seq, adu)?)
            .await?;
        Ok(seq)
    }

    /// Reads frames until one answers `seq`. A refusal is matched by sequence alone: a `06` names
    /// a serial other than the one asked with.
    async fn answer<W: AsyncRead + Unpin + ?Sized>(
        &self,
        wire: &mut W,
        buffer: &mut [u8; MAX_FRAME],
        seq: u8,
        unit: u8,
    ) -> Result<Answer, Error> {
        loop {
            match read_frame(wire, buffer).await? {
                Frame::Status { seq: s, status, .. } if s == seq => {
                    return Ok(Answer::Status(status));
                }
                Frame::Reply {
                    serial,
                    seq: s,
                    rtu,
                } if s == seq && serial == self.serial => {
                    return pdu(buffer, rtu, unit).map(Answer::Pdu);
                }
                Frame::Skip | Frame::Status { .. } | Frame::Reply { .. } => {}
            }
        }
    }
}

/// The Modbus exception a refusal stands for. An unknown status is 11, never 2: only the measured
/// meaning of `05` may split a block.
const fn exception(status: u8) -> u8 {
    match status {
        STATUS_TRANSIENT => 2,
        STATUS_WRONG_SERIAL => 10,
        _ => 11,
    }
}

/// Copies `bytes` into `out` at `at`; returns the offset after them.
fn put(out: &mut [u8], at: usize, bytes: &[u8]) -> Result<usize, Error> {
    let end = at + bytes.len();
    out.get_mut(at..end)
        .ok_or(Error::Protocol("count out of range"))?
        .copy_from_slice(bytes);
    Ok(end)
}

fn encode<'a>(
    out: &'a mut [u8; MAX_FRAME],
    serial: u32,
    seq: u8,
    adu: &[u8],
) -> Result<&'a [u8], Error> {
    let length = u16::try_from(REQUEST_BUSINESS + adu.len() + 2)
        .map_err(|_| Error::Protocol("count out of range"))?;
    let mut at = put(out, 0, &[START])?;
    at = put(out, at, &length.to_le_bytes())?;
    at = put(out, at, &CONTROL_REQUEST.to_le_bytes())?;
    at = put(out, at, &[seq, 0])?;
    at = put(out, at, &serial.to_le_bytes())?;
    // Frame type, then a sensor type and three uptime counters the stick does not check.
    at = put(out, at, &[FRAME_TYPE])?;
    at = put(out, at, &[0; REQUEST_BUSINESS - 1])?;
    at = put(out, at, adu)?;
    at = put(out, at, &crc16(adu).to_le_bytes())?;
    let sum = checksum(out.get(..at).unwrap_or_default());
    at = put(out, at, &[sum, END])?;
    out.get(..at).ok_or(Error::Protocol("count out of range"))
}

/// Reads one whole frame into `buffer`. A frame that does not start or end on its delimiter
/// means the stream lost its place: an error, so the caller reconnects.
async fn read_frame<W: AsyncRead + Unpin + ?Sized>(
    wire: &mut W,
    buffer: &mut [u8; MAX_FRAME],
) -> Result<Frame, Error> {
    let mut head = [0; 3];
    wire.read_exact(&mut head).await?;
    let [start, l0, l1] = head;
    if start != START {
        return Err(NOT_V5);
    }
    let total = HEADER + usize::from(u16::from_le_bytes([l0, l1])) + TRAILER;
    let frame = buffer
        .get_mut(..total)
        .ok_or(Error::Protocol("bad length"))?;
    let (front, rest) = frame.split_at_mut(head.len());
    front.copy_from_slice(&head);
    wire.read_exact(rest).await?;
    decode(frame)
}

/// Classifies one whole frame; its payload is not copied.
fn decode(frame: &[u8]) -> Result<Frame, Error> {
    let Some((body, &[sum, end])) = frame.split_last_chunk::<TRAILER>() else {
        return Err(NOT_V5);
    };
    if end != END {
        return Err(NOT_V5);
    }
    let Some(&[_, _, _, c0, c1, seq, _, s0, s1, s2, s3]) = body.first_chunk::<HEADER>() else {
        return Err(NOT_V5);
    };
    let payload = HEADER + RESPONSE_BUSINESS..body.len();
    if sum != checksum(body)
        || u16::from_le_bytes([c0, c1]) != CONTROL_RESPONSE
        || payload.is_empty()
    {
        return Ok(Frame::Skip);
    }
    let serial = u32::from_le_bytes([s0, s1, s2, s3]);
    if payload.len() < MIN_RTU {
        let status = body.get(payload.start).copied().unwrap_or_default();
        return Ok(Frame::Status {
            serial,
            seq,
            status,
        });
    }
    Ok(Frame::Reply {
        serial,
        seq,
        rtu: payload,
    })
}

/// The PDU of the RTU frame at `rtu`, once its CRC and unit id hold.
fn pdu(buffer: &[u8], rtu: Range<usize>, unit: u8) -> Result<Range<usize>, Error> {
    let frame = buffer
        .get(rtu.clone())
        .ok_or(Error::Protocol("bad length"))?;
    let Some((adu, crc)) = frame.split_last_chunk::<2>() else {
        return Err(Error::Protocol("bad length"));
    };
    if crc16(adu).to_le_bytes() != *crc {
        return Err(Error::Protocol("bad CRC"));
    }
    if adu.first() != Some(&unit) {
        return Err(Error::Protocol("unit id mismatch"));
    }
    Ok(rtu.start + 1..rtu.end - 2)
}

/// The low byte of the sum of every byte after the start byte.
pub(super) fn checksum(body: &[u8]) -> u8 {
    body.iter()
        .skip(1)
        .fold(0, |sum, byte| sum.wrapping_add(*byte))
}

/// Modbus RTU CRC16: reflected, polynomial 0xA001, seed 0xFFFF.
pub(super) fn crc16(bytes: &[u8]) -> u16 {
    bytes.iter().fold(0xffff, |crc, byte| {
        (0..8).fold(crc ^ u16::from(*byte), |crc, _| {
            if crc & 1 == 1 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            }
        })
    })
}
