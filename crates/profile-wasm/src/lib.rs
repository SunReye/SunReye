//! WASM exports of the profile crate for the CLI (ADR 5).

/// The schema the profile crate loads.
#[expect(unsafe_code, reason = "a WASM export needs an unmangled symbol")]
#[unsafe(no_mangle)]
pub const extern "C" fn schema() -> u32 {
    sunreye_profile::SCHEMA
}
