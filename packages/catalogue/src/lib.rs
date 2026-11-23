//! The module catalogue and the datasheet catalogue's format, with their checks (ADRs 17, 25,
//! 27). Pure, so `SunReye Plan` builds it for WASM as it does `pv`.

pub mod datasheets;
pub mod modules;
mod sheet;

pub use sheet::{Invalid, Source};

#[cfg(test)]
mod tests;
