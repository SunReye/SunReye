//! Modbus RTU framing over TCP, for serial gateways in transparent mode: each frame is the unit id,
//! the PDU and a CRC, with no header and no transaction id.

use std::ops::Range;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::{Error, mbap};

/// Unit id, function, and the byte that decides how long the rest of a reply is.
const HEAD: usize = 3;
const CRC: usize = 2;
/// The largest frame: unit id, a 253-byte PDU and the CRC.
const MAX_FRAME: usize = 1 + mbap::MAX_PDU + CRC;
const EXCEPTION_FLAG: u8 = 0x80;

/// The length and function code of the request frame that `head` starts. Only a read's length is
/// known: the capture wire refuses every other function before it needs one.
pub fn request_frame(head: &[u8]) -> Option<(usize, u8)> {
    let function = *head.get(1)?;
    let length = if function == mbap::FC_READ_HOLDING {
        8
    } else {
        0
    };
    Some((length, function))
}

/// Sends `adu` (unit id and PDU) with its CRC and returns where the reply's PDU sits in `reply`.
/// RTU carries no transaction id: a late reply from another unit is caught by its unit id.
pub async fn exchange<W: AsyncRead + AsyncWrite + Unpin + ?Sized>(
    wire: &mut W,
    adu: &[u8],
    reply: &mut [u8],
) -> Result<Range<usize>, Error> {
    let unit = *adu.first().ok_or(Error::Protocol("empty request"))?;
    let mut frame = [0; MAX_FRAME];
    let end = adu.len() + CRC;
    let request = frame
        .get_mut(..end)
        .ok_or(Error::Protocol("count out of range"))?;
    let (body, crc) = request.split_at_mut(adu.len());
    body.copy_from_slice(adu);
    crc.copy_from_slice(&crc16(adu).to_le_bytes());
    // One write: the capture wire judges a request by its first bytes.
    wire.write_all(request).await?;

    let mut head = [0; HEAD];
    wire.read_exact(&mut head).await?;
    let [_, function, third] = head;
    let total = reply_len(function, third)?;
    let frame = reply
        .get_mut(..total)
        .ok_or(Error::Protocol("bad length"))?;
    let (front, rest) = frame.split_at_mut(HEAD);
    front.copy_from_slice(&head);
    wire.read_exact(rest).await?;
    let Some((body, crc)) = frame.split_last_chunk::<CRC>() else {
        return Err(Error::Protocol("bad length"));
    };
    if crc16(body).to_le_bytes() != *crc {
        return Err(Error::Protocol("bad CRC"));
    }
    if body.first() != Some(&unit) {
        return Err(Error::Protocol("unit id mismatch"));
    }
    Ok(1..total - CRC)
}

/// A reply frame's length from its function and the byte after it.
fn reply_len(function: u8, third: u8) -> Result<usize, Error> {
    match function {
        f if f & EXCEPTION_FLAG != 0 => Ok(HEAD + CRC),
        mbap::FC_READ_HOLDING => Ok(HEAD + usize::from(third) + CRC),
        // Start and count echoed.
        mbap::FC_WRITE => Ok(2 + 4 + CRC),
        _ => Err(Error::Protocol("unexpected function")),
    }
}

/// Modbus RTU CRC16: reflected, polynomial 0xA001, seed 0xFFFF.
pub fn crc16(bytes: &[u8]) -> u16 {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// RTU frames v4 sent and received through a Solarman stick, CRC included, from v4's
    /// `fixtures/oracle/transport.ndjson` (the `solarman-v5` cases, which this crate's
    /// `fixtures/transport.ndjson` carries).
    #[test]
    fn the_crc_of_a_recorded_frame_is_its_last_two_bytes_low_byte_first() {
        let frames: [&[u8]; 6] = [
            &[0x01, 0x03, 0x00, 0x03, 0x00, 0x06, 0x35, 0xc8],
            &[0x01, 0x03, 0x01, 0xf4, 0x00, 0x05, 0xc5, 0xc7],
            &[0x00, 0x03, 0x01, 0xf4, 0x00, 0x05, 0xc4, 0x16],
            &[0x01, 0x83, 0x02, 0xc0, 0xf1],
            &[0x01, 0x10, 0x01, 0xf8, 0x00, 0x01, 0x81, 0xc4],
            &[
                0x01, 0x03, 0x0a, 0x09, 0x01, 0xfc, 0x18, 0x12, 0x34, 0x00, 0x01, 0x00, 0x95, 0x4d,
                0x00,
            ],
        ];
        for frame in frames {
            let (adu, crc) = frame.split_last_chunk::<2>().unwrap();
            assert_eq!(crc16(adu).to_le_bytes(), *crc, "{frame:02x?}");
        }
    }
}
