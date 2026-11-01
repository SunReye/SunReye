//! Modbus client over a TCP stream, read path only: the one request either framing can encode is
//! function 3, read holding registers. 4.0 never writes (ADR 0005), so there is no write function to call.

mod rtu;

use std::str::FromStr;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const FC_READ_HOLDING: u8 = 3;
const EXCEPTION_FLAG: u8 = 0x80;
/// Most words one read may ask for; the PDU limit.
const MAX_WORDS: u16 = 125;
/// Header bytes: transaction (2), protocol (2), length (2), unit (1).
const HEADER_LEN: usize = 7;

/// The framing a connection speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// Modbus TCP: an MBAP header in front of the PDU.
    Tcp,
    /// Modbus RTU over TCP: the RTU frame, unit id in front and CRC behind, on a TCP stream.
    RtuOverTcp,
}

impl Transport {
    /// The value stored in `connection.transport`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tcp => "tcp",
            Self::RtuOverTcp => "rtu_over_tcp",
        }
    }
}

impl FromStr for Transport {
    type Err = UnknownTransport;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        [Self::Tcp, Self::RtuOverTcp]
            .into_iter()
            .find(|transport| transport.as_str() == name)
            .ok_or_else(|| UnknownTransport(name.to_owned()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown transport {0:?}")]
pub struct UnknownTransport(String);

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
    transport: Transport,
    stream: TcpStream,
    transaction: u16,
    timeout: Duration,
}

impl Client {
    /// `timeout` bounds the connect and every later read.
    pub async fn connect(
        transport: Transport,
        host: &str,
        port: u16,
        timeout: Duration,
    ) -> Result<Self, Error> {
        let stream = tokio::time::timeout(timeout, TcpStream::connect((host, port)))
            .await
            .map_err(|_| Error::Timeout)??;
        stream.set_nodelay(true)?;
        Ok(Self { transport, stream, transaction: 0, timeout })
    }

    /// Reads `count` holding registers from `start` of `unit`. After any error but
    /// [`Error::Exception`] the stream may hold a half-read reply: drop the client.
    pub async fn read_holding(&mut self, unit: u8, start: u16, count: u16) -> Result<Vec<u16>, Error> {
        if !(1..=MAX_WORDS).contains(&count) {
            return Err(Error::Protocol("count out of range"));
        }
        let timeout = self.timeout;
        let exchange = async {
            match self.transport {
                Transport::Tcp => self.exchange_tcp(unit, start, count).await,
                Transport::RtuOverTcp => self.exchange_rtu(unit, start, count).await,
            }
        };
        tokio::time::timeout(timeout, exchange).await.map_err(|_| Error::Timeout)?
    }

    async fn exchange_rtu(&mut self, unit: u8, start: u16, count: u16) -> Result<Vec<u16>, Error> {
        self.stream.write_all(&rtu::read_request(unit, start, count)).await?;
        rtu::read_reply(&mut self.stream, unit, count).await
    }

    async fn exchange_tcp(&mut self, unit: u8, start: u16, count: u16) -> Result<Vec<u16>, Error> {
        self.transaction = self.transaction.wrapping_add(1);
        let transaction = self.transaction;
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

pub(crate) fn parse_pdu(pdu: &[u8], count: u16) -> Result<Vec<u16>, Error> {
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
    use sunreye_sim::{Framing, Registers, Simulator};
    use tokio::net::TcpListener;

    use super::*;

    async fn rtu_client(registers: Registers, units: &[u8]) -> (Simulator, Client) {
        let sim = Simulator::start_with(Framing::RtuOverTcp, registers, units).await.expect("sim");
        let client =
            Client::connect(Transport::RtuOverTcp, "127.0.0.1", sim.addr.port(), Duration::from_millis(300))
                .await
                .expect("connect");
        (sim, client)
    }

    #[test]
    fn a_transport_is_stored_as_its_name_and_only_its_name_is_read_back() {
        for transport in [Transport::Tcp, Transport::RtuOverTcp] {
            assert_eq!(transport.as_str().parse(), Ok(transport));
        }
        assert_eq!(Transport::Tcp.as_str(), "tcp");
        assert_eq!(Transport::RtuOverTcp.as_str(), "rtu_over_tcp");
        for bad in ["", "TCP", "rtu-over-tcp", "solarman", " tcp"] {
            assert_eq!(bad.parse::<Transport>(), Err(UnknownTransport(bad.into())), "{bad:?}");
        }
    }

    #[tokio::test]
    async fn an_rtu_read_returns_the_words_and_survives_a_refusal() {
        let (sim, mut client) = rtu_client(Registers::from_runs([(10, vec![1, 2, 3])]), &[1]).await;
        assert_eq!(client.read_holding(1, 10, 3).await, Ok(vec![1, 2, 3]));
        assert_eq!(client.read_holding(1, 11, 1).await, Ok(vec![2]));
        assert_eq!(client.read_holding(1, 99, 1).await, Err(Error::Exception(2)), "the stream stays usable");
        assert_eq!(client.read_holding(1, 12, 1).await, Ok(vec![3]));
        assert!(sim.requests().iter().all(|r| r.function == 3), "reads only");
    }

    #[tokio::test]
    async fn an_rtu_count_outside_one_to_125_is_refused_before_anything_is_sent() {
        let (sim, mut client) = rtu_client(Registers::default(), &[1]).await;
        for count in [0, 126] {
            assert_eq!(client.read_holding(1, 0, count).await, Err(Error::Protocol("count out of range")));
        }
        assert_eq!(sim.requests(), []);
    }

    #[tokio::test]
    async fn an_rtu_unit_that_does_not_answer_times_out() {
        let (_sim, mut client) = rtu_client(Registers::from_runs([(1, vec![1])]), &[1]).await;
        assert_eq!(client.read_holding(0, 1, 1).await, Err(Error::Timeout));
    }

    #[tokio::test]
    async fn an_rtu_reply_that_stops_halfway_times_out_and_one_that_ends_halfway_is_an_i_o_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let device = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("accept");
            first.write_all(&[1, 3, 2, 0]).await.expect("half a reply");
            let (mut second, _) = listener.accept().await.expect("accept");
            second.write_all(&[1, 3, 2, 0]).await.expect("half a reply");
            drop(second);
            tokio::time::sleep(Duration::from_millis(600)).await;
            drop(first);
        });
        let timeout = Duration::from_millis(200);
        let mut silent =
            Client::connect(Transport::RtuOverTcp, "127.0.0.1", port, timeout).await.expect("connect");
        assert_eq!(silent.read_holding(1, 0, 1).await, Err(Error::Timeout));
        let mut closed =
            Client::connect(Transport::RtuOverTcp, "127.0.0.1", port, timeout).await.expect("connect");
        assert!(matches!(closed.read_holding(1, 0, 1).await, Err(Error::Io(_))));
        device.await.expect("device");
    }

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
            Client::connect(Transport::Tcp, "127.0.0.1", sim.addr.port(), Duration::from_secs(5))
                .await
                .expect("connect");
        assert_eq!(client.read_holding(1, 10, 3).await, Ok(vec![1, 2, 3]));
        assert_eq!(client.read_holding(1, 11, 1).await, Ok(vec![2]));
        assert_eq!(client.read_holding(1, 99, 1).await, Err(Error::Exception(2)), "the stream stays usable");
        assert_eq!(client.read_holding(1, 12, 1).await, Ok(vec![3]));
    }

    #[tokio::test]
    async fn a_count_outside_one_to_125_is_refused_before_anything_is_sent() {
        let sim = Simulator::start(Registers::default(), &[1]).await.expect("sim");
        let mut client =
            Client::connect(Transport::Tcp, "127.0.0.1", sim.addr.port(), Duration::from_secs(5))
                .await
                .expect("connect");
        for count in [0, 126] {
            assert_eq!(client.read_holding(1, 0, count).await, Err(Error::Protocol("count out of range")));
        }
        assert_eq!(sim.requests(), []);
    }
}
