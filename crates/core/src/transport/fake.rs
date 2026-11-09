//! A Modbus TCP device on a local port, for tests: a holding register reads as its address until a
//! write stores another value.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

/// A request the device answered: the connection it came on, counted from 0, its unit id and its
/// function code.
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
        reads,
        writes: written,
    }
}

struct Device {
    connection: usize,
    writes: Writes,
    registers: Registers,
    reads: mpsc::UnboundedSender<Read>,
    written: mpsc::UnboundedSender<Write>,
}

impl Device {
    async fn answer(self, mut stream: TcpStream) {
        let mut header = [0; 7];
        while stream.read_exact(&mut header).await.is_ok() {
            let len = usize::from(u16::from_be_bytes([header[4], header[5]])) - 1;
            let mut pdu = vec![0; len];
            if stream.read_exact(&mut pdu).await.is_err() {
                return;
            }
            let unit = header[6];
            let start = u16::from_be_bytes([pdu[1], pdu[2]]);
            let count = u16::from_be_bytes([pdu[3], pdu[4]]);
            let body = if pdu[0] == 0x10 {
                self.write(unit, start, &pdu[6..])
            } else {
                self.reads
                    .send(Read {
                        connection: self.connection,
                        unit,
                        function: pdu[0],
                    })
                    .ok();
                Some(self.read(start, count))
            };
            let Some(body) = body else { continue };
            let mut reply = Vec::new();
            reply.extend_from_slice(&header[..4]);
            reply.extend_from_slice(&u16::try_from(body.len() + 1).unwrap().to_be_bytes());
            reply.push(unit);
            reply.extend_from_slice(&body);
            if stream.write_all(&reply).await.is_err() {
                return;
            }
        }
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
