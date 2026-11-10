//! The `sunreye` binary.

use std::io::Write as _;
use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_core::logs::Logs;
use sunreye_core::profiles::{self, Https};
use sunreye_core::spot::EnergyCharts;
use sunreye_core::startup::{self, Boot, Options};
use sunreye_core::weather::{OpenMeteo, OpenMeteoArchive};
use sunreye_core::{backup, capture, import};
use tokio::net::TcpListener;
use tracing_subscriber::fmt::writer::MakeWriterExt as _;

/// Each subcommand and its usage; the bare `sunreye` serves.
const COMMANDS: [(&str, &str); 4] = [
    ("capture", capture::USAGE),
    ("import", import::USAGE),
    ("backup", backup::BACKUP_USAGE),
    ("restore", backup::RESTORE_USAGE),
];

fn main() -> ExitCode {
    let logs = Logs::default();
    // To stderr and the buffer the log screen reads; never a file (ADR 2).
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr.and(logs.clone()))
        .with_ansi(false)
        .init();
    let mut args = std::env::args().skip(1).peekable();
    let command = args.next_if(|arg| COMMANDS.iter().any(|(name, _)| arg == name));
    let args: Vec<String> = args.collect();
    if args.iter().any(|arg| arg == "--help") {
        let usage = COMMANDS
            .iter()
            .find(|(name, _)| command.as_deref() == Some(*name))
            .map_or(startup::USAGE, |(_, usage)| usage);
        return match std::io::stdout().write_all(usage.as_bytes()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(_) => ExitCode::FAILURE,
        };
    }
    let args = args.into_iter();
    match command.as_deref() {
        Some("capture") => return capture(args),
        Some("import") => return import(args),
        Some("backup") => return backup(args),
        Some("restore") => return restore(args),
        _ => {}
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
    match runtime.block_on(run(options, logs)) {
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
            import::log(&report);
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!("import: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `sunreye backup` (ADR 3): backs up the store and car bodies, the core running or not.
fn backup(args: impl Iterator<Item = String>) -> ExitCode {
    let options = match backup::Options::backup(args, |name| std::env::var(name).ok()) {
        Ok(options) => options,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::from(2);
        }
    };
    match backup::command(&options) {
        Ok(bytes) => {
            tracing::info!(file = %options.file.display(), bytes, secrets = options.secrets, "backed up");
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!("backup: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `sunreye restore` (ADR 3): replaces the store and car bodies while the core is stopped.
fn restore(args: impl Iterator<Item = String>) -> ExitCode {
    let options = match backup::Options::restore(args, |name| std::env::var(name).ok()) {
        Ok(options) => options,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::from(2);
        }
    };
    match backup::restore(&options.file, &options.data_dir) {
        Ok(()) => {
            tracing::info!(file = %options.file.display(), "restored");
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!("restore: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(options: Options, logs: Logs) -> Result<(), startup::Error> {
    let listener = TcpListener::bind(options.listen).await?;
    tracing::info!(address = %options.listen, data = %options.data_dir.display(), "serving");
    if let Some(ingress) = options.ingress {
        tracing::info!(%ingress, "trusting Home Assistant ingress");
    }
    let boot = Boot {
        data_dir: options.data_dir,
        share: std::path::PathBuf::from("/share"),
        ingress: options.ingress,
        build: build_time(),
        weather: OpenMeteo,
        archive: OpenMeteoArchive,
        spot: EnergyCharts,
        fetch: std::sync::Arc::new(Https),
        keys: profiles::KEYS,
        logs,
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

#[cfg(test)]
mod tests {
    use super::{COMMANDS, backup, capture, import, startup};

    /// The flags a usage lists, each at the start of a line.
    fn flags(usage: &str) -> Vec<String> {
        usage
            .lines()
            .filter_map(|line| line.split_whitespace().next())
            .filter(|word| word.starts_with("--"))
            .map(str::to_owned)
            .collect()
    }

    /// Why `command` refuses `flag` with a value and a file, if it does not know it.
    fn refusal(command: &str, flag: &str) -> String {
        let args = ["file".to_owned(), flag.to_owned(), "1".to_owned()];
        let env = |_: &str| None;
        let unknown = |e: &dyn std::fmt::Display| e.to_string();
        let refused = match command {
            "capture" => capture::Options::parse(args.into_iter().skip(1))
                .err()
                .map(|e| unknown(&e)),
            "import" => import::Options::parse(args, env).err().map(|e| unknown(&e)),
            "backup" => backup::Options::backup(args, env)
                .err()
                .map(|e| unknown(&e)),
            "restore" => backup::Options::restore(args, env)
                .err()
                .map(|e| unknown(&e)),
            _ => startup::Options::parse(args.into_iter().skip(1), env)
                .err()
                .map(|e| unknown(&e)),
        };
        refused.unwrap_or_default()
    }

    #[test]
    fn every_flag_a_usage_lists_is_one_its_command_reads() {
        let serve = ("serve", startup::USAGE);
        for (command, usage) in COMMANDS.into_iter().chain([serve]) {
            let listed = flags(usage);
            assert!(!listed.is_empty(), "{command}");
            for flag in listed {
                let refused = refusal(command, &flag);
                let unknown = format!("unknown argument `{flag}`");
                assert!(!refused.contains(&unknown), "{command} {flag}: {refused}");
            }
            let bogus = refusal(command, "--bogus");
            assert!(bogus.contains("unknown argument `--bogus`"), "{command}");
        }
    }
}
