//! The MQTT 3.1.1 packets the export and the EVCC ingest send, and the ones they read. Every packet is `QoS` 0:
//! nothing here acknowledges a publish.

use std::io;

use tokio::io::{AsyncRead, AsyncReadExt};

pub use super::bridge::Publish;

pub const PINGREQ: [u8; 2] = [0xC0, 0];
pub const DISCONNECT: [u8; 2] = [0xE0, 0];
pub const CONNACK: u8 = 0x20;
pub const SUBACK: u8 = 0x90;
/// Longer packets are refused rather than buffered.
const MAX_READ: usize = 64 * 1024;

#[derive(Debug)]
pub struct Connect<'a> {
    pub client_id: &'a str,
    pub keep_alive_secs: u16,
    pub username: Option<&'a str>,
    pub password: Option<&'a str>,
    pub will: Option<&'a Publish>,
}

pub fn remaining_length(out: &mut Vec<u8>, mut length: usize) {
    loop {
        let byte = u8::try_from(length % 128).unwrap_or(0);
        length /= 128;
        if length == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn string(out: &mut Vec<u8>, text: &[u8]) {
    out.extend_from_slice(&u16::try_from(text.len()).unwrap_or(u16::MAX).to_be_bytes());
    out.extend_from_slice(text);
}

fn packet(first: u8, body: &[u8]) -> Vec<u8> {
    let mut out = vec![first];
    remaining_length(&mut out, body.len());
    out.extend_from_slice(body);
    out
}

/// A clean session, with a `QoS` 0 will when given one.
pub fn connect(c: &Connect) -> Vec<u8> {
    let mut flags = 0b0000_0010;
    if let Some(will) = c.will {
        flags |= 0b0000_0100 | if will.retain { 0b0010_0000 } else { 0 };
    }
    let mut body = Vec::new();
    string(&mut body, b"MQTT");
    body.push(4);
    let flags_at = body.len();
    body.push(0);
    body.extend_from_slice(&c.keep_alive_secs.to_be_bytes());
    string(&mut body, c.client_id.as_bytes());
    if let Some(will) = c.will {
        string(&mut body, will.topic.as_bytes());
        string(&mut body, will.payload.as_bytes());
    }
    if let Some(username) = c.username {
        flags |= 0b1000_0000;
        string(&mut body, username.as_bytes());
    }
    if let Some(password) = c.password {
        flags |= 0b0100_0000;
        string(&mut body, password.as_bytes());
    }
    body[flags_at] = flags;
    packet(0x10, &body)
}

/// `QoS` 0: no packet id, nothing acknowledges it.
pub fn publish(p: &Publish) -> Vec<u8> {
    let mut body = Vec::with_capacity(2 + p.topic.len() + p.payload.len());
    string(&mut body, p.topic.as_bytes());
    body.extend_from_slice(p.payload.as_bytes());
    packet(0x30 | u8::from(p.retain), &body)
}

/// Every filter at `QoS` 0.
pub fn subscribe(packet_id: u16, filters: &[String]) -> Vec<u8> {
    let mut body = packet_id.to_be_bytes().to_vec();
    for filter in filters {
        string(&mut body, filter.as_bytes());
        body.push(0);
    }
    packet(0x82, &body)
}

/// A SUBACK body names a refused filter with 0x80.
pub fn suback_refused(body: &[u8]) -> bool {
    body.iter().skip(2).any(|code| *code == 0x80)
}

/// A PUBLISH the broker sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inbound {
    pub topic: String,
    pub payload: Vec<u8>,
}

/// The PUBLISH whose first byte is `first`; `None` when cut short or the topic is not UTF-8.
pub fn inbound(first: u8, body: &[u8]) -> Option<Inbound> {
    let length = usize::from(u16::from_be_bytes([*body.first()?, *body.get(1)?]));
    let topic = std::str::from_utf8(body.get(2..2 + length)?).ok()?;
    let packet_id = if first & 0b0110 == 0 { 0 } else { 2 };
    let payload = body.get(2 + length + packet_id..)?;
    Some(Inbound { topic: topic.to_owned(), payload: payload.to_vec() })
}

fn refused(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_owned())
}

/// One packet: its first byte and its body.
pub async fn read<R: AsyncRead + Unpin>(input: &mut R) -> io::Result<(u8, Vec<u8>)> {
    let first = input.read_u8().await?;
    let mut length = 0usize;
    for shift in [0, 7, 14, 21] {
        let byte = input.read_u8().await?;
        length |= usize::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            if length > MAX_READ {
                return Err(refused("packet over 64 KiB"));
            }
            let mut body = vec![0; length];
            input.read_exact(&mut body).await?;
            return Ok((first, body));
        }
    }
    Err(refused("remaining length over four bytes"))
}

/// The CONNACK return code; 0 is accepted.
pub async fn read_connack<R: AsyncRead + Unpin>(input: &mut R) -> io::Result<u8> {
    match read(input).await? {
        (CONNACK, body) if body.len() == 2 => Ok(body[1]),
        _ => Err(refused("expected CONNACK")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn will() -> Publish {
        Publish { topic: "a/status".into(), payload: "offline".into(), retain: true }
    }

    #[test]
    fn connect_carries_the_retained_will_and_the_credentials() {
        let packet = connect(&Connect {
            client_id: "c",
            keep_alive_secs: 60,
            username: Some("u"),
            password: Some("pw"),
            will: Some(&will()),
        });
        #[rustfmt::skip]
        let want: Vec<u8> = [
            &[0x10, 39][..],
            &[0, 4], b"MQTT", &[4],
            // username, password, will retain, will (QoS 0), clean session
            &[0b1110_0110], &[0, 60],
            &[0, 1], b"c",
            &[0, 8], b"a/status", &[0, 7], b"offline",
            &[0, 1], b"u", &[0, 2], b"pw",
        ].concat();
        assert_eq!(packet, want);
    }

    #[test]
    fn connect_without_credentials_sets_neither_flag() {
        let packet = connect(&Connect {
            client_id: "c",
            keep_alive_secs: 5,
            username: None,
            password: None,
            will: Some(&will()),
        });
        assert_eq!(packet[9], 0b0010_0110);
        assert_eq!(&packet[10..12], &[0, 5]);
        assert_eq!(packet.len(), 2 + usize::from(packet[1]));
    }

    #[test]
    fn publish_is_qos_0_with_the_retain_bit_and_no_packet_id() {
        let retained = publish(&Publish { topic: "t/x".into(), payload: "42".into(), retain: true });
        assert_eq!(retained, [&[0x31, 7, 0, 3][..], b"t/x", b"42"].concat());
        let plain = publish(&Publish { topic: "t".into(), payload: String::new(), retain: false });
        assert_eq!(plain, [0x30, 3, 0, 1, b't']);
    }

    #[test]
    fn connect_without_a_will_sets_only_clean_session() {
        let packet = connect(&Connect {
            client_id: "c",
            keep_alive_secs: 60,
            username: None,
            password: None,
            will: None,
        });
        assert_eq!(packet, [&[0x10, 13, 0, 4][..], b"MQTT", &[4, 0b0000_0010, 0, 60, 0, 1], b"c"].concat());
    }

    #[test]
    fn subscribe_asks_qos_0_for_each_filter_under_one_packet_id() {
        let packet = subscribe(1, &["a/#".to_owned(), "b".to_owned()]);
        assert_eq!(packet, [&[0x82, 12, 0, 1, 0, 3][..], b"a/#", &[0, 0, 1], b"b", &[0]].concat());
    }

    #[test]
    fn an_inbound_publish_reads_its_topic_and_payload_past_a_packet_id_when_qos_is_above_0() {
        let qos0 = [&[0, 3][..], b"t/x", b"42"].concat();
        assert_eq!(inbound(0x31, &qos0), Some(Inbound { topic: "t/x".into(), payload: b"42".to_vec() }));
        let qos1 = [&[0, 1][..], b"t", &[0, 9], b"on"].concat();
        assert_eq!(inbound(0x32, &qos1), Some(Inbound { topic: "t".into(), payload: b"on".to_vec() }));
        assert_eq!(inbound(0x30, &[0, 1, b't']), Some(Inbound { topic: "t".into(), payload: Vec::new() }));
        for cut in [&[0, 4, b't'][..], &[0], &[0, 1, 0xFF], &[0, 1, b't', 0]] {
            let first = if cut.len() == 4 { 0x32 } else { 0x30 };
            assert_eq!(inbound(first, cut), None, "{cut:?}");
        }
    }

    #[test]
    fn a_suback_refuses_when_any_return_code_is_0x80() {
        assert!(!suback_refused(&[0, 1, 0, 1, 2]));
        assert!(suback_refused(&[0, 1, 0, 0x80]));
    }

    #[test]
    fn remaining_length_takes_a_second_byte_from_128_and_a_third_from_16384() {
        let cases: [(usize, &[u8]); 6] = [
            (0, &[0]),
            (127, &[0x7F]),
            (128, &[0x80, 0x01]),
            (16_383, &[0xFF, 0x7F]),
            (16_384, &[0x80, 0x80, 0x01]),
            (2_097_152, &[0x80, 0x80, 0x80, 0x01]),
        ];
        for (length, want) in cases {
            let mut got = Vec::new();
            remaining_length(&mut got, length);
            assert_eq!(got, want, "{length}");
        }
    }

    #[tokio::test]
    async fn a_packet_reads_back_its_type_and_body_across_a_long_length() {
        let body = "x".repeat(200);
        let wire = publish(&Publish { topic: "t".into(), payload: body.clone(), retain: false });
        let (kind, read) = read(&mut wire.as_slice()).await.expect("packet");
        assert_eq!(kind, 0x30);
        assert_eq!(read.len(), 3 + body.len());
        assert_eq!(read_connack(&mut [0x20, 2, 0, 0].as_slice()).await.expect("connack"), 0);
        assert_eq!(read_connack(&mut [0x20, 2, 0, 5].as_slice()).await.expect("connack"), 5);
    }

    #[tokio::test]
    async fn a_packet_of_64_kib_is_read_and_one_byte_more_is_refused() {
        let wire = |length: usize| [&[0x30, 0x80, 0x80, 0x04][..], &vec![0; length]].concat();
        let at_cap = 64 * 1024;
        assert_eq!(read(&mut wire(at_cap).as_slice()).await.expect("at the cap").1.len(), at_cap);
        let mut over = wire(at_cap + 1);
        over[1] = 0x81;
        assert!(read(&mut over.as_slice()).await.is_err());
    }

    #[tokio::test]
    async fn a_reply_that_is_not_a_connack_or_is_oversized_or_cut_short_is_an_error() {
        assert!(read_connack(&mut [0xD0, 0].as_slice()).await.is_err());
        assert!(read(&mut [0x30, 0xFF, 0xFF, 0xFF, 0x7F].as_slice()).await.is_err(), "over the cap");
        assert!(read(&mut [0x30, 0xFF, 0xFF, 0xFF, 0xFF].as_slice()).await.is_err(), "a fifth length byte");
        assert!(read(&mut [0x30, 5, 1].as_slice()).await.is_err());
        assert!(read(&mut [].as_slice()).await.is_err());
    }
}
