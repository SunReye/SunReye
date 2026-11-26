//! The log buffer (ADR 2): the last lines the core logged, held in memory for the SPA's log
//! screen. Stderr keeps them for journald or Docker; the core writes no log file.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use tracing_subscriber::fmt::MakeWriter;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::ProblemDetails;

/// The lines the buffer holds.
pub const LINES: usize = 2_000;
/// The bytes a line keeps; a longer one is cut.
pub const LINE_BYTES: usize = 1_024;

/// The last [`LINES`] lines logged, each at most [`LINE_BYTES`]. A clone shares them.
#[derive(Debug, Clone, Default)]
pub struct Logs {
    lines: Arc<Mutex<VecDeque<String>>>,
}

impl Logs {
    /// The lines held, oldest first.
    #[must_use]
    pub fn lines(&self) -> Vec<String> {
        self.held().iter().cloned().collect()
    }

    /// The log route, behind the admin's session: a line may name a host.
    pub fn routes(self) -> OpenApiRouter {
        OpenApiRouter::new().routes(routes!(logs)).with_state(self)
    }

    fn held(&self) -> std::sync::MutexGuard<'_, VecDeque<String>> {
        // A panic mid-push leaves whole lines behind.
        crate::lock(&self.lines)
    }

    fn keep(&self, text: &str) {
        let mut held = self.held();
        for line in text.lines() {
            if held.len() == LINES {
                held.pop_front();
            }
            held.push_back(cut(line));
        }
    }
}

/// The core's last log lines.
#[derive(Serialize, ToSchema)]
struct Lines {
    /// Oldest first, as written to stderr.
    lines: Vec<String>,
}

/// The core's last 2,000 log lines, each at most 1 KiB (ADR 2).
#[utoipa::path(get, path = "/api/v1/logs", responses(
    (status = 200, body = Lines),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn logs(State(logs): State<Logs>) -> Json<Lines> {
    Json(Lines {
        lines: logs.lines(),
    })
}

/// `line`, ending in `…` past [`LINE_BYTES`].
fn cut(line: &str) -> String {
    if line.len() <= LINE_BYTES {
        return line.to_owned();
    }
    let end = line.floor_char_boundary(LINE_BYTES - '…'.len_utf8());
    format!("{}…", &line[..end])
}

/// One event's text, kept once the event is written.
pub struct Event {
    logs: Logs,
    text: Vec<u8>,
}

impl std::io::Write for Event {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.text.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for Event {
    fn drop(&mut self) {
        self.logs.keep(&String::from_utf8_lossy(&self.text));
    }
}

impl<'a> MakeWriter<'a> for Logs {
    type Writer = Event;

    fn make_writer(&'a self) -> Self::Writer {
        Event {
            logs: self.clone(),
            text: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use tracing_subscriber::util::SubscriberInitExt as _;

    use super::{LINE_BYTES, LINES, Logs};

    /// Runs `log` with its events written to a fresh buffer; returns the buffer.
    fn logged(log: impl FnOnce()) -> Logs {
        let logs = Logs::default();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .without_time()
            .with_writer(logs.clone())
            .finish();
        let _logging = subscriber.set_default();
        log();
        logs
    }

    #[test]
    fn the_buffer_holds_the_last_2000_lines_oldest_first() {
        let logs = logged(|| {
            for line in 0..=LINES {
                tracing::info!(line, "polled");
            }
        });

        let lines = logs.lines();

        assert_eq!(lines.len(), 2_000);
        assert_eq!(lines[0], " INFO sunreye_core::logs::tests: polled line=1");
        assert_eq!(
            lines[1_999],
            " INFO sunreye_core::logs::tests: polled line=2000"
        );
    }

    #[test]
    fn a_line_longer_than_1024_bytes_is_cut_on_a_character() {
        let logs = logged(|| tracing::warn!("{}", "ä".repeat(1_000)));

        let lines = logs.lines();

        assert_eq!(lines.len(), 1);
        assert!(lines[0].len() <= LINE_BYTES, "{}", lines[0].len());
        assert!(lines[0].ends_with("ää…"), "{}", lines[0]);
    }

    #[test]
    fn an_event_of_several_lines_is_held_as_each() {
        let logs = logged(|| tracing::error!("refused\nby the device"));

        assert_eq!(
            logs.lines(),
            ["ERROR sunreye_core::logs::tests: refused", "by the device"]
        );
    }
}
