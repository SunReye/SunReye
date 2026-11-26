//! `sim`: a byte stream that replays a capture. Each write must be the next recorded request, byte
//! for byte; each recorded reply then reads back in its recorded chunks. Where the capture has no
//! reply, a read waits as a silent device does, until the client's timeout.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use super::{Capture, Exchange};

#[derive(Debug)]
pub struct Sim {
    exchanges: Vec<Exchange>,
    step: usize,
    chunk: usize,
    /// Bytes already matched in the current request, or already read from the current chunk.
    offset: usize,
}

impl Sim {
    pub fn new(capture: Capture) -> Self {
        Self {
            exchanges: capture.exchanges,
            step: 0,
            chunk: 0,
            offset: 0,
        }
    }

    const fn next_step(&mut self) {
        self.step += 1;
        self.chunk = 0;
        self.offset = 0;
    }
}

fn refused(why: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("sim: {why}"))
}

impl AsyncWrite for Sim {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let sim = self.get_mut();
        let Some(Exchange::Request(want)) = sim.exchanges.get(sim.step) else {
            return Poll::Ready(Err(refused("a request the capture does not have")));
        };
        let remaining = want.get(sim.offset..).unwrap_or_default();
        let taken = buf.len().min(remaining.len());
        if buf.get(..taken) != remaining.get(..taken) {
            return Poll::Ready(Err(refused("the request differs from the capture")));
        }
        sim.offset += taken;
        if sim.offset == want.len() {
            sim.next_step();
        }
        Poll::Ready(Ok(taken))
    }

    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

impl AsyncRead for Sim {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let sim = self.get_mut();
        let Some(Exchange::Reply(chunks)) = sim.exchanges.get(sim.step) else {
            // No waker is kept: the client reads under a timeout, which wakes it.
            return Poll::Pending;
        };
        let chunk = chunks.get(sim.chunk).map(Vec::as_slice).unwrap_or_default();
        let remaining = chunk.get(sim.offset..).unwrap_or_default();
        let taken = remaining
            .get(..buf.remaining().min(remaining.len()))
            .unwrap_or_default();
        buf.put_slice(taken);
        sim.offset += taken.len();
        if sim.offset == chunk.len() {
            sim.chunk += 1;
            sim.offset = 0;
            if sim.chunk >= chunks.len() {
                sim.next_step();
            }
        }
        Poll::Ready(Ok(()))
    }
}
