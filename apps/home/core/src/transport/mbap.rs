//! Modbus TCP framing: an MBAP header in front of the PDU.

use super::Error;

/// Transaction (2), protocol (2), length (2), unit (1).
pub const HEADER_LEN: usize = 7;
/// Where the unit id starts: from it on, a request is the RTU frame without its CRC.
pub const UNIT_OFFSET: usize = 6;
/// A function byte plus at most 252 data bytes.
pub const MAX_PDU: usize = 253;
/// A whole frame: header and PDU.
pub const MAX_FRAME: usize = HEADER_LEN + MAX_PDU;
pub const FC_READ_HOLDING: u8 = 3;
/// Every write is function 16, one word included: some devices refuse function 6.
pub const FC_WRITE: u8 = 16;
const EXCEPTION_FLAG: u8 = 0x80;
/// Most words one read may ask for.
const MAX_READ: usize = 125;
const MAX_WRITE: u8 = 123;

/// The length and function code of the request frame that `head` starts.
pub fn request_frame(head: &[u8]) -> Option<(usize, u8)> {
    let length = u16::from_be_bytes([*head.get(4)?, *head.get(5)?]);
    Some((UNIT_OFFSET + usize::from(length), *head.get(HEADER_LEN)?))
}

pub fn read_request(
    transaction: u16,
    unit: u8,
    start: u16,
    count: usize,
) -> Result<[u8; 12], Error> {
    if !(1..=MAX_READ).contains(&count) {
        return Err(Error::Protocol("count out of range"));
    }
    let [t0, t1] = transaction.to_be_bytes();
    let [s0, s1] = start.to_be_bytes();
    let [_, c] = u16::try_from(count)
        .map_err(|_| Error::Protocol("count out of range"))?
        .to_be_bytes();
    Ok([t0, t1, 0, 0, 0, 6, unit, FC_READ_HOLDING, s0, s1, 0, c])
}

/// Writes the request into `frame` and returns the part it fills.
pub fn write_request<'a>(
    frame: &'a mut [u8; MAX_FRAME],
    transaction: u16,
    unit: u8,
    start: u16,
    words: &[u16],
) -> Result<&'a [u8], Error> {
    let count = u8::try_from(words.len())
        .ok()
        .filter(|count| (1..=MAX_WRITE).contains(count))
        .ok_or(Error::Protocol("count out of range"))?;
    let [t0, t1] = transaction.to_be_bytes();
    let [s0, s1] = start.to_be_bytes();
    let bytes = count * 2;
    let head = [
        t0,
        t1,
        0,
        0,
        0,
        bytes + 7,
        unit,
        FC_WRITE,
        s0,
        s1,
        0,
        count,
        bytes,
    ];
    let (front, data) = frame.split_at_mut(head.len());
    front.copy_from_slice(&head);
    for (pair, word) in data.as_chunks_mut::<2>().0.iter_mut().zip(words) {
        *pair = word.to_be_bytes();
    }
    frame
        .get(..head.len() + usize::from(bytes))
        .ok_or(Error::Protocol("count out of range"))
}

/// Checks a reply header against its request; returns the length of the PDU that follows.
pub fn check_header(header: [u8; HEADER_LEN], transaction: u16, unit: u8) -> Result<usize, Error> {
    let [t0, t1, p0, p1, l0, l1, u] = header;
    if u16::from_be_bytes([t0, t1]) != transaction {
        return Err(Error::Protocol("transaction id mismatch"));
    }
    if [p0, p1] != [0, 0] {
        return Err(Error::Protocol("not a Modbus TCP frame"));
    }
    if u != unit {
        return Err(Error::Protocol("unit id mismatch"));
    }
    // The length counts the unit byte.
    match usize::from(u16::from_be_bytes([l0, l1])) {
        length @ 2..=254 => Ok(length - 1),
        _ => Err(Error::Protocol("bad length")),
    }
}

/// The data of a reply to `function`, or the exception it carries.
const fn data(pdu: &[u8], function: u8) -> Result<&[u8], Error> {
    match pdu.split_first() {
        Some((&f, [code])) if f == function | EXCEPTION_FLAG => Err(Error::Exception(*code)),
        Some((&f, _)) if f == function | EXCEPTION_FLAG => Err(Error::Protocol("short exception")),
        Some((&f, data)) if f == function => Ok(data),
        Some(_) => Err(Error::Protocol("unexpected function")),
        None => Err(Error::Protocol("empty reply")),
    }
}

pub fn parse_read(pdu: &[u8], words: &mut [u16]) -> Result<(), Error> {
    let Some((&bytes, rest)) = data(pdu, FC_READ_HOLDING)?.split_first() else {
        return Err(Error::Protocol("byte count mismatch"));
    };
    match rest.as_chunks::<2>() {
        (pairs, []) if usize::from(bytes) == rest.len() && pairs.len() == words.len() => {
            for (word, pair) in words.iter_mut().zip(pairs) {
                *word = u16::from_be_bytes(*pair);
            }
            Ok(())
        }
        _ => Err(Error::Protocol("byte count mismatch")),
    }
}

/// A write's reply echoes its start and count.
pub fn parse_write(pdu: &[u8], start: u16, count: usize) -> Result<(), Error> {
    let [s0, s1] = start.to_be_bytes();
    let [_, c] = u16::try_from(count)
        .map_err(|_| Error::Protocol("count out of range"))?
        .to_be_bytes();
    if data(pdu, FC_WRITE)? == [s0, s1, 0, c] {
        Ok(())
    } else {
        Err(Error::Protocol("write echo mismatch"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_header_must_echo_the_transaction_speak_modbus_name_the_unit_and_fit_a_pdu() {
        let protocol = |why| Err(Error::Protocol(why));
        let cases = [
            ([0, 5, 0, 0, 0, 5, 1], Ok(4)),
            ([0, 6, 0, 0, 0, 5, 1], protocol("transaction id mismatch")),
            ([0, 5, 0, 1, 0, 5, 1], protocol("not a Modbus TCP frame")),
            ([0, 5, 0, 0, 0, 5, 2], protocol("unit id mismatch")),
            ([0, 5, 0, 0, 0, 1, 1], protocol("bad length")),
            ([0, 5, 0, 0, 1, 0, 1], protocol("bad length")),
            ([0, 5, 0, 0, 0, 255, 1], protocol("bad length")),
            ([0, 5, 0, 0, 0, 254, 1], Ok(253)),
            ([0, 5, 0, 0, 0, 2, 1], Ok(1)),
        ];
        for (header, want) in cases {
            assert_eq!(check_header(header, 5, 1), want, "{header:?}");
        }
    }

    #[test]
    fn a_read_pdu_yields_its_words_or_the_reason_it_cannot() {
        let protocol = |why| Err(Error::Protocol(why));
        let cases: [(&[u8], usize, _); 8] = [
            (&[3, 4, 0x09, 0x01, 0xfc, 0x18], 2, Ok(())),
            (&[0x83, 2], 1, Err(Error::Exception(2))),
            (&[0x83], 1, protocol("short exception")),
            (&[0x83, 2, 0], 1, protocol("short exception")),
            (&[], 1, protocol("empty reply")),
            (&[4, 2, 0, 1], 1, protocol("unexpected function")),
            (&[3, 4, 0, 1], 2, protocol("byte count mismatch")),
            (&[3, 2, 0, 1, 0, 2], 1, protocol("byte count mismatch")),
        ];
        for (pdu, count, want) in cases {
            let mut words = vec![0; count];
            assert_eq!(parse_read(pdu, &mut words), want, "{pdu:?}");
        }
        let mut words = [0; 2];
        parse_read(&[3, 4, 0x09, 0x01, 0xfc, 0x18], &mut words).unwrap();
        assert_eq!(words, [0x0901, 0xfc18]);
    }

    #[test]
    fn a_write_reply_must_echo_start_and_count() {
        assert_eq!(parse_write(&[16, 1, 0xf8, 0, 1], 504, 1), Ok(()));
        assert_eq!(
            parse_write(&[16, 1, 0xf8, 0, 2], 504, 1),
            Err(Error::Protocol("write echo mismatch"))
        );
        assert_eq!(parse_write(&[0x90, 3], 504, 1), Err(Error::Exception(3)));
    }
}
