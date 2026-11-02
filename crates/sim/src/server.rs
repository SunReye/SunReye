//! The Modbus server, Modbus TCP, RTU over TCP or Solarman V5: function code 3 only, every request
//! recorded.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::Registers;
use crate::v5;

/// Read holding registers: the only function the simulator serves.
pub const FC_READ_HOLDING: u8 = 3;
const EXCEPTION_ILLEGAL_FUNCTION: u8 = 1;
const EXCEPTION_ILLEGAL_ADDRESS: u8 = 2;
const EXCEPTION_ILLEGAL_VALUE: u8 = 3;
const FC_WRITE_MULTIPLE: u8 = 16;
const MAX_WORDS: u16 = 125;

/// The framing a [`Simulator`] speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    /// MBAP header, then the PDU.
    Tcp,
    /// Unit id, PDU, CRC-16/Modbus (low byte first): a serial frame on a TCP stream.
    RtuOverTcp,
    /// A logging stick with this serial: the RTU frame inside a Solarman V5 envelope. A request naming
    /// another serial is rejected with status 6, as a stick does.
    SolarmanV5(u32),
}

/// A request as it arrived. `start` and `count` are 0 for a function the simulator does not serve.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Request {
    pub unit: u8,
    pub function: u8,
    pub start: u16,
    pub count: u16,
}

#[derive(Debug)]
pub struct Simulator {
    pub addr: SocketAddr,
    log: Arc<Mutex<Vec<Request>>>,
    task: JoinHandle<()>,
}

impl Simulator {
    /// Listens on a free loopback port and answers the unit ids in `units`; any other unit stays silent.
    pub async fn start(registers: Registers, units: &[u8]) -> std::io::Result<Self> {
        Self::start_with(Framing::Tcp, registers, units).await
    }

    /// As [`Simulator::start`], speaking `framing`.
    pub async fn start_with(framing: Framing, registers: Registers, units: &[u8]) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let log = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::new((registers, units.to_vec(), Arc::clone(&log)));
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve(stream, framing, Arc::clone(&shared)));
            }
        });
        Ok(Self { addr, log, task })
    }

    pub fn requests(&self) -> Vec<Request> {
        self.log.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

impl Drop for Simulator {
    fn drop(&mut self) {
        self.task.abort();
    }
}

type Shared = Arc<(Registers, Vec<u8>, Arc<Mutex<Vec<Request>>>)>;

async fn serve(mut stream: TcpStream, framing: Framing, shared: Shared) {
    while let Some(frame) = read_frame(&mut stream, framing).await {
        let (registers, units, log) = &*shared;
        if let Some(reject) = frame.rejection() {
            if stream.write_all(&reject).await.is_err() {
                return;
            }
            continue;
        }
        if !units.contains(&frame.unit) {
            continue;
        }
        let request = frame.request();
        log.lock().unwrap_or_else(PoisonError::into_inner).push(request);
        let reply = frame.reply(registers, request);
        if stream.write_all(&reply).await.is_err() {
            return;
        }
    }
}

/// What surrounds the PDU on the wire.
#[derive(Clone, Copy)]
enum Envelope {
    Mbap {
        transaction: [u8; 2],
    },
    Rtu,
    /// `addressed` is false for a request that named another serial than `stick`.
    Solarman {
        stick: u32,
        seq: u16,
        addressed: bool,
    },
}

struct Frame {
    envelope: Envelope,
    unit: u8,
    pdu: Vec<u8>,
}

async fn read_frame(stream: &mut TcpStream, framing: Framing) -> Option<Frame> {
    match framing {
        Framing::Tcp => read_mbap(stream).await,
        Framing::RtuOverTcp => read_rtu(stream).await,
        Framing::SolarmanV5(stick) => read_solarman(stream, stick).await,
    }
}

async fn read_solarman(stream: &mut TcpStream, stick: u32) -> Option<Frame> {
    let incoming = v5::read_request(stream, stick).await?;
    let envelope = Envelope::Solarman { stick, seq: incoming.seq, addressed: incoming.addressed };
    let rtu = incoming.rtu;
    let (unit, pdu) = match rtu.split_first() {
        Some((unit, rest)) => (*unit, rest[..rest.len() - 2].to_vec()),
        None => (0, Vec::new()),
    };
    Some(Frame { envelope, unit, pdu })
}

async fn read_mbap(stream: &mut TcpStream) -> Option<Frame> {
    let mut header = [0_u8; 7];
    stream.read_exact(&mut header).await.ok()?;
    let length = usize::from(u16::from_be_bytes([header[4], header[5]])).checked_sub(1)?;
    let mut pdu = vec![0_u8; length];
    stream.read_exact(&mut pdu).await.ok()?;
    Some(Frame { envelope: Envelope::Mbap { transaction: [header[0], header[1]] }, unit: header[6], pdu })
}

/// The next frame whose CRC holds; a frame that fails it is dropped unanswered, as a serial device does.
async fn read_rtu(stream: &mut TcpStream) -> Option<Frame> {
    loop {
        let mut frame = vec![0_u8; 2];
        stream.read_exact(&mut frame).await.ok()?;
        let mut fixed = [0_u8; 4];
        stream.read_exact(&mut fixed).await.ok()?;
        frame.extend_from_slice(&fixed);
        if frame[1] == FC_WRITE_MULTIPLE {
            let mut head = [0_u8; 1];
            stream.read_exact(&mut head).await.ok()?;
            frame.push(head[0]);
            let mut data = vec![0_u8; usize::from(head[0])];
            stream.read_exact(&mut data).await.ok()?;
            frame.extend_from_slice(&data);
        }
        let mut crc = [0_u8; 2];
        stream.read_exact(&mut crc).await.ok()?;
        if crc16(&frame).to_le_bytes() == crc {
            return Some(Frame { envelope: Envelope::Rtu, unit: frame[0], pdu: frame[1..].to_vec() });
        }
    }
}

/// CRC-16/Modbus: reflected polynomial 0xA001, seed 0xFFFF.
pub(crate) fn crc16(bytes: &[u8]) -> u16 {
    bytes.iter().fold(0xFFFF, |mut crc, byte| {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xA001 } else { crc >> 1 };
        }
        crc
    })
}

impl Frame {
    /// The reply to a frame that named another logger serial; such a frame is never a request.
    fn rejection(&self) -> Option<Vec<u8>> {
        match self.envelope {
            Envelope::Solarman { stick, seq, addressed: false } => Some(v5::reject(stick, seq)),
            _ => None,
        }
    }

    fn request(&self) -> Request {
        let function = self.pdu.first().copied().unwrap_or_default();
        let (start, count) = match self.pdu.as_slice() {
            [FC_READ_HOLDING, s0, s1, c0, c1] => {
                (u16::from_be_bytes([*s0, *s1]), u16::from_be_bytes([*c0, *c1]))
            }
            _ => (0, 0),
        };
        Request { unit: self.unit, function, start, count }
    }

    fn reply(&self, registers: &Registers, request: Request) -> Vec<u8> {
        if request.function != FC_READ_HOLDING || self.pdu.len() != 5 {
            return self.exception(request.function, EXCEPTION_ILLEGAL_FUNCTION);
        }
        if request.count == 0 || request.count > MAX_WORDS {
            return self.exception(request.function, EXCEPTION_ILLEGAL_VALUE);
        }
        let Some(words) = registers.read(request.start, request.count) else {
            return self.exception(request.function, EXCEPTION_ILLEGAL_ADDRESS);
        };
        let mut pdu = vec![FC_READ_HOLDING, u8::try_from(words.len() * 2).unwrap_or_default()];
        pdu.extend(words.iter().flat_map(|w| w.to_be_bytes()));
        self.wrap(&pdu)
    }

    fn exception(&self, function: u8, code: u8) -> Vec<u8> {
        self.wrap(&[function | 0x80, code])
    }

    /// Unit id, PDU, CRC-16/Modbus.
    fn rtu(&self, pdu: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(pdu.len() + 3);
        out.push(self.unit);
        out.extend_from_slice(pdu);
        out.extend_from_slice(&crc16(&out).to_le_bytes());
        out
    }

    fn wrap(&self, pdu: &[u8]) -> Vec<u8> {
        match self.envelope {
            Envelope::Mbap { transaction } => {
                let length = u16::try_from(pdu.len() + 1).unwrap_or_default();
                let mut out = Vec::with_capacity(pdu.len() + 7);
                out.extend_from_slice(&transaction);
                out.extend_from_slice(&[0, 0]);
                out.extend_from_slice(&length.to_be_bytes());
                out.push(self.unit);
                out.extend_from_slice(pdu);
                out
            }
            Envelope::Rtu => self.rtu(pdu),
            Envelope::Solarman { stick, seq, .. } => v5::response(stick, seq, &self.rtu(pdu)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_crc_is_the_modbus_one() {
        assert_eq!(crc16(b"123456789"), 0x4b37, "the CRC-16/MODBUS check value");
        assert_eq!(crc16(&[1, 3, 0, 0, 0, 10]), 0xcdc5);
        assert_eq!(crc16(&[]), 0xffff);
    }
}
