//! Replays one oracle case over Modbus TCP until killed, for a harness that polls it from another
//! process. Stdout: `listening <addr>`, then `request <start> <count>` for each request answered.

#![allow(clippy::print_stdout, reason = "the harness reads the address and the requests from stdout")]
#![allow(clippy::print_stderr, reason = "a refusal is reported on stderr")]

use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use sunreye_sim::{Simulator, profile_case};

/// The unit id the oracle's cases answer.
const UNIT: u8 = 1;

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [oracle, profile, case] = args.as_slice() else {
        eprintln!("usage: sunreye-sim <oracle-dir> <profile> <case>");
        return ExitCode::from(2);
    };
    let case = match profile_case(Path::new(oracle), profile, case) {
        Ok(case) => case,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let sim = match Simulator::start(case.registers, &[UNIT]).await {
        Ok(sim) => sim,
        Err(error) => {
            eprintln!("cannot listen: {error}");
            return ExitCode::FAILURE;
        }
    };
    println!("listening {}", sim.addr);
    let mut seen = 0;
    loop {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let log = sim.requests();
        for request in &log[seen..] {
            println!("request {} {}", request.start, request.count);
        }
        seen = log.len();
    }
}
