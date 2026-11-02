use std::process::ExitCode;

use clap::Parser;
use sunreye::Cli;
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::from(cli.log_level))
        .with_writer(std::io::stderr)
        .init();

    // Installed before the first log line: whoever sees the line may signal us.
    let (mut int, mut term) = match (signal(SignalKind::interrupt()), signal(SignalKind::terminate())) {
        (Ok(int), Ok(term)) => (int, term),
        (Err(error), _) | (_, Err(error)) => {
            tracing::error!(%error, "cannot install signal handlers");
            return ExitCode::FAILURE;
        }
    };

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        listen = %cli.listen,
        data_dir = %cli.data_dir.display(),
        "sunreye starting"
    );
    let listener = match TcpListener::bind(cli.listen).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, listen = %cli.listen, "cannot listen");
            return ExitCode::FAILURE;
        }
    };
    if !cli.listen.ip().is_loopback() {
        tracing::warn!(
            listen = %cli.listen,
            "listen address is not loopback: the API has no accounts yet, so anyone who can reach it can change settings"
        );
    }
    if let Ok(addr) = listener.local_addr() {
        tracing::info!(%addr, "sunreye listening");
    }
    let stop = async {
        let received = tokio::select! {
            _ = int.recv() => "SIGINT",
            _ = term.recv() => "SIGTERM",
        };
        tracing::info!(signal = received, "sunreye stopping");
    };
    match sunreye::run(&cli.data_dir, listener, stop).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "sunreye cannot run");
            ExitCode::FAILURE
        }
    }
}
