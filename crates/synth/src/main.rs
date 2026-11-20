//! `sunreye-synth`: generates the reference plant's store for the benchmark (ADR 24).

use std::io::Write as _;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use sunreye_synth::{Options, RETENTION_DAYS, generate, key, plant};

const USAGE: &str = "\
Usage: sunreye-synth --out <dir> [--seed <n>]
       sunreye-synth --key [--seed <n>]

  --out <dir>    the data directory to write core.sqlite into; must not hold one
  --seed <n>     the seed, 1 by default
  --key          prints the cache key of the seed's file and exits
";

/// The span ends here, whenever it is generated, so a seed's file never changes.
const END: &str = "2026-11-01T00:00:00Z";

/// ADR 24's span; the cache key holds only the seed, so a file never covers another.
const YEARS: i64 = 10;

struct Args {
    out: Option<String>,
    seed: u64,
    key: bool,
}

fn parse(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut parsed = Args {
        out: None,
        seed: 1,
        key: false,
    };
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "--out" => parsed.out = Some(value()?),
            "--seed" => parsed.seed = value()?.parse().map_err(|_| "--seed: not a number")?,
            "--key" => parsed.key = true,
            _ => return Err(format!("unknown argument `{arg}`\n{USAGE}")),
        }
    }
    Ok(parsed)
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            // Nothing is left to tell when stderr is gone.
            writeln!(std::io::stderr(), "sunreye-synth: {e}").ok();
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = parse(std::env::args().skip(1))?;
    let mut out = std::io::stdout();
    if args.key {
        return writeln!(out, "{}", key(args.seed)).map_err(|e| e.to_string());
    }
    let dir = args
        .out
        .ok_or_else(|| format!("--out is required\n{USAGE}"))?;
    let end: jiff::Timestamp = END.parse().map_err(|e: jiff::Error| e.to_string())?;
    let start = end
        .to_zoned(jiff::tz::TimeZone::UTC)
        .checked_sub(jiff::Span::new().years(YEARS))
        .map_err(|e| e.to_string())?
        .timestamp();
    let options = Options {
        out: dir.into(),
        from: start.as_second(),
        to: end.as_second(),
        readings: Duration::from_hours(24 * RETENTION_DAYS.unsigned_abs()),
        seed: args.seed,
    };
    let began = Instant::now();
    let summary = generate(&options).map_err(|e| e.to_string())?;
    let seconds = began.elapsed().as_secs_f64();
    let w = &summary.written;
    writeln!(
        out,
        "key {}\nadmin password {:?}\nspan {start} to {end}\nseries {}\npolls {}\nchange points {}\nhourly rollups {}\ndaily rollups {}\nforecast values {}\nbytes {}\nseconds {seconds:.1}",
        key(args.seed),
        plant::PASSWORD,
        w.series,
        w.polls,
        w.points,
        w.hours,
        w.days,
        summary.forecasts,
        summary.bytes,
    )
    .map_err(|e| e.to_string())?;
    for (part, seconds) in &w.seconds {
        writeln!(out, "seconds in {part}: {seconds:.1}").map_err(|e| e.to_string())?;
    }
    Ok(())
}
