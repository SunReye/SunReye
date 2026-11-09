//! The profile format: loader, decoder, validation and capabilities (ADR 5).

mod decode;
mod document;
mod plan;
mod profile;
mod role;

pub use decode::Registers;
pub use plan::Block;
pub use profile::{LoadError, Profile, Quantity};
pub use role::{RoleKind, Unit};

/// The current schema: the integer version of the profile format.
pub const SCHEMA: u32 = 1;

/// What this build can load: bindings, decoders and computed quantities.
pub const CAPABILITIES: &[&str] = &["modbus", "u16", "i16", "u32", "compute"];

/// The wire framing on a Modbus endpoint, as far as read planning cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    Tcp,
    RtuOverTcp,
    SolarmanV5,
}

impl Framing {
    /// Unmapped registers worth reading to save one round trip.
    ///
    /// A Solarman stick relays each request over its serial link: measured in v4 on one stick at
    /// 199 ms per read busy, 78 ms idle, and about 2 ms per register. 32 stays under the idle
    /// break-even of about 38 registers.
    #[must_use]
    pub const fn gap_tolerance(self) -> u16 {
        match self {
            Self::Tcp | Self::RtuOverTcp => 0,
            Self::SolarmanV5 => 32,
        }
    }
}

#[cfg(test)]
mod tests;
