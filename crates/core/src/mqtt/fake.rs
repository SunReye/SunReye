//! An MQTT 3.1.1 broker on a local port, for tests: it answers every CONNECT with one return code,
//! answers pings, and closes its sessions on demand.

use std::net::SocketAddr;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio::time::Instant;

/// A CONNECT the broker received, and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connect {
    pub username: Option<String>,
    pub password: Option<String>,
    pub at: Instant,
}

#[derive(Debug)]
pub struct Fake {
    pub address: SocketAddr,
    pub connects: mpsc::UnboundedReceiver<Connect>,
    /// One message per accepted session the client closed.
    pub hung_up: mpsc::UnboundedReceiver<()>,
    close: broadcast::Sender<()>,
}

impl Fake {
    /// Closes every open session.
    pub fn close(&self) {
        let _closed = self.close.send(());
    }
}

/// Serves on a free local port until the runtime stops, answering CONNECT with `code`: 0 accepts,
/// 5 refuses as not authorised.
///
/// # Panics
/// No local port is free.
pub async fn serve(code: u8) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (sent, connects) = mpsc::unbounded_channel();
    let (hangs_up, hung_up) = mpsc::unbounded_channel();
    let (close, _) = broadcast::channel(1);
    let closing = close.clone();
    tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let channels = (sent.clone(), hangs_up.clone(), closing.subscribe());
            tokio::spawn(session(socket, code, channels));
        }
    });
    Fake {
        address,
        connects,
        hung_up,
        close,
    }
}

type Channels = (
    mpsc::UnboundedSender<Connect>,
    mpsc::UnboundedSender<()>,
    broadcast::Receiver<()>,
);

async fn session(mut socket: TcpStream, code: u8, channels: Channels) {
    let (connects, hangs_up, mut close) = channels;
    let Some((0x10, body)) = packet(&mut socket).await else {
        return;
    };
    let _sent = connects.send(connect(&body));
    socket.write_all(&[0x20, 2, 0, code]).await.unwrap();
    if code != 0 {
        return;
    }
    loop {
        tokio::select! {
            read = packet(&mut socket) => match read {
                Some((0xC0, _)) => socket.write_all(&[0xD0, 0]).await.unwrap(),
                Some(_) => {}
                None => {
                    let _sent = hangs_up.send(());
                    return;
                }
            },
            _ = close.recv() => return,
        }
    }
}

/// The next packet's first byte and body; `None` once the socket closes.
async fn packet(socket: &mut TcpStream) -> Option<(u8, Vec<u8>)> {
    let kind = socket.read_u8().await.ok()?;
    let (mut length, mut shift) = (0usize, 0);
    loop {
        let byte = socket.read_u8().await.ok()?;
        length |= usize::from(byte & 0x7F) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            break;
        }
    }
    let mut body = vec![0; length];
    socket.read_exact(&mut body).await.ok()?;
    Some((kind, body))
}

/// The credentials of a CONNECT body: protocol name, level, flags, keep-alive, then the client id,
/// the will, the username and the password as their flags say.
fn connect(body: &[u8]) -> Connect {
    let flags = body[7];
    let mut rest = &body[10..];
    let mut field = || {
        let length = usize::from(u16::from_be_bytes([rest[0], rest[1]]));
        let value = String::from_utf8(rest[2..2 + length].to_vec()).unwrap();
        rest = &rest[2 + length..];
        value
    };
    let _client = field();
    if flags & 0x04 != 0 {
        let _topic = field();
        let _message = field();
    }
    let username = (flags & 0x80 != 0).then(&mut field);
    let password = (flags & 0x40 != 0).then(&mut field);
    Connect {
        username,
        password,
        at: Instant::now(),
    }
}
