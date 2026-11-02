//! RTU framing on a TCP stream: unit id, PDU, CRC-16/Modbus with the low byte first. The read request
//! is the only one encoded (ADR 0005).

use tokio::io::{AsyncRead, AsyncReadExt};

use super::{EXCEPTION_FLAG, Error, FC_READ_HOLDING, parse_pdu};

const CRC_LEN: usize = 2;

/// Unit, function, start, count, CRC.
pub(super) fn read_request(unit: u8, start: u16, count: u16) -> [u8; 8] {
    let [s0, s1] = start.to_be_bytes();
    let [c0, c1] = count.to_be_bytes();
    let body = [unit, FC_READ_HOLDING, s0, s1, c0, c1];
    let mut frame = [0_u8; 8];
    frame[..6].copy_from_slice(&body);
    frame[6..].copy_from_slice(&crc16(&body).to_le_bytes());
    frame
}

/// Reads one reply frame, checks it and returns its words. An RTU frame carries no length: it is read
/// by the function code and byte count it opens with, so a frame that opens otherwise is not read on.
/// Bytes before the frame are skipped one at a time until a unit id or a read function code opens it.
pub(super) async fn read_reply<R: AsyncRead + Unpin>(
    stream: &mut R,
    unit: u8,
    count: u16,
) -> Result<Vec<u16>, Error> {
    let mut frame = vec![0_u8; 2];
    stream.read_exact(&mut frame).await?;
    while !opens_a_reply(&frame, unit) {
        frame[0] = frame[1];
        frame[1] = stream.read_u8().await?;
    }
    let rest = match frame[1] {
        FC_READ_HOLDING => {
            let bytes = stream.read_u8().await?;
            if usize::from(bytes) != usize::from(count) * 2 {
                return Err(Error::Protocol("byte count mismatch"));
            }
            frame.push(bytes);
            usize::from(bytes) + CRC_LEN
        }
        function if function == FC_READ_HOLDING | EXCEPTION_FLAG => 1 + CRC_LEN,
        _ => return Err(Error::Protocol("unexpected function")),
    };
    let opened = frame.len();
    frame.resize(opened + rest, 0);
    stream.read_exact(&mut frame[opened..]).await?;
    check_frame(&frame, unit)?;
    parse_pdu(&frame[1..frame.len() - CRC_LEN], count)
}

/// Whether `head` can be the first two bytes of a reply: the unit asked, or a read or its exception.
fn opens_a_reply(head: &[u8], unit: u8) -> bool {
    head[0] == unit || head[1] == FC_READ_HOLDING || head[1] == FC_READ_HOLDING | EXCEPTION_FLAG
}

/// The CRC and the unit id of a whole frame.
fn check_frame(frame: &[u8], unit: u8) -> Result<(), Error> {
    let (body, crc) = frame.split_at(frame.len() - CRC_LEN);
    if crc16(body).to_le_bytes() != crc {
        return Err(Error::Protocol("crc mismatch"));
    }
    if body[0] != unit {
        return Err(Error::Protocol("unit id mismatch"));
    }
    Ok(())
}

/// CRC-16/Modbus: reflected polynomial 0xA001, seed 0xFFFF.
fn crc16(bytes: &[u8]) -> u16 {
    bytes.iter().fold(0xFFFF, |mut crc, byte| {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xA001 } else { crc >> 1 };
        }
        crc
    })
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex")).collect()
    }

    async fn reply(wire: &str, unit: u8, count: u16) -> Result<Vec<u16>, Error> {
        read_reply(&mut Cursor::new(hex(wire)), unit, count).await
    }

    #[test]
    fn the_crc_is_the_modbus_one_from_the_specification_examples() {
        assert_eq!(crc16(&hex("010300000001")), 0x0a84);
        assert_eq!(crc16(&hex("01030000000a")), 0xcdc5);
        assert_eq!(crc16(&hex("0103020000")), 0x44b8);
        assert_eq!(crc16(&[]), 0xffff);
        assert_eq!(crc16(b"123456789"), 0x4b37, "the CRC-16/MODBUS check value");
    }

    #[test]
    fn a_read_request_is_unit_function_range_and_crc_low_byte_first() {
        assert_eq!(read_request(1, 0, 10), hex("01030000000ac5cd")[..]);
        assert_eq!(read_request(1, 500, 5), hex("010301f40005c5c7")[..]);
        assert_eq!(read_request(0, 500, 5), hex("000301f40005c416")[..]);
        assert_eq!(read_request(255, 65535, 125)[..2], [255, 3]);
    }

    #[test]
    fn the_only_function_the_encoder_can_send_is_a_read() {
        for (unit, start, count) in [(0, 0, 1), (1, 500, 5), (255, 65535, 125)] {
            assert_eq!(read_request(unit, start, count)[1], 3);
        }
    }

    #[tokio::test]
    async fn a_reply_yields_its_words() {
        assert_eq!(reply("0103020000b844", 1, 1).await, Ok(vec![0]));
        assert_eq!(
            reply("01030a0901fc181234000100954d00", 1, 5).await,
            Ok(vec![0x0901, 0xfc18, 0x1234, 1, 0x95])
        );
    }

    #[tokio::test]
    async fn an_exception_reply_is_the_device_refusing() {
        assert_eq!(reply("018302c0f1", 1, 1).await, Err(Error::Exception(2)));
    }

    #[tokio::test]
    async fn a_bad_crc_is_a_protocol_error() {
        let protocol = Err(Error::Protocol("crc mismatch"));
        assert_eq!(reply("0103020000b845", 1, 1).await, protocol);
        assert_eq!(reply("018302c0f2", 1, 1).await, protocol);
        assert_eq!(reply("0103020001b844", 1, 1).await, protocol, "a flipped data bit");
    }

    #[tokio::test]
    async fn a_reply_must_come_from_the_unit_asked_and_answer_the_read_asked() {
        let protocol = |why| Err(Error::Protocol(why));
        assert_eq!(reply("0103020000b844", 2, 1).await, protocol("unit id mismatch"));
        assert_eq!(reply("0103020000b844", 1, 2).await, protocol("byte count mismatch"));
        assert_eq!(reply("0104020000b930", 1, 1).await, protocol("unexpected function"));
    }

    #[tokio::test]
    async fn a_frame_cut_short_is_an_i_o_error_at_each_cut_point() {
        let whole = "0103020000b844";
        for cut in (0..whole.len()).step_by(2) {
            let got = reply(&whole[..cut], 1, 1).await;
            assert!(matches!(got, Err(Error::Io(_))), "{cut}: {got:?}");
        }
        assert!(matches!(reply("018302c0", 1, 1).await, Err(Error::Io(_))), "a cut exception");
    }

    #[tokio::test]
    async fn bytes_before_a_reply_are_skipped() {
        let words = Ok(vec![0]);
        assert_eq!(reply("deadbe0103020000b844", 1, 1).await, words);
        assert_eq!(reply("ff0103020000b844", 1, 1).await, words, "one stray byte");
        assert_eq!(reply("0000ffee0103020000b844", 1, 1).await, words, "a stray unit-less run");
        assert_eq!(reply("deadbe018302c0f1", 1, 1).await, Err(Error::Exception(2)), "before an exception");
        assert_eq!(reply("deadbe00030200008584", 0, 1).await, words, "unit 0");
    }

    #[tokio::test]
    async fn a_reply_after_stray_bytes_is_still_checked() {
        let protocol = |why| Err(Error::Protocol(why));
        assert_eq!(reply("deadbe0103020000b845", 1, 1).await, protocol("crc mismatch"));
        assert_eq!(reply("deadbe0103020000b844", 2, 1).await, protocol("unit id mismatch"));
        assert_eq!(reply("deadbe0103020000b844", 1, 2).await, protocol("byte count mismatch"));
    }

    #[tokio::test]
    async fn stray_bytes_and_no_reply_end_in_an_i_o_error() {
        for wire in ["deadbe", "de", "deadbe0103", "deadbe010302"] {
            let got = reply(wire, 1, 1).await;
            assert!(matches!(got, Err(Error::Io(_))), "{wire}: {got:?}");
        }
    }
}
