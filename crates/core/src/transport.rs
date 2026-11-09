//! Transports (ADR 6).
//!
//! A client speaks Modbus TCP or Solarman V5 framing to an endpoint, over a TCP socket or over
//! `sim`, which replays a capture. The framing is the same over both, so a capture checks the bytes a
//! real device sees.

#[cfg(test)]
pub mod fake;
mod mbap;
mod sim;
mod solarman;

use std::fmt;
use std::time::Duration;

use sunreye_profile::Framing;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

/// Where a client connects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    ModbusTcp {
        host: String,
        port: u16,
    },
    /// A Solarman logging stick, which wraps Modbus RTU.
    SolarmanV5 {
        host: String,
        port: u16,
    },
    /// Replays a capture in memory; nothing touches the network.
    Sim(Capture),
}

impl Endpoint {
    /// The transport of each variant, by name.
    pub const TRANSPORTS: &[&str] = &["modbus-tcp", "solarman-v5", "sim"];

    /// The wire framing, which sets the read plan's gap tolerance.
    #[must_use]
    pub const fn framing(&self) -> Framing {
        match self {
            Self::ModbusTcp { .. } => Framing::Tcp,
            Self::SolarmanV5 { .. } => Framing::SolarmanV5,
            Self::Sim(capture) => capture.framing,
        }
    }
}

/// A recorded wire exchange with one device endpoint, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capture {
    /// The framing of the recorded transport.
    pub framing: Framing,
    pub exchanges: Vec<Exchange>,
}

/// One step of a capture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exchange {
    /// Bytes the client sent.
    Request(Vec<u8>),
    /// Bytes the device sent back, one entry per TCP read.
    Reply(Vec<Vec<u8>>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Io(String),
    Timeout,
    /// The device answered with this Modbus exception code.
    Exception(u8),
    Protocol(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "i/o error: {error}"),
            Self::Timeout => f.write_str("timed out"),
            Self::Exception(code) => write!(f, "device refused the request: exception {code}"),
            Self::Protocol(why) => write!(f, "protocol error: {why}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

trait Wire: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> Wire for T {}

/// One connection to an endpoint. Requests are sequential: the endpoint task (ADR 6) owns the client.
pub struct Client {
    wire: Box<dyn Wire>,
    envelope: Envelope,
    transaction: u16,
    timeout: Duration,
    /// The reply being read; reused so a poll allocates nothing.
    reply: [u8; solarman::MAX_FRAME],
}

/// What wraps a request on the wire.
#[derive(Debug)]
enum Envelope {
    Mbap,
    Solarman(solarman::Logger),
}

impl fmt::Debug for Client {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Client")
            .field("transaction", &self.transaction)
            .finish_non_exhaustive()
    }
}

impl Client {
    /// `timeout` bounds the connect and every later request.
    ///
    /// # Errors
    ///
    /// [`Error::Timeout`] or [`Error::Io`] when the endpoint cannot be reached.
    pub async fn connect(endpoint: &Endpoint, timeout: Duration) -> Result<Self, Error> {
        let mut wire: Box<dyn Wire> = match endpoint {
            Endpoint::ModbusTcp { host, port } | Endpoint::SolarmanV5 { host, port } => {
                let stream =
                    tokio::time::timeout(timeout, TcpStream::connect((host.as_str(), *port)))
                        .await
                        .map_err(|_| Error::Timeout)??;
                stream.set_nodelay(true)?;
                Box::new(stream)
            }
            Endpoint::Sim(capture) => Box::new(sim::Sim::new(capture.clone())),
        };
        let mut reply = [0; solarman::MAX_FRAME];
        let envelope = match endpoint.framing() {
            Framing::Tcp => Envelope::Mbap,
            Framing::SolarmanV5 => {
                let discover = solarman::Logger::discover(wire.as_mut(), &mut reply);
                Envelope::Solarman(
                    tokio::time::timeout(timeout, discover)
                        .await
                        .map_err(|_| Error::Timeout)??,
                )
            }
            Framing::RtuOverTcp => return Err(Error::Protocol("RTU over TCP is not supported")),
        };
        Ok(Self {
            wire,
            envelope,
            transaction: 0,
            timeout,
            reply,
        })
    }

    /// Fills `words` with the holding registers of `unit` from `start` (function 3). After an error
    /// other than [`Error::Exception`] the wire may hold half a reply: reconnect.
    ///
    /// # Errors
    ///
    /// The device's exception, a timeout, an I/O error, or a reply that does not frame the request.
    pub async fn read_holding(
        &mut self,
        unit: u8,
        start: u16,
        words: &mut [u16],
    ) -> Result<(), Error> {
        let request =
            mbap::read_request(self.transaction.wrapping_add(1), unit, start, words.len())?;
        let pdu = self.exchange(&request, unit).await?;
        mbap::parse_read(pdu, words)
    }

    /// Writes `words` to the holding registers of `unit` from `start` (function 16).
    ///
    /// # Errors
    ///
    /// As [`Client::read_holding`]; a reply that does not echo the write is a protocol error.
    pub async fn write_registers(
        &mut self,
        unit: u8,
        start: u16,
        words: &[u16],
    ) -> Result<(), Error> {
        let mut frame = [0; mbap::MAX_FRAME];
        let next = self.transaction.wrapping_add(1);
        let request = mbap::write_request(&mut frame, next, unit, start, words)?;
        let pdu = self.exchange(request, unit).await?;
        mbap::parse_write(pdu, start, words.len())
    }

    /// Sends `request`, a Modbus TCP frame built with the next transaction id, and returns the PDU
    /// of its reply. Solarman framing rewraps the frame's unit id and PDU.
    async fn exchange(&mut self, request: &[u8], unit: u8) -> Result<&[u8], Error> {
        self.transaction = self.transaction.wrapping_add(1);
        let transaction = self.transaction;
        let wire = self.wire.as_mut();
        let reply = &mut self.reply;
        let exchange = async {
            match &mut self.envelope {
                Envelope::Mbap => mbap_exchange(wire, reply, request, transaction, unit).await,
                Envelope::Solarman(logger) => {
                    let adu = request
                        .get(mbap::UNIT_OFFSET..)
                        .ok_or(Error::Protocol("bad length"))?;
                    logger.exchange(wire, adu, reply).await
                }
            }
        };
        let pdu = tokio::time::timeout(self.timeout, exchange)
            .await
            .map_err(|_| Error::Timeout)??;
        self.reply.get(pdu).ok_or(Error::Protocol("bad length"))
    }
}

/// Returns where the reply's PDU sits in `reply`.
async fn mbap_exchange(
    wire: &mut dyn Wire,
    reply: &mut [u8],
    request: &[u8],
    transaction: u16,
    unit: u8,
) -> Result<std::ops::Range<usize>, Error> {
    wire.write_all(request).await?;
    let mut header = [0; mbap::HEADER_LEN];
    wire.read_exact(&mut header).await?;
    let pdu = reply
        .get_mut(..mbap::check_header(header, transaction, unit)?)
        .ok_or(Error::Protocol("bad length"))?;
    wire.read_exact(pdu).await?;
    Ok(0..pdu.len())
}

#[cfg(test)]
mod tests;
