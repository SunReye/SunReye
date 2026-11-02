//! Solarman V5: the envelope a logging stick (the wireless dongle on most Deye inverters) wraps around a
//! Modbus RTU frame. A request is `A5`, length, control `0x4510`, sequence, logger serial, a 15-byte
//! business field and the RTU frame; the reply has control `0x1510` and a business field one byte
//! shorter, because the sensor type is absent and a status byte takes its place. The read request is the
//! only one encoded (ADR 0005).
//!
//! Behaviour follows the 2.x recordings in `fixtures/oracle`: the stick's serial is learned from the reply
//! to a probe sent under serial 0; only the low byte of a reply's sequence echoes the request; status
//! `05` ("the inverter did not answer") is asked again once before it counts as exception 2; status `06`
//! (wrong serial) is an addressing failure, exception 10; a read buffer that does not start on a frame
//! is dropped, never scanned for the next start byte.

use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::{Error, rtu};

const START: u8 = 0xa5;
const END: u8 = 0x15;
/// Start, length, control, sequence, serial.
const HEADER: usize = 11;
/// Checksum and end byte.
const TRAILER: usize = 2;
const CONTROL_REQUEST: u16 = 0x4510;
const CONTROL_RESPONSE: u16 = 0x1510;
/// Frame type `0x02` (solar inverter), then zeros: the stick's own uptime counters, which it does not check.
const REQUEST_BUSINESS: usize = 15;
/// One byte shorter than the request's: mirroring the request layout would shift every field by one.
const RESPONSE_BUSINESS: usize = 14;
/// Unit id, function code, one byte of body and the CRC: what separates a reply from a status payload,
/// since both arrive under the same control code.
const MIN_RTU_FRAME: usize = 5;
/// Frame types of a request's business field.
const FRAME_TYPE_INVERTER: u8 = 0x02;

/// No stick has this serial, so one asked under it rejects the request at the stick, without forwarding
/// anything to the inverter, and its reject names the serial it has.
const PROBE_SERIAL: u32 = 0;
/// Any read will do; this is the one the recordings carry.
const PROBE_RTU: [u8; 8] = [0x01, 0x03, 0x00, 0x03, 0x00, 0x06, 0x35, 0xc8];

/// V5 status: the inverter did not answer. Asked again once, then taken as an address it will not serve.
const STATUS_UNANSWERED: u8 = 0x05;
/// V5 status: the request named a wrong or unknown logger serial.
const STATUS_WRONG_SERIAL: u8 = 0x06;
/// Modbus exception 10, gateway path unavailable.
const EXCEPTION_GATEWAY_PATH: u8 = 0x0a;
/// Modbus exception 11, gateway target device failed to respond.
const EXCEPTION_GATEWAY_TARGET: u8 = 0x0b;

/// Why a complete frame is not a usable one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FrameError {
    /// Fewer payload bytes than a reply's business field.
    Short,
    /// The byte at the length the prefix promised is not the end delimiter.
    BadEnd,
    BadChecksum,
}

/// A decoded frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Decoded {
    /// A reply carrying an RTU frame. `seq` is the raw word: only its low byte echoes the request.
    Response { serial: u32, seq: u16, rtu: Vec<u8> },
    /// A reject: the payload is too short to be an RTU frame. `seq` echoes the request it refuses.
    Status { serial: u32, seq: u16, status: u8 },
    /// Any other control code: the stick's own heartbeat.
    Other,
}

pub(super) fn encode_request(serial: u32, seq: u8, rtu: &[u8]) -> Vec<u8> {
    let length = u16::try_from(REQUEST_BUSINESS + rtu.len()).unwrap_or(u16::MAX);
    let mut frame = Vec::with_capacity(HEADER + REQUEST_BUSINESS + rtu.len() + TRAILER);
    frame.push(START);
    frame.extend_from_slice(&length.to_le_bytes());
    frame.extend_from_slice(&CONTROL_REQUEST.to_le_bytes());
    frame.extend_from_slice(&u16::from(seq).to_le_bytes());
    frame.extend_from_slice(&serial.to_le_bytes());
    frame.push(FRAME_TYPE_INVERTER);
    frame.extend_from_slice(&[0; REQUEST_BUSINESS - 1]);
    frame.extend_from_slice(rtu);
    frame.push(checksum(&frame));
    frame.push(END);
    frame
}

/// The low byte of the sum of the bytes after the start byte, up to the checksum itself.
fn checksum(body: &[u8]) -> u8 {
    body[1..].iter().fold(0, |sum, byte| sum.wrapping_add(*byte))
}

/// Decodes one complete frame, as cut by [`take_frames`].
pub(super) fn decode(frame: &[u8]) -> Result<Decoded, FrameError> {
    let total = frame.len();
    if total < HEADER + TRAILER {
        return Err(FrameError::Short);
    }
    if frame[total - 1] != END {
        return Err(FrameError::BadEnd);
    }
    if frame[total - 2] != checksum(&frame[..total - 2]) {
        return Err(FrameError::BadChecksum);
    }
    if u16::from_le_bytes([frame[3], frame[4]]) != CONTROL_RESPONSE {
        return Ok(Decoded::Other);
    }
    let payload = &frame[HEADER..total - TRAILER];
    let Some(data) = payload.get(RESPONSE_BUSINESS..) else { return Err(FrameError::Short) };
    let serial = u32::from_le_bytes([frame[7], frame[8], frame[9], frame[10]]);
    let seq = u16::from_le_bytes([frame[5], frame[6]]);
    if data.len() < MIN_RTU_FRAME {
        return Ok(Decoded::Status { serial, seq, status: data.first().copied().unwrap_or_default() });
    }
    Ok(Decoded::Response { serial, seq, rtu: data.to_vec() })
}

/// What [`take_frames`] cut off the front of a buffer.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Taken {
    pub frames: Vec<Vec<u8>>,
    /// The buffer did not start on a frame boundary and was dropped.
    pub desynchronised: bool,
}

/// Cuts the complete frames off the front of `buffer` by their length prefix and leaves a partial one. A
/// buffer that does not start on a start byte is dropped: scanning on for the next `A5` would lock onto
/// a payload byte and produce plausible nonsense. The frames cut before that point are still returned.
pub(super) fn take_frames(buffer: &mut Vec<u8>) -> Taken {
    let mut frames = Vec::new();
    let mut at = 0;
    // Three bytes are the least that state a length; fewer are kept for the next read.
    while buffer.len() - at >= 3 {
        if buffer[at] != START {
            buffer.clear();
            return Taken { frames, desynchronised: true };
        }
        let total = HEADER + usize::from(u16::from_le_bytes([buffer[at + 1], buffer[at + 2]])) + TRAILER;
        if buffer.len() - at < total {
            break;
        }
        frames.push(buffer[at..at + total].to_vec());
        at += total;
    }
    buffer.drain(..at);
    Taken { frames, desynchronised: false }
}

/// The Modbus exception a V5 reject is reported as. Only the measured meaning of `05` earns exception 2,
/// the one that splits a read plan for good.
fn exception_for(status: u8) -> u8 {
    match status {
        STATUS_UNANSWERED => super::ILLEGAL_DATA_ADDRESS,
        STATUS_WRONG_SERIAL => EXCEPTION_GATEWAY_PATH,
        _ => EXCEPTION_GATEWAY_TARGET,
    }
}

/// Any reply at all names the stick, a reject as well as a read: that is how the probe works.
fn names_serial(frame: &Decoded) -> Option<u32> {
    match frame {
        Decoded::Response { serial, .. } | Decoded::Status { serial, .. } => Some(*serial),
        Decoded::Other => None,
    }
}

/// The serial the session speaks under. The stick's own wins over a configured one.
fn pick_serial(named: Option<u32>, configured: Option<u32>) -> Result<u32, Error> {
    match (named, configured) {
        (Some(named), Some(configured)) if named != configured => Ok(warn_stale(configured, named)),
        (Some(serial), _) => Ok(serial),
        (None, Some(configured)) => Ok(warn_unanswered(configured)),
        (None, None) => Err(Error::Protocol("no answer to the logger serial probe and none configured")),
    }
}

fn warn_stale(configured: u32, named: u32) -> u32 {
    tracing::warn!(configured, named, "configured logger serial is stale, using the stick's");
    named
}

fn warn_unanswered(configured: u32) -> u32 {
    tracing::warn!("logger serial probe unanswered, using the configured serial");
    configured
}

/// The read in flight: the sequence of its latest attempt, and whether it has used its one retry.
#[derive(Debug)]
struct Asked {
    seq: u8,
    retried: bool,
}

/// What a frame means for the read in flight.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    /// The RTU frame that answers it.
    Answer(Vec<u8>),
    /// The stick refused it with this V5 status.
    Reject(u8),
    /// A transient refusal: ask again once.
    Retry,
    Skip,
}

/// A reply counts only from the stick's own serial and under the sequence asked; a reject is tied to its
/// request by sequence alone, since a wrong-serial reject names the stick, not the serial that was used.
fn classify(frame: Decoded, serial: u32, asked: &Asked) -> Step {
    match frame {
        Decoded::Response { serial: from, seq, rtu } if from == serial && echoes(seq, asked.seq) => {
            Step::Answer(rtu)
        }
        Decoded::Status { seq, status, .. } if echoes(seq, asked.seq) => {
            if status == STATUS_UNANSWERED && !asked.retried { Step::Retry } else { Step::Reject(status) }
        }
        other => skip(&other),
    }
}

fn skip(frame: &Decoded) -> Step {
    tracing::debug!(?frame, "dropping a frame that does not answer the read");
    Step::Skip
}

fn refused(status: u8) -> Error {
    let exception = exception_for(status);
    tracing::warn!(status, exception, "the logger rejected the read");
    Error::Exception(exception)
}

/// One connection to a stick: its serial, the next sequence and the bytes of a frame not yet whole.
#[derive(Debug)]
pub(super) struct Session {
    serial: u32,
    seq: u8,
    buffer: Vec<u8>,
}

impl Session {
    /// Learns the stick's serial: sends the probe and takes the serial from the first reply, whatever it
    /// says. The configured serial is a fallback for a stick that stays silent, never the truth: a stale
    /// one would poll a dead address forever.
    pub(super) async fn open<S>(
        stream: &mut S,
        configured: Option<u32>,
        timeout: Duration,
    ) -> Result<Self, Error>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let mut session = Self { serial: PROBE_SERIAL, seq: 0, buffer: Vec::new() };
        let seq = session.next_seq();
        stream.write_all(&encode_request(PROBE_SERIAL, seq, &PROBE_RTU)).await?;
        let named = tokio::time::timeout(timeout, session.named_serial(stream)).await.ok().transpose()?;
        session.serial = pick_serial(named, configured)?;
        Ok(session)
    }

    async fn named_serial<S: AsyncRead + Unpin>(&mut self, stream: &mut S) -> Result<u32, Error> {
        loop {
            let frames = self.next_frames(stream).await?;
            if let Some(serial) = frames.iter().find_map(names_serial) {
                return Ok(serial);
            }
        }
    }

    /// The sequence to send next. A byte, because only the low byte is echoed back.
    fn next_seq(&mut self) -> u8 {
        let seq = self.seq;
        self.seq = seq.wrapping_add(1);
        seq
    }

    /// Reads `count` holding registers from `start` of `unit`. After any error but [`Error::Exception`]
    /// the stream may hold a half-read reply: drop the connection.
    pub(super) async fn read_holding<S>(
        &mut self,
        stream: &mut S,
        unit: u8,
        start: u16,
        count: u16,
    ) -> Result<Vec<u16>, Error>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let rtu = rtu::read_request(unit, start, count);
        let mut asked = Asked { seq: self.send(stream, &rtu).await?, retried: false };
        let reply = loop {
            let frames = self.next_frames(stream).await?;
            if let Some(reply) = self.settle(stream, &rtu, &mut asked, frames).await? {
                break reply;
            }
        };
        rtu::parse_frame(&reply, unit, count)
    }

    /// Applies `frames` in order to the outstanding read: the RTU frame that answers it, if one does. A
    /// frame after the answer is dropped, as a reply with nothing outstanding is.
    async fn settle<S: AsyncWrite + Unpin>(
        &mut self,
        stream: &mut S,
        rtu: &[u8],
        asked: &mut Asked,
        frames: Vec<Decoded>,
    ) -> Result<Option<Vec<u8>>, Error> {
        for frame in frames {
            match classify(frame, self.serial, asked) {
                Step::Answer(reply) => return Ok(Some(reply)),
                Step::Reject(status) => return Err(refused(status)),
                Step::Retry => {
                    asked.retried = true;
                    asked.seq = self.send(stream, rtu).await?;
                }
                Step::Skip => {}
            }
        }
        Ok(None)
    }

    /// Sends one RTU frame under a fresh sequence, a retry included, so a late answer to the refused
    /// attempt stays recognisable as stale.
    async fn send<S: AsyncWrite + Unpin>(&mut self, stream: &mut S, rtu: &[u8]) -> Result<u8, Error> {
        let seq = self.next_seq();
        stream.write_all(&encode_request(self.serial, seq, rtu)).await?;
        Ok(seq)
    }

    /// Waits for bytes and returns the frames they complete, malformed ones dropped.
    async fn next_frames<S: AsyncRead + Unpin>(&mut self, stream: &mut S) -> Result<Vec<Decoded>, Error> {
        let mut chunk = [0_u8; 512];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(Error::Io("connection closed".to_owned()));
        }
        self.buffer.extend_from_slice(&chunk[..read]);
        let taken = take_frames(&mut self.buffer);
        if taken.desynchronised {
            tracing::warn!("dropping a read buffer that does not start on a frame");
        }
        let decoded = taken.frames.iter().filter_map(|frame| match decode(frame) {
            Ok(decoded) => Some(decoded),
            Err(error) => {
                tracing::warn!(?error, "dropping a malformed frame");
                None
            }
        });
        Ok(decoded.collect())
    }
}

/// Whether a reply's raw sequence word answers the request sent under `seq`.
fn echoes(raw: u16, seq: u8) -> bool {
    raw.to_le_bytes()[0] == seq
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream, duplex};

    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex")).collect()
    }

    // Frames recorded in `fixtures/oracle/transport.ndjson`, `solarman-v5` cases, stick serial 3168930341.
    const STICK: u32 = 3_168_930_341;
    const PROBE: &str = "a51700104500000000000002000000000000000000000000000001030003000635c87815";
    const REJECT_06: &str = "a510001015000d250ae2bc020100000000000000000000000006001815";
    const READ_1: &str = "a5170010450100250ae2bc020000000000000000000000000000010301f40005c5c7c615";
    const REPLY_1: &str =
        "a51d001015010d250ae2bc020100000000000000000000000001030a0901fc181234000100954d007515";
    const READ_UNIT_0: &str = "a5170010450100250ae2bc020000000000000000000000000000000301f40005c4161315";
    const HEARTBEAT: &str = "a501001047046f250ae2bc009815";
    const STATUS_05_SEQ_1: &str = "a510001015010d250ae2bc020100000000000000000000000005001815";
    const RETRY_SEQ_2: &str = "a5170010450200250ae2bc020000000000000000000000000000010301f40005c5c7c715";
    const WORDS: [u16; 5] = [0x0901, 0xfc18, 0x1234, 0x0001, 0x0095];

    /// `frame` with its checksum recomputed after `edit`.
    fn restamped(frame: &str, edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut bytes = hex(frame);
        edit(&mut bytes);
        let at = bytes.len() - 2;
        bytes[at] = bytes[1..at].iter().fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
        bytes
    }

    #[test]
    fn a_request_is_the_recorded_frame_for_the_probe_and_for_a_read() {
        assert_eq!(encode_request(0, 0, &hex("01030003000635c8")), hex(PROBE));
        assert_eq!(encode_request(STICK, 1, &hex("010301f40005c5c7")), hex(READ_1));
        assert_eq!(encode_request(STICK, 1, &hex("000301f40005c416")), hex(READ_UNIT_0));
        assert_eq!(encode_request(STICK, 2, &hex("010301f40005c5c7")), hex(RETRY_SEQ_2));
    }

    #[test]
    fn the_only_function_the_encoder_can_send_is_a_read() {
        for (unit, start, count) in [(0, 0, 1), (1, 500, 5), (255, 65535, 125)] {
            let request = encode_request(STICK, 1, &rtu::read_request(unit, start, count));
            assert_eq!(request[26 + 1], 3, "the function code of the inner RTU frame");
        }
    }

    #[test]
    fn a_reply_is_a_response_carrying_the_rtu_frame_and_the_stick_serial() {
        assert_eq!(
            decode(&hex(REPLY_1)),
            Ok(Decoded::Response { serial: STICK, seq: 0x0d01, rtu: hex("01030a0901fc181234000100954d00") })
        );
    }

    #[test]
    fn a_payload_too_short_to_be_an_rtu_frame_is_a_status() {
        assert_eq!(decode(&hex(REJECT_06)), Ok(Decoded::Status { serial: STICK, seq: 0x0d00, status: 6 }));
        assert_eq!(
            decode(&hex(STATUS_05_SEQ_1)),
            Ok(Decoded::Status { serial: STICK, seq: 0x0d01, status: 5 })
        );
        let empty = restamped(REJECT_06, |frame| {
            frame.drain(25..27);
            frame[1] = 14;
        });
        assert_eq!(decode(&empty), Ok(Decoded::Status { serial: STICK, seq: 0x0d00, status: 0 }));
        let four = restamped(REPLY_1, |frame| {
            frame.drain(29..40);
            frame[1] = 14 + 4;
        });
        assert!(matches!(decode(&four), Ok(Decoded::Status { .. })), "four bytes are not an RTU frame");
        let five = restamped(REPLY_1, |frame| {
            frame.drain(30..40);
            frame[1] = 14 + 5;
        });
        assert!(
            matches!(decode(&five), Ok(Decoded::Response { .. })),
            "five bytes are the shortest RTU frame"
        );
    }

    #[test]
    fn a_frame_under_another_control_code_is_not_acted_on() {
        assert_eq!(decode(&hex(HEARTBEAT)), Ok(Decoded::Other));
        assert_eq!(decode(&hex(READ_1)), Ok(Decoded::Other), "our own request fed back");
    }

    #[test]
    fn the_checksum_end_byte_and_business_field_are_checked() {
        let mut checksum = hex(REPLY_1);
        let at = checksum.len() - 2;
        checksum[at] ^= 1;
        assert_eq!(decode(&checksum), Err(FrameError::BadChecksum));
        let mut end = hex(REPLY_1);
        let at = end.len() - 1;
        end[at] = 0x16;
        assert_eq!(decode(&end), Err(FrameError::BadEnd));
        let short = restamped(REPLY_1, |frame| {
            frame.drain(24..40);
            frame[1] = 13;
        });
        assert_eq!(decode(&short), Err(FrameError::Short), "13 bytes cannot hold a 14-byte business field");
    }

    #[test]
    fn frames_are_taken_off_the_front_and_a_partial_one_stays() {
        let mut buffer = [hex(HEARTBEAT), hex(REPLY_1), hex(REPLY_1)[..10].to_vec()].concat();
        let taken = take_frames(&mut buffer);
        assert_eq!(taken.frames, [hex(HEARTBEAT), hex(REPLY_1)]);
        assert!(!taken.desynchronised);
        assert_eq!(buffer, hex(REPLY_1)[..10]);
        buffer.extend_from_slice(&hex(REPLY_1)[10..]);
        assert_eq!(take_frames(&mut buffer).frames, [hex(REPLY_1)]);
        assert_eq!(buffer, Vec::<u8>::new());
    }

    #[test]
    fn fewer_than_three_bytes_cannot_state_a_length_and_are_kept() {
        for held in [vec![], vec![0xde], vec![0xde, 0xad]] {
            let mut buffer = held.clone();
            let taken = take_frames(&mut buffer);
            assert_eq!((taken.frames.len(), taken.desynchronised, buffer), (0, false, held));
        }
    }

    #[test]
    fn a_buffer_not_starting_on_a_frame_is_dropped_but_the_frames_before_it_are_kept() {
        let mut stray = [hex(REPLY_1), vec![0xde, 0xad, 0xbe]].concat();
        let taken = take_frames(&mut stray);
        assert_eq!(taken.frames, [hex(REPLY_1)]);
        assert!(taken.desynchronised);
        assert_eq!(stray, Vec::<u8>::new());

        let mut junk_first = [vec![0xde, 0xad, 0xbe], hex(REPLY_1)].concat();
        let taken = take_frames(&mut junk_first);
        assert_eq!((taken.frames.len(), taken.desynchronised, junk_first.len()), (0, true, 0));
    }

    #[test]
    fn a_status_becomes_the_exception_the_transport_above_reacts_to() {
        assert_eq!(exception_for(5), 2, "the inverter did not answer: an address it will not serve");
        assert_eq!(exception_for(6), 10, "an addressing failure must never read as a refused register");
        assert_eq!(exception_for(7), 11);
        assert_eq!(exception_for(0), 11);
    }

    #[test]
    fn the_sticks_serial_wins_and_the_configured_one_is_only_a_fallback() {
        assert_eq!(pick_serial(Some(STICK), None), Ok(STICK));
        assert_eq!(pick_serial(Some(STICK), Some(STICK)), Ok(STICK));
        assert_eq!(pick_serial(Some(STICK), Some(0x1122_3344)), Ok(STICK));
        assert_eq!(pick_serial(None, Some(7)), Ok(7));
        let none = Error::Protocol("no answer to the logger serial probe and none configured");
        assert_eq!(pick_serial(None, None), Err(none));
    }

    #[test]
    fn a_frame_is_an_answer_a_refusal_a_retry_or_nothing_to_the_read_in_flight() {
        let asked = Asked { seq: 1, retried: false };
        let rtu = hex("01030a0901fc181234000100954d00");
        let reply = |serial, seq| Decoded::Response { serial, seq, rtu: rtu.clone() };
        let status = |seq, status| Decoded::Status { serial: STICK, seq, status };
        assert_eq!(classify(reply(STICK, 0x0d01), STICK, &asked), Step::Answer(rtu.clone()));
        assert_eq!(classify(reply(STICK + 1, 0x0d01), STICK, &asked), Step::Skip, "another stick");
        assert_eq!(classify(reply(STICK, 0x0d02), STICK, &asked), Step::Skip, "another sequence");
        assert_eq!(classify(status(0x0d01, 5), STICK, &asked), Step::Retry);
        assert_eq!(classify(status(0x0d01, 5), STICK, &Asked { retried: true, ..asked }), Step::Reject(5));
        assert_eq!(classify(status(0x0d01, 6), STICK, &asked), Step::Reject(6), "06 is never retried");
        assert_eq!(classify(status(0x0d02, 6), STICK, &asked), Step::Skip, "another sequence");
        assert_eq!(classify(Decoded::Other, STICK, &asked), Step::Skip);
    }

    type Seen = Arc<Mutex<Vec<Vec<u8>>>>;

    /// A stick on one end of an in-memory stream: `script` is what it answers to each request, in turn,
    /// and `seen` what it was sent. Once the script ends it hangs up, or with `keep_open` goes on
    /// listening until the client does.
    fn stick(script: Vec<Vec<Vec<u8>>>, keep_open: bool) -> (DuplexStream, Seen) {
        let (client, device) = duplex(4096);
        let seen = Seen::default();
        tokio::spawn(serve(device, Arc::clone(&seen), script, keep_open));
        (client, seen)
    }

    async fn serve(mut device: DuplexStream, log: Seen, script: Vec<Vec<Vec<u8>>>, keep_open: bool) {
        for replies in script {
            if !answer(&mut device, &log, replies).await {
                return;
            }
        }
        while keep_open && device.read(&mut [0_u8; 64]).await.is_ok_and(|read| read > 0) {}
    }

    /// Reads one request, logs it and writes `replies`; false once the client has gone.
    async fn answer(device: &mut DuplexStream, log: &Seen, replies: Vec<Vec<u8>>) -> bool {
        let mut head = [0_u8; 3];
        if device.read_exact(&mut head).await.is_err() {
            return false;
        }
        let mut rest = vec![0_u8; 8 + usize::from(u16::from_le_bytes([head[1], head[2]])) + 2];
        device.read_exact(&mut rest).await.expect("rest of the request");
        log.lock().expect("log").push([head.as_slice(), &rest].concat());
        for reply in replies {
            device.write_all(&reply).await.expect("reply");
        }
        true
    }

    /// What the stick has been sent, once it has had time to read it.
    async fn requests(seen: &Seen) -> Vec<Vec<u8>> {
        tokio::time::sleep(Duration::from_millis(50)).await;
        seen.lock().expect("log").clone()
    }

    const TIMEOUT: Duration = Duration::from_millis(300);

    #[tokio::test]
    async fn the_serial_in_the_probe_reply_wins_over_the_configured_one() {
        let (mut stream, seen) = stick(vec![vec![hex(REJECT_06)]], false);
        let session = Session::open(&mut stream, Some(0x1122_3344), TIMEOUT).await.expect("open");
        assert_eq!(session.serial, STICK);
        assert_eq!(requests(&seen).await, [hex(PROBE)]);
    }

    #[tokio::test]
    async fn an_unanswered_probe_falls_back_to_the_configured_serial_and_fails_without_one() {
        let (mut stream, _) = stick(vec![vec![]], true);
        let session = Session::open(&mut stream, Some(7), TIMEOUT).await.expect("open");
        assert_eq!(session.serial, 7);
        let (mut stream, _) = stick(vec![vec![]], true);
        let error = Session::open(&mut stream, None, TIMEOUT).await.expect_err("no serial");
        assert_eq!(error, Error::Protocol("no answer to the logger serial probe and none configured"));
    }

    #[tokio::test]
    async fn a_heartbeat_and_a_corrupt_frame_do_not_answer_the_probe() {
        let mut corrupt = hex(REJECT_06);
        let at = corrupt.len() - 2;
        corrupt[at] ^= 1;
        let (mut stream, _) = stick(vec![vec![[hex(HEARTBEAT), corrupt, hex(REJECT_06)].concat()]], false);
        let session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        assert_eq!(session.serial, STICK);
    }

    #[tokio::test]
    async fn a_reply_with_the_wrong_serial_or_sequence_is_not_the_answer() {
        let other_serial = restamped(REPLY_1, |frame| frame[7] ^= 1);
        let other_seq = restamped(REPLY_1, |frame| frame[5] = 9);
        let stale = [other_serial, other_seq, hex(REPLY_1)].concat();
        let (mut stream, _) = stick(vec![vec![hex(REJECT_06)], vec![stale]], true);
        let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        assert_eq!(session.read_holding(&mut stream, 1, 500, 5).await, Ok(WORDS.to_vec()));
    }

    #[tokio::test]
    async fn sequences_count_from_the_probe_and_wrap_within_a_byte() {
        let (mut stream, _) = stick(vec![vec![hex(REJECT_06)]], false);
        let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        assert_eq!(session.next_seq(), 1);
        session.seq = 255;
        assert_eq!((session.next_seq(), session.next_seq()), (255, 0));
    }

    #[tokio::test]
    async fn a_reject_for_another_sequence_is_dropped_and_a_status_05_is_asked_again_once() {
        let stale = restamped(STATUS_05_SEQ_1, |frame| frame[5] = 9);
        let script = vec![
            vec![hex(REJECT_06)],
            vec![[stale, hex(STATUS_05_SEQ_1)].concat()],
            vec![restamped(REPLY_1, |frame| frame[5] = 2)],
        ];
        let (mut stream, seen) = stick(script, true);
        let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        assert_eq!(session.read_holding(&mut stream, 1, 500, 5).await, Ok(WORDS.to_vec()));
        assert_eq!(requests(&seen).await, [hex(PROBE), hex(READ_1), hex(RETRY_SEQ_2)]);
    }

    #[tokio::test]
    async fn a_status_06_and_an_unknown_status_end_the_read_at_once() {
        let refused = |status: u8| restamped(STATUS_05_SEQ_1, move |frame| frame[25] = status);
        for (status, want) in [(refused(6), 10), (refused(9), 11)] {
            let (mut stream, seen) = stick(vec![vec![hex(REJECT_06)], vec![status]], true);
            let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
            let got = session.read_holding(&mut stream, 1, 500, 5).await;
            assert_eq!(got, Err(Error::Exception(want)));
            assert_eq!(requests(&seen).await.len(), 2, "no retry");
        }
    }

    #[tokio::test]
    async fn a_reply_whose_rtu_frame_is_damaged_or_from_another_unit_is_a_protocol_error() {
        let bad_crc = restamped(REPLY_1, |frame| frame[39] ^= 1);
        let other_unit = restamped(REPLY_1, |frame| {
            frame[25] = 2;
            let crc = rtu::crc16(&frame[25..38]).to_le_bytes();
            frame[38..40].copy_from_slice(&crc);
        });
        for (reply, want) in [(bad_crc, "crc mismatch"), (other_unit, "unit id mismatch")] {
            let (mut stream, _) = stick(vec![vec![hex(REJECT_06)], vec![reply]], true);
            let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
            let got = session.read_holding(&mut stream, 1, 500, 5).await;
            assert_eq!(got, Err(Error::Protocol(want)));
        }
    }

    #[tokio::test]
    async fn a_reply_for_more_words_than_were_asked_is_a_protocol_error() {
        let (mut stream, _) = stick(vec![vec![hex(REJECT_06)], vec![hex(REPLY_1)]], true);
        let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        let got = session.read_holding(&mut stream, 1, 500, 4).await;
        assert_eq!(got, Err(Error::Protocol("byte count mismatch")));
    }

    #[tokio::test]
    async fn a_stick_that_hangs_up_is_an_i_o_error() {
        let (mut stream, _) = stick(vec![vec![hex(REJECT_06)]], false);
        let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        let got = session.read_holding(&mut stream, 1, 500, 5).await;
        assert!(matches!(got, Err(Error::Io(_))), "{got:?}");
    }

    #[tokio::test]
    async fn a_silent_stick_is_waited_for_until_the_caller_gives_up() {
        let (mut stream, _) = stick(vec![vec![hex(REJECT_06)], vec![]], true);
        let mut session = Session::open(&mut stream, None, TIMEOUT).await.expect("open");
        let waiting = session.read_holding(&mut stream, 1, 500, 5);
        assert!(tokio::time::timeout(Duration::from_millis(100), waiting).await.is_err());
    }
}
