use std::process::ExitCode;

use clap::Parser;
use sunreye::Cli;
use sunreye::shutdown::StopSignals;

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::from(cli.log_level))
        .with_writer(std::io::stderr)
        .init();

    // Installed before the first log line: whoever sees the line may signal us.
    let mut stop = match StopSignals::install() {
        Ok(stop) => stop,
        Err(error) => {
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
    let received = stop.recv().await;
    tracing::info!(signal = received, "sunreye stopping");
    ExitCode::SUCCESS
}
