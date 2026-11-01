//! A Modbus server (TCP or RTU over TCP) for tests, fed by the oracle fixtures in `fixtures/oracle`.
//!
//! [`Simulator`] answers function code 3 from a register map ([`profile_case`] builds one from the
//! profile-decode corpus) and records every request it receives, so a test can assert what the core
//! sent. [`replay`] plays one recorded wire exchange of the transport corpus.

mod fixture;
mod replay;
mod server;

pub use fixture::{
    Exchange, FixtureError, FixtureMetric, ProfileCase, Registers, TransportCase, profile_case, rtu_cases,
    transport_cases,
};
pub use replay::{Replay, replay};
pub use server::{FC_READ_HOLDING, Framing, Request, Simulator};
