//! The signals that stop the process. ESP-IDF has no POSIX signals: there only power stops it.

use std::io;

#[cfg(not(target_os = "espidf"))]
use tokio::signal::unix::{Signal, SignalKind, signal};

#[derive(Debug)]
pub struct StopSignals {
    #[cfg(not(target_os = "espidf"))]
    interrupt: Signal,
    #[cfg(not(target_os = "espidf"))]
    terminate: Signal,
}

#[cfg(not(target_os = "espidf"))]
impl StopSignals {
    /// Installs the handlers; call before logging the first line, since whoever sees it may signal.
    pub fn install() -> io::Result<Self> {
        Ok(Self { interrupt: signal(SignalKind::interrupt())?, terminate: signal(SignalKind::terminate())? })
    }

    /// Waits for the next signal and returns its name.
    pub async fn recv(&mut self) -> &'static str {
        tokio::select! {
            _ = self.interrupt.recv() => "SIGINT",
            _ = self.terminate.recv() => "SIGTERM",
        }
    }
}

#[cfg(target_os = "espidf")]
impl StopSignals {
    #[allow(clippy::unnecessary_wraps, reason = "same signature as the unix build")]
    pub fn install() -> io::Result<Self> {
        Ok(Self {})
    }

    pub async fn recv(&mut self) -> &'static str {
        std::future::pending().await
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::process::Command;

    use super::StopSignals;

    fn raise(name: &str) {
        let pid = std::process::id().to_string();
        let status = Command::new("kill").args([&format!("-{name}"), &pid]).status();
        assert!(status.is_ok_and(|s| s.success()));
    }

    // One test: signals are process-wide, so two tests would see each other's.
    #[tokio::test(flavor = "current_thread")]
    async fn names_the_signal_that_asked_the_process_to_stop() {
        let mut stop = StopSignals::install().unwrap();
        raise("INT");
        assert_eq!(stop.recv().await, "SIGINT");
        raise("TERM");
        assert_eq!(stop.recv().await, "SIGTERM");
    }
}
