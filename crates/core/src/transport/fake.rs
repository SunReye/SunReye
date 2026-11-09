//! A Modbus TCP device on a local port, for tests: every holding register reads as its address.

use std::net::SocketAddr;

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

#[derive(Debug)]
pub struct Fake {
    pub address: SocketAddr,
    pub reads: mpsc::UnboundedReceiver<Read>,
}

/// Serves on a free local port until the runtime stops.
///
/// # Panics
/// No local port is free.
pub async fn serve() -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (tx, reads) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut connection = 0;
        while let Ok((stream, _)) = listener.accept().await {
            let tx = tx.clone();
            tokio::spawn(async move { answer(stream, connection, &tx).await });
            connection += 1;
        }
    });
    Fake { address, reads }
}

async fn answer(mut stream: TcpStream, connection: usize, reads: &mpsc::UnboundedSender<Read>) {
    let mut header = [0; 7];
    while stream.read_exact(&mut header).await.is_ok() {
        let len = usize::from(u16::from_be_bytes([header[4], header[5]])) - 1;
        let mut pdu = vec![0; len];
        if stream.read_exact(&mut pdu).await.is_err() {
            return;
        }
        let unit = header[6];
        reads
            .send(Read {
                connection,
                unit,
                function: pdu[0],
            })
            .ok();
        let start = u16::from_be_bytes([pdu[1], pdu[2]]);
        let count = u16::from_be_bytes([pdu[3], pdu[4]]);
        let mut reply = Vec::new();
        reply.extend_from_slice(&header[..4]);
        reply.extend_from_slice(&(3 + 2 * count).to_be_bytes());
        reply.push(unit);
        reply.push(3);
        reply.push(u8::try_from(2 * count).unwrap());
        for address in start..start + count {
            reply.extend_from_slice(&address.to_be_bytes());
        }
        if stream.write_all(&reply).await.is_err() {
            return;
        }
    }
}
