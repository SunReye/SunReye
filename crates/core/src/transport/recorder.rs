//! The read-only wire `sunreye capture` records through, and the setup scan probes through
//! without a tape. It refuses every request but a read of holding registers before a byte of it
//! reaches the device, so neither can write whatever its caller does.

use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use sunreye_profile::Framing;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use super::{Exchange, mbap, rtu, solarman};

/// The exchanges recorded so far; clones share them.
#[derive(Debug, Clone, Default)]
pub struct Tape(Arc<Mutex<Vec<Exchange>>>);

impl Tape {
    #[must_use]
    pub fn exchanges(&self) -> Vec<Exchange> {
        crate::lock(&self.0).clone()
    }
}

#[derive(Debug)]
pub struct Recorder<W> {
    inner: W,
    tape: Option<Tape>,
    request_frame: fn(&[u8]) -> Option<(usize, u8)>,
    /// Bytes of the current request not yet written.
    left: usize,
}

impl<W> Recorder<W> {
    pub fn new(inner: W, framing: Framing, tape: Option<Tape>) -> Self {
        let request_frame = match framing {
            Framing::Tcp => mbap::request_frame,
            Framing::RtuOverTcp => rtu::request_frame,
            Framing::SolarmanV5 => solarman::request_frame,
        };
        Self {
            inner,
            tape,
            request_frame,
            left: 0,
        }
    }
}

impl<W: AsyncWrite + Unpin> AsyncWrite for Recorder<W> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let recorder = self.get_mut();
        let starts = recorder.left == 0;
        if starts {
            match (recorder.request_frame)(buf) {
                Some((length, mbap::FC_READ_HOLDING)) if length <= buf.len() => {
                    recorder.left = length;
                }
                _ => {
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "capture: only a read of holding registers may be sent",
                    )));
                }
            }
        }
        let frame = buf.get(..recorder.left).unwrap_or(buf);
        let written = match Pin::new(&mut recorder.inner).poll_write(cx, frame) {
            Poll::Ready(Ok(written)) => written,
            other @ (Poll::Ready(Err(_)) | Poll::Pending) => return other,
        };
        recorder.left -= written;
        if let Some(tape) = &recorder.tape {
            let sent = frame.get(..written).unwrap_or_default();
            let mut tape = crate::lock(&tape.0);
            match tape.last_mut() {
                Some(Exchange::Request(request)) if !starts => request.extend_from_slice(sent),
                _ => tape.push(Exchange::Request(sent.to_vec())),
            }
        }
        Poll::Ready(Ok(written))
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

impl<W: AsyncRead + Unpin> AsyncRead for Recorder<W> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let recorder = self.get_mut();
        let before = buf.filled().len();
        let polled = Pin::new(&mut recorder.inner).poll_read(cx, buf);
        let chunk = buf.filled().get(before..).unwrap_or_default();
        if let (Some(tape), false) = (&recorder.tape, chunk.is_empty()) {
            let mut tape = crate::lock(&tape.0);
            match tape.last_mut() {
                Some(Exchange::Reply(chunks)) => chunks.push(chunk.to_vec()),
                _ => tape.push(Exchange::Reply(vec![chunk.to_vec()])),
            }
        }
        polled
    }
}
