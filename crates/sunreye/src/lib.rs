//! The core's library, run by the binary. Startup flags live here; everything else is a setting the core
//! stores.

pub mod archive;
pub mod conditions;
pub mod decode;
pub mod evcc;
pub mod events;
pub mod forecast;
pub mod manifest;
pub mod modbus;
pub mod mqtt;
pub mod open_meteo;
#[cfg(test)]
mod oracle;
pub mod plant;
pub mod plant_zone;
pub mod poll;
pub mod probe;
pub mod profile;
pub mod recent;
mod refresh;
pub mod retention;
pub mod rollup;
pub mod run;
pub mod samples;
pub mod settings;
pub mod solar;
pub mod sources;
pub mod statistics;
pub mod store;
#[cfg(test)]
mod test_net;
pub mod weather;
pub mod web;

pub mod https;
pub mod learn;
pub mod live;

use std::net::SocketAddr;
use std::path::PathBuf;

use clap::{Parser, ValueEnum};

pub use run::run;

/// Startup flags. `--version` is absent on purpose: the version is the first log line.
#[derive(Debug, Parser, PartialEq, Eq)]
#[command(name = "sunreye", about = "SunReye core", disable_version_flag = true)]
pub struct Cli {
    /// Address the HTTP server listens on.
    #[arg(long, default_value = "127.0.0.1:8099")]
    pub listen: SocketAddr,
    /// Directory holding the store.
    #[arg(long, default_value = "data")]
    pub data_dir: PathBuf,
    /// Most verbose level that is logged.
    #[arg(long, value_enum, default_value_t = LogLevel::Info)]
    pub log_level: LogLevel,
    /// Origin besides the core's own host allowed to change state, e.g. `https://ha.example`. Repeatable.
    #[arg(long = "trusted-origin", value_parser = trusted_origin)]
    pub trusted_origins: Vec<String>,
    /// Send the session cookie only over HTTPS.
    #[arg(long)]
    pub secure_cookies: bool,
}

impl Cli {
    pub fn web(&self) -> web::Config {
        web::Config {
            trusted_origins: self.trusted_origins.clone(),
            secure_cookies: self.secure_cookies,
            ..web::Config::default()
        }
    }
}

fn trusted_origin(origin: &str) -> Result<String, String> {
    match web::origin_authority(origin) {
        Some(_) => Ok(origin.to_owned()),
        None => Err("an origin is http(s)://host[:port], with no path".into()),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl From<LogLevel> for tracing::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Error => Self::ERROR,
            LogLevel::Warn => Self::WARN,
            LogLevel::Info => Self::INFO,
            LogLevel::Debug => Self::DEBUG,
            LogLevel::Trace => Self::TRACE,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("sunreye").chain(args.iter().copied()))
    }

    #[test]
    fn defaults_apply_without_flags() {
        let cli = parse(&[]).unwrap();
        assert_eq!(cli.listen, "127.0.0.1:8099".parse().unwrap());
        assert_eq!(cli.data_dir, PathBuf::from("data"));
        assert_eq!(cli.log_level, LogLevel::Info);
        assert_eq!(cli.web(), web::Config::default());
    }

    #[test]
    fn trusted_origins_repeat_and_secure_cookies_is_a_switch() {
        let cli = parse(&[
            "--trusted-origin",
            "https://ha.example",
            "--trusted-origin",
            "http://10.0.0.2:8123",
            "--secure-cookies",
        ])
        .unwrap();
        let want = web::Config {
            trusted_origins: vec!["https://ha.example".into(), "http://10.0.0.2:8123".into()],
            secure_cookies: true,
            ..web::Config::default()
        };
        assert_eq!(cli.web(), want);
    }

    #[test]
    fn a_trusted_origin_with_a_path_or_without_a_scheme_is_refused() {
        for origin in ["https://ha.example/", "ha.example", "null"] {
            assert!(parse(&["--trusted-origin", origin]).is_err(), "{origin}");
        }
    }

    #[test]
    fn every_flag_is_read() {
        let cli = parse(&["--listen", "[::]:80", "--data-dir", "/var/lib/sunreye", "--log-level", "trace"])
            .unwrap();
        assert_eq!(cli.listen, "[::]:80".parse().unwrap());
        assert_eq!(cli.data_dir, PathBuf::from("/var/lib/sunreye"));
        assert_eq!(cli.log_level, LogLevel::Trace);
    }

    #[test]
    fn a_flag_without_its_value_is_refused() {
        assert!(parse(&["--listen"]).is_err());
    }

    #[test]
    fn a_port_out_of_range_is_refused() {
        assert!(parse(&["--listen", "127.0.0.1:65536"]).is_err());
    }

    #[test]
    fn a_listen_address_without_a_port_is_refused() {
        assert!(parse(&["--listen", "127.0.0.1"]).is_err());
    }

    #[test]
    fn version_is_not_a_flag() {
        assert!(parse(&["--version"]).is_err());
    }

    #[test]
    fn every_log_level_maps_to_its_tracing_level() {
        let pairs = [
            (LogLevel::Error, tracing::Level::ERROR),
            (LogLevel::Warn, tracing::Level::WARN),
            (LogLevel::Info, tracing::Level::INFO),
            (LogLevel::Debug, tracing::Level::DEBUG),
            (LogLevel::Trace, tracing::Level::TRACE),
        ];
        for (level, expected) in pairs {
            assert_eq!(tracing::Level::from(level), expected);
        }
    }
}
