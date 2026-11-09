//! A Modbus TCP device, or one behind a Solarman stick, on a local port, for tests: a holding
//! register reads as its address until a write stores another value.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use sunreye_profile::Framing;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use super::{Endpoint, solarman};

/// The fake stick's logger serial.
const STICK: u32 = 0x1234_5678;

/// A request other than a write: the connection it came on, counted from 0, its unit id and its
/// function code. A Solarman stick's refusals count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Read {
    pub connection: usize,
    pub unit: u8,
    pub function: u8,
}

/// A function 16 write the device received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Write {
    pub unit: u8,
    pub start: u16,
    pub words: Vec<u16>,
}

/// How the device treats a write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Writes {
    /// Stores it and echoes it.
    Store,
    /// Echoes it and keeps the old value, as some devices do.
    Ignore,
    /// Never answers.
    Silent,
}

#[derive(Debug)]
pub struct Fake {
    pub address: SocketAddr,
    framing: Framing,
    pub reads: mpsc::UnboundedReceiver<Read>,
    pub writes: mpsc::UnboundedReceiver<Write>,
}

type Registers = Arc<Mutex<HashMap<u16, u16>>>;

/// Serves on a free local port until the runtime stops, storing writes.
///
/// # Panics
/// No local port is free.
pub async fn serve() -> Fake {
    serve_with(Writes::Store).await
}

/// Serves on a free local port until the runtime stops, treating writes as `writes` says.
///
/// # Panics
/// No local port is free.
pub async fn serve_with(writes: Writes) -> Fake {
    start(Framing::Tcp, writes).await
}

/// Serves behind a Solarman stick on a free local port until the runtime stops, storing writes.
///
/// # Panics
/// No local port is free.
pub async fn serve_solarman() -> Fake {
    start(Framing::SolarmanV5, Writes::Store).await
}

impl Fake {
    /// The endpoint that reaches this device.
    #[must_use]
    pub fn endpoint(&self) -> Endpoint {
        let host = self.address.ip().to_string();
        let port = self.address.port();
        match self.framing {
            Framing::Tcp | Framing::RtuOverTcp => Endpoint::ModbusTcp { host, port },
            Framing::SolarmanV5 => Endpoint::SolarmanV5 { host, port },
        }
    }
}

async fn start(framing: Framing, writes: Writes) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (read_tx, reads) = mpsc::unbounded_channel();
    let (write_tx, written) = mpsc::unbounded_channel();
    let registers = Registers::default();
    tokio::spawn(async move {
        let mut connection = 0;
        while let Ok((stream, _)) = listener.accept().await {
            let device = Device {
                connection,
                framing,
                writes,
                registers: Arc::clone(&registers),
                reads: read_tx.clone(),
                written: write_tx.clone(),
            };
            tokio::spawn(async move { device.answer(stream).await });
            connection += 1;
        }
    });
    Fake {
        address,
        framing,
        reads,
        writes: written,
    }
}

struct Device {
    connection: usize,
    framing: Framing,
    writes: Writes,
    registers: Registers,
    reads: mpsc::UnboundedSender<Read>,
    written: mpsc::UnboundedSender<Write>,
}

/// One request off the wire: its unit id and PDU, and how to frame the answer.
struct Request {
    unit: u8,
    pdu: Vec<u8>,
    frame: Frame,
}

enum Frame {
    /// The MBAP header's transaction and protocol.
    Mbap([u8; 4]),
    /// The V5 sequence, and whether the request named the stick's serial.
    Solarman { seq: u8, addressed: bool },
}

async fn receive_mbap(stream: &mut TcpStream) -> Option<Request> {
    let mut header = [0; 7];
    stream.read_exact(&mut header).await.ok()?;
    let len = usize::from(u16::from_be_bytes([header[4], header[5]])) - 1;
    let mut pdu = vec![0; len];
    stream.read_exact(&mut pdu).await.ok()?;
    Some(Request {
        unit: header[6],
        pdu,
        frame: Frame::Mbap([header[0], header[1], header[2], header[3]]),
    })
}

async fn receive_solarman(stream: &mut TcpStream) -> Option<Request> {
    let mut head = [0; 3];
    stream.read_exact(&mut head).await.ok()?;
    let mut frame = head.to_vec();
    frame.resize(
        11 + usize::from(u16::from_le_bytes([head[1], head[2]])) + 2,
        0,
    );
    stream.read_exact(&mut frame[3..]).await.ok()?;
    let serial = u32::from_le_bytes(frame[7..11].try_into().unwrap());
    let adu = &frame[26..frame.len() - 4];
    Some(Request {
        unit: adu[0],
        pdu: adu[1..].to_vec(),
        frame: Frame::Solarman {
            seq: frame[5],
            addressed: serial == STICK,
        },
    })
}

impl Request {
    /// The reply to send for `body`, the reply's PDU; `None` stays silent.
    fn reply(&self, body: Option<Vec<u8>>) -> Option<Vec<u8>> {
        let mut reply = Vec::new();
        match self.frame {
            Frame::Mbap(head) => {
                let body = body?;
                reply.extend_from_slice(&head);
                reply.extend_from_slice(&u16::try_from(body.len() + 1).unwrap().to_be_bytes());
                reply.push(self.unit);
                reply.extend_from_slice(&body);
            }
            Frame::Solarman { seq, addressed } => {
                let payload = if addressed {
                    let mut rtu = vec![self.unit];
                    rtu.extend_from_slice(&body?);
                    rtu.extend_from_slice(&solarman::crc16(&rtu).to_le_bytes());
                    rtu
                } else {
                    vec![6, 0]
                };
                reply.push(0xa5);
                reply.extend_from_slice(&u16::try_from(14 + payload.len()).unwrap().to_le_bytes());
                reply.extend_from_slice(&[0x10, 0x15, seq, 0]);
                reply.extend_from_slice(&STICK.to_le_bytes());
                reply.push(1);
                reply.extend_from_slice(&[0; 13]);
                reply.extend_from_slice(&payload);
                reply.extend_from_slice(&[solarman::checksum(&reply), 0x15]);
            }
        }
        Some(reply)
    }
}

impl Device {
    async fn answer(self, mut stream: TcpStream) {
        loop {
            let request = match self.framing {
                Framing::Tcp | Framing::RtuOverTcp => receive_mbap(&mut stream).await,
                Framing::SolarmanV5 => receive_solarman(&mut stream).await,
            };
            let Some(request) = request else { return };
            let Some(reply) = request.reply(self.handle(&request)) else {
                continue;
            };
            if stream.write_all(&reply).await.is_err() {
                return;
            }
        }
    }

    /// The reply's PDU; `None` when the device stays silent.
    fn handle(&self, request: &Request) -> Option<Vec<u8>> {
        let pdu = &request.pdu;
        let start = u16::from_be_bytes([pdu[1], pdu[2]]);
        let count = u16::from_be_bytes([pdu[3], pdu[4]]);
        if pdu[0] == 0x10 {
            return self.write(request.unit, start, &pdu[6..]);
        }
        self.reads
            .send(Read {
                connection: self.connection,
                unit: request.unit,
                function: pdu[0],
            })
            .ok();
        Some(self.read(start, count))
    }

    fn read(&self, start: u16, count: u16) -> Vec<u8> {
        let registers = self.registers.lock().unwrap();
        let mut body = vec![3, u8::try_from(2 * count).unwrap()];
        for address in start..start + count {
            let word = registers.get(&address).copied().unwrap_or(address);
            body.extend_from_slice(&word.to_be_bytes());
        }
        drop(registers);
        body
    }

    /// The reply's PDU after the unit id; `None` when the device stays silent.
    fn write(&self, unit: u8, start: u16, data: &[u8]) -> Option<Vec<u8>> {
        let words: Vec<u16> = data
            .as_chunks::<2>()
            .0
            .iter()
            .map(|w| u16::from_be_bytes(*w))
            .collect();
        let count = u16::try_from(words.len()).unwrap();
        if self.writes == Writes::Store {
            let mut registers = self.registers.lock().unwrap();
            registers.extend((start..).zip(words.iter().copied()));
        }
        self.written.send(Write { unit, start, words }).ok();
        if self.writes == Writes::Silent {
            return None;
        }
        let mut body = vec![0x10];
        body.extend_from_slice(&start.to_be_bytes());
        body.extend_from_slice(&count.to_be_bytes());
        Some(body)
    }
}
