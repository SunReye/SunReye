//! The `sunreye` binary.

use std::io::Write as _;
use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_core::profiles::{self, Https};
use sunreye_core::startup::{self, Boot, Options};
use sunreye_core::weather::{OpenMeteo, OpenMeteoArchive};
use sunreye_core::{capture, import};
use tokio::net::TcpListener;

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let mut args = std::env::args().skip(1).peekable();
    if args.next_if(|arg| arg == "capture").is_some() {
        return capture(args);
    }
    if args.next_if(|arg| arg == "import").is_some() {
        return import(args);
    }
    let options = match Options::parse(args, |name| std::env::var(name).ok()) {
        Ok(options) => options,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::from(2);
        }
    };
    // All I/O on one thread (ADR 2); storage owns its own.
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => {
            tracing::error!("runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run(options)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e}");
            ExitCode::FAILURE
        }
    }
}

/// `sunreye capture` (ADR 6): records a read-only capture and prints the file to stdout.
fn capture(args: impl Iterator<Item = String>) -> ExitCode {
    let options = match capture::Options::parse(args) {
        Ok(options) => options,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::from(2);
        }
    };
    let recorded = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())
        .and_then(|runtime| {
            runtime
                .block_on(capture::run(options))
                .map_err(|e| e.to_string())
        });
    match recorded {
        Ok(recording) => match std::io::stdout().write_all(recording.to_ndjson().as_bytes()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                tracing::error!("capture: {e}");
                ExitCode::FAILURE
            }
        },
        Err(e) => {
            tracing::error!("capture: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `sunreye import` (ADR 18): imports a v3 export into the store while the core is stopped.
fn import(args: impl Iterator<Item = String>) -> ExitCode {
    let options = match import::Options::parse(args, |name| std::env::var(name).ok()) {
        Ok(options) => options,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::from(2);
        }
    };
    let imported = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())
        .and_then(|runtime| {
            runtime
                .block_on(import::command(options, build_time()))
                .map_err(|e| e.to_string())
        });
    match imported {
        Ok(report) => {
            let written = report.written;
            tracing::info!(
                series = report.series,
                points = written.points,
                hours = written.hours,
                days = written.days,
                "imported"
            );
            for metric in report.unread {
                tracing::warn!(metric, "no v5 quantity reads it: not imported");
            }
            for device in report.unmapped {
                tracing::warn!(device, "not mapped: not imported");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!("import: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(options: Options) -> Result<(), startup::Error> {
    let listener = TcpListener::bind(options.listen).await?;
    tracing::info!(address = %options.listen, data = %options.data_dir.display(), "serving");
    if let Some(ingress) = options.ingress {
        tracing::info!(%ingress, "trusting Home Assistant ingress");
    }
    let boot = Boot {
        data_dir: options.data_dir,
        ingress: options.ingress,
        build: build_time(),
        weather: OpenMeteo,
        archive: OpenMeteoArchive,
        fetch: std::sync::Arc::new(Https),
        keys: profiles::KEYS,
    };
    startup::serve(listener, boot, terminated()).await?;
    tracing::info!("stopped");
    Ok(())
}

fn build_time() -> SystemTime {
    let seconds = env!("SUNREYE_BUILD_TIME").parse().unwrap_or(0);
    UNIX_EPOCH + Duration::from_secs(seconds)
}

/// Resolves on Ctrl-C or SIGTERM, which Docker and systemd send.
async fn terminated() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
    let term = async {
        match term.as_mut() {
            Some(term) => {
                term.recv().await;
            }
            None => std::future::pending().await,
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = term => {}
    }
}
