//! Plays one recorded wire exchange of the transport corpus against a client.

use std::net::SocketAddr;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::Exchange;

const STEP_TIMEOUT: Duration = Duration::from_secs(5);
/// Pause between the chunks of one reply, so each reaches the client as its own TCP read.
const CHUNK_GAP: Duration = Duration::from_millis(20);
/// How long after the last step the replay still listens for a request the recording does not have.
const TRAILING_GRACE: Duration = Duration::from_millis(200);

#[derive(Debug)]
pub struct Replay {
    pub addr: SocketAddr,
    done: JoinHandle<Result<(), String>>,
}

impl Replay {
    /// Waits for the exchange to end: `Err` names the first request that differed from the recording.
    pub async fn finish(self) -> Result<(), String> {
        self.done.await.map_err(|error| format!("replay task failed: {error}"))?
    }
}

/// Accepts one connection and walks `steps`: each `Expect` reads and compares, each `Send` writes.
pub async fn replay(steps: Vec<Exchange>) -> std::io::Result<Replay> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let done = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        stream.set_nodelay(true).map_err(|error| error.to_string())?;
        for step in steps {
            match step {
                Exchange::Expect(want) => expect(&mut stream, &want).await?,
                Exchange::Send(chunks) => send(&mut stream, &chunks).await?,
            }
        }
        no_more_requests(&mut stream).await
    });
    Ok(Replay { addr, done })
}

/// The recording is everything 2.x sent: a request past its end is a retry or a read the client should
/// not make. A client that hangs up ends the wait early.
async fn no_more_requests(stream: &mut TcpStream) -> Result<(), String> {
    let mut extra = [0_u8; 1];
    match tokio::time::timeout(TRAILING_GRACE, stream.read(&mut extra)).await {
        Ok(Ok(read)) if read > 0 => Err("the client sent a request after the recording ended".to_owned()),
        _ => Ok(()),
    }
}

async fn expect(stream: &mut TcpStream, want: &[u8]) -> Result<(), String> {
    let mut got = vec![0_u8; want.len()];
    let read = tokio::time::timeout(STEP_TIMEOUT, stream.read_exact(&mut got)).await;
    read.map_err(|_| format!("timed out waiting for {} bytes", want.len()))?
        .map_err(|error| error.to_string())?;
    if got == want { Ok(()) } else { Err(format!("request {got:02x?}, recorded {want:02x?}")) }
}

async fn send(stream: &mut TcpStream, chunks: &[Vec<u8>]) -> Result<(), String> {
    for chunk in chunks {
        stream.write_all(chunk).await.map_err(|error| error.to_string())?;
        stream.flush().await.map_err(|error| error.to_string())?;
        tokio::time::sleep(CHUNK_GAP).await;
    }
    Ok(())
}
