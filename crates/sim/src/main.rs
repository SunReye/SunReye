//! A simulator process: serves one oracle case over Modbus TCP, unit 1, until killed. Browser journeys
//! point a device at the address it prints.

#![allow(clippy::print_stdout, reason = "the listening line is how a caller learns the port")]
#![allow(clippy::print_stderr, reason = "a refusal is reported on stderr before the process exits")]

use std::path::PathBuf;
use std::process::ExitCode;

use sunreye_sim::{Simulator, profile_case};

const USAGE: &str = "usage: sunreye-sim --fixtures <dir> --profile <id> --case <name>";

struct Args {
    fixtures: PathBuf,
    profile: String,
    case: String,
}

fn parse(mut args: impl Iterator<Item = String>) -> Option<Args> {
    let (mut fixtures, mut profile, mut case) = (None, None, None);
    while let Some(flag) = args.next() {
        let value = args.next()?;
        match flag.as_str() {
            "--fixtures" => fixtures = Some(PathBuf::from(value)),
            "--profile" => profile = Some(value),
            "--case" => case = Some(value),
            _ => return None,
        }
    }
    Some(Args { fixtures: fixtures?, profile: profile?, case: case? })
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let Some(args) = parse(std::env::args().skip(1)) else {
        eprintln!("{USAGE}");
        return ExitCode::FAILURE;
    };
    let case = match profile_case(&args.fixtures, &args.profile, &args.case) {
        Ok(case) => case,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let sim = match Simulator::start(case.registers, &[1]).await {
        Ok(sim) => sim,
        Err(error) => {
            eprintln!("cannot listen: {error}");
            return ExitCode::FAILURE;
        }
    };
    println!("sunreye-sim listening {}", sim.addr);
    std::future::pending::<()>().await;
    ExitCode::SUCCESS
}
