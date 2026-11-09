//! The `sunreye` binary.

use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_core::startup::{self, Boot, Options};
use sunreye_core::weather::OpenMeteo;
use tokio::net::TcpListener;

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let options = match Options::parse(std::env::args().skip(1), |name| std::env::var(name).ok()) {
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
