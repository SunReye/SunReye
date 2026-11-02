//! Modbus TCP client, read path only: the one request it can encode is function 3, read holding
//! registers. 4.0 never writes (ADR 0005), so there is no write function to call.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const FC_READ_HOLDING: u8 = 3;
const EXCEPTION_FLAG: u8 = 0x80;
/// Most words one read may ask for; the PDU limit.
const MAX_WORDS: u16 = 125;
/// Header bytes: transaction (2), protocol (2), length (2), unit (1).
const HEADER_LEN: usize = 7;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("i/o error: {0}")]
    Io(String),
    #[error("timed out")]
    Timeout,
    /// The device answered with a Modbus exception code.
    #[error("device refused the read: exception {0}")]
    Exception(u8),
    #[error("protocol error: {0}")]
    Protocol(&'static str),
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug)]
pub struct Client {
    stream: TcpStream,
    transaction: u16,
    timeout: Duration,
}

impl Client {
    /// `timeout` bounds the connect and every later read.
    pub async fn connect(host: &str, port: u16, timeout: Duration) -> Result<Self, Error> {
        let stream = tokio::time::timeout(timeout, TcpStream::connect((host, port)))
            .await
            .map_err(|_| Error::Timeout)??;
        stream.set_nodelay(true)?;
        Ok(Self { stream, transaction: 0, timeout })
    }

    /// Reads `count` holding registers from `start` of `unit`. After any error but
    /// [`Error::Exception`] the stream may hold a half-read reply: drop the client.
    pub async fn read_holding(&mut self, unit: u8, start: u16, count: u16) -> Result<Vec<u16>, Error> {
        if !(1..=MAX_WORDS).contains(&count) {
            return Err(Error::Protocol("count out of range"));
        }
        self.transaction = self.transaction.wrapping_add(1);
        let transaction = self.transaction;
        let timeout = self.timeout;
        let exchange = self.exchange(transaction, unit, start, count);
        tokio::time::timeout(timeout, exchange).await.map_err(|_| Error::Timeout)?
    }

    async fn exchange(
        &mut self,
        transaction: u16,
        unit: u8,
        start: u16,
        count: u16,
    ) -> Result<Vec<u16>, Error> {
        self.stream.write_all(&read_request(transaction, unit, start, count)).await?;
        let mut header = [0_u8; HEADER_LEN];
        self.stream.read_exact(&mut header).await?;
        let mut pdu = vec![0_u8; check_header(header, transaction, unit)?];
        self.stream.read_exact(&mut pdu).await?;
        parse_pdu(&pdu, count)
    }
}

fn read_request(transaction: u16, unit: u8, start: u16, count: u16) -> [u8; 12] {
    let [t0, t1] = transaction.to_be_bytes();
    let [s0, s1] = start.to_be_bytes();
    let [c0, c1] = count.to_be_bytes();
    [t0, t1, 0, 0, 0, 6, unit, FC_READ_HOLDING, s0, s1, c0, c1]
}

/// Checks the header against the request and returns the length of the PDU that follows.
fn check_header(header: [u8; HEADER_LEN], transaction: u16, unit: u8) -> Result<usize, Error> {
    if u16::from_be_bytes([header[0], header[1]]) != transaction {
        return Err(Error::Protocol("transaction id mismatch"));
    }
    if header[2..4] != [0, 0] {
        return Err(Error::Protocol("not a Modbus TCP frame"));
    }
    if header[6] != unit {
        return Err(Error::Protocol("unit id mismatch"));
    }
    // The length counts the unit byte; a PDU is a function byte plus data, at most 253 bytes.
    match usize::from(u16::from_be_bytes([header[4], header[5]])) {
        length @ 2..=254 => Ok(length - 1),
        _ => Err(Error::Protocol("bad length")),
    }
}

fn parse_pdu(pdu: &[u8], count: u16) -> Result<Vec<u16>, Error> {
    let Some((&function, data)) = pdu.split_first() else {
        return Err(Error::Protocol("empty reply"));
    };
    if function == FC_READ_HOLDING | EXCEPTION_FLAG {
        return match data {
            [code] => Err(Error::Exception(*code)),
            _ => Err(Error::Protocol("short exception")),
        };
    }
    if function != FC_READ_HOLDING {
        return Err(Error::Protocol("unexpected function"));
    }
    let words = usize::from(count);
    match data.split_first() {
        Some((&bytes, rest)) if usize::from(bytes) == words * 2 && rest.len() == words * 2 => {
            Ok(rest.as_chunks::<2>().0.iter().map(|pair| u16::from_be_bytes(*pair)).collect())
        }
        _ => Err(Error::Protocol("byte count mismatch")),
    }
}

#[cfg(test)]
mod tests {
    use sunreye_sim::{Registers, Simulator};

    use super::*;

    #[test]
    fn a_read_request_is_the_recorded_frame() {
        assert_eq!(read_request(1, 1, 500, 5), [0, 1, 0, 0, 0, 6, 1, 3, 1, 0xf4, 0, 5]);
        assert_eq!(read_request(0x0102, 0, 0xfffe, 120), [1, 2, 0, 0, 0, 6, 0, 3, 0xff, 0xfe, 0, 120]);
    }

    #[test]
    fn the_only_function_the_encoder_can_send_is_a_read() {
        for (unit, start, count) in [(0, 0, 1), (1, 500, 5), (255, 65535, 125)] {
            assert_eq!(read_request(7, unit, start, count)[7], 3);
        }
    }

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
    fn a_pdu_yields_its_words_or_the_reason_it_cannot() {
        let protocol = |why| Err(Error::Protocol(why));
        let cases: [(&[u8], u16, _); 9] = [
            (&[3, 4, 0x09, 0x01, 0xfc, 0x18], 2, Ok(vec![0x0901, 0xfc18])),
            (&[0x83, 2], 1, Err(Error::Exception(2))),
            (&[0x83], 1, protocol("short exception")),
            (&[0x83, 2, 0], 1, protocol("short exception")),
            (&[], 1, protocol("empty reply")),
            (&[4, 2, 0, 1], 1, protocol("unexpected function")),
            (&[3, 4, 0, 1], 2, protocol("byte count mismatch")),
            (&[3, 2, 0, 1, 0, 2], 1, protocol("byte count mismatch")),
            (&[3, 0], 0, Ok(vec![])),
        ];
        for (pdu, count, want) in cases {
            assert_eq!(parse_pdu(pdu, count), want, "{pdu:?}");
        }
    }

    #[tokio::test]
    async fn a_read_returns_the_words_and_numbers_transactions_from_one() {
        let sim = Simulator::start(Registers::from_runs([(10, vec![1, 2, 3])]), &[1]).await.expect("sim");
        let mut client =
            Client::connect("127.0.0.1", sim.addr.port(), Duration::from_secs(5)).await.expect("connect");
        assert_eq!(client.read_holding(1, 10, 3).await, Ok(vec![1, 2, 3]));
        assert_eq!(client.read_holding(1, 11, 1).await, Ok(vec![2]));
        assert_eq!(client.read_holding(1, 99, 1).await, Err(Error::Exception(2)), "the stream stays usable");
        assert_eq!(client.read_holding(1, 12, 1).await, Ok(vec![3]));
    }

    #[tokio::test]
    async fn a_count_outside_one_to_125_is_refused_before_anything_is_sent() {
        let sim = Simulator::start(Registers::default(), &[1]).await.expect("sim");
        let mut client =
            Client::connect("127.0.0.1", sim.addr.port(), Duration::from_secs(5)).await.expect("connect");
        for count in [0, 126] {
            assert_eq!(client.read_holding(1, 0, count).await, Err(Error::Protocol("count out of range")));
        }
        assert_eq!(sim.requests(), []);
    }
}
