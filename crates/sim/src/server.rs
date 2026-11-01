//! The Modbus TCP server: function code 3 only, every request recorded.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::Registers;

/// Read holding registers: the only function the simulator serves.
pub const FC_READ_HOLDING: u8 = 3;
const EXCEPTION_ILLEGAL_FUNCTION: u8 = 1;
const EXCEPTION_ILLEGAL_ADDRESS: u8 = 2;
const EXCEPTION_ILLEGAL_VALUE: u8 = 3;
const MAX_WORDS: u16 = 125;

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
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let log = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::new((registers, units.to_vec(), Arc::clone(&log)));
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve(stream, Arc::clone(&shared)));
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

async fn serve(mut stream: TcpStream, shared: Shared) {
    while let Some(frame) = read_frame(&mut stream).await {
        let (registers, units, log) = &*shared;
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

struct Frame {
    transaction: [u8; 2],
    unit: u8,
    pdu: Vec<u8>,
}

async fn read_frame(stream: &mut TcpStream) -> Option<Frame> {
    let mut header = [0_u8; 7];
    stream.read_exact(&mut header).await.ok()?;
    let length = usize::from(u16::from_be_bytes([header[4], header[5]])).checked_sub(1)?;
    let mut pdu = vec![0_u8; length];
    stream.read_exact(&mut pdu).await.ok()?;
    Some(Frame { transaction: [header[0], header[1]], unit: header[6], pdu })
}

impl Frame {
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

    fn wrap(&self, pdu: &[u8]) -> Vec<u8> {
        let length = u16::try_from(pdu.len() + 1).unwrap_or_default();
        let mut out = Vec::with_capacity(pdu.len() + 7);
        out.extend_from_slice(&self.transaction);
        out.extend_from_slice(&[0, 0]);
        out.extend_from_slice(&length.to_be_bytes());
        out.push(self.unit);
        out.extend_from_slice(pdu);
        out
    }
}
