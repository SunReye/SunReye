//! WASM exports of the profile crate for the CLI (ADR 5).
//!
//! Strings cross as UTF-8 in linear memory: the host writes into a buffer from `reserve`, a call
//! returns `ptr << 32 | len` of a JSON reply, `{"ok": …}` or `{"error": "…"}`, and the host hands
//! every buffer back to `release`.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sunreye_profile::{Block, Framing, Profile, Registers};

/// Words a device answered from `start` onwards: one run of a register dump.
#[derive(Deserialize)]
struct Run {
    start: u16,
    words: Vec<u16>,
}

/// The schemas and capabilities this build loads.
fn capabilities() -> String {
    reply(Ok(sunreye_profile::SUPPORT))
}

/// The read plan of `profile` at `gap_tolerance`.
fn read_plan(profile: &[u8], gap_tolerance: u32) -> String {
    let gap = u16::try_from(gap_tolerance).unwrap_or(u16::MAX);
    reply(load(profile).map(|p| p.read_plan(gap)))
}

/// The warnings of `profile`: the text the core logs for it.
fn lint(profile: &[u8]) -> String {
    reply(load(profile).map(|p| p.warnings().to_vec()))
}

/// `block` of `profile` as plain blocks.
fn split(profile: &[u8], block: &[u8]) -> String {
    let block = serde_json::from_slice::<Block>(block).map_err(|e| e.to_string());
    reply(load(profile).and_then(|p| block.map(|b| p.split(b))))
}

/// Each quantity's value from a register dump, read through the core's plan: a block the dump does
/// not cover in full counts as unanswered, as a failed read does in the core.
fn decode(profile: &[u8], dump: &[u8]) -> String {
    let runs = serde_json::from_slice::<Vec<Run>>(dump).map_err(|e| e.to_string());
    reply(load(profile).and_then(|p| runs.map(|r| decoded(&p, &r))))
}

fn decoded(profile: &Profile, runs: &[Run]) -> BTreeMap<String, Option<f64>> {
    let dump: HashMap<u16, u16> = runs
        .iter()
        .flat_map(|run| (run.start..=u16::MAX).zip(run.words.iter().copied()))
        .collect();
    let mut registers = Registers::default();
    for block in profile.read_plan(Framing::Tcp.gap_tolerance()) {
        let words: Option<Vec<u16>> = (block.start..)
            .take(usize::from(block.count))
            .map(|address| dump.get(&address).copied())
            .collect();
        if let Some(words) = words {
            registers.answer(block.start, &words);
        }
    }
    let mut values = vec![None; profile.quantities().len()];
    profile.decode(&registers, &mut values);
    profile
        .quantities()
        .iter()
        .map(|q| q.key.clone())
        .zip(values)
        .collect()
}

fn load(profile: &[u8]) -> Result<Profile, String> {
    let text = std::str::from_utf8(profile).map_err(|e| e.to_string())?;
    Profile::load(text).map_err(|e| e.to_string())
}

fn reply<T: Serialize>(result: Result<T, String>) -> String {
    match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "error": error }),
    }
    .to_string()
}

#[expect(
    unsafe_code,
    reason = "WASM exports need unmangled symbols and raw buffers"
)]
mod exports {
    use std::ptr::slice_from_raw_parts_mut;

    /// The schema the profile crate loads.
    #[unsafe(no_mangle)]
    pub const extern "C" fn schema() -> u32 {
        sunreye_profile::SCHEMA
    }

    /// The schemas and capabilities the profile crate loads, as a reply.
    #[unsafe(no_mangle)]
    pub extern "C" fn capabilities() -> u64 {
        leak(super::capabilities())
    }

    /// A zeroed buffer of `len` bytes for the host to write into.
    #[unsafe(no_mangle)]
    pub extern "C" fn reserve(len: usize) -> *mut u8 {
        Box::into_raw(vec![0_u8; len].into_boxed_slice()).cast()
    }

    /// Returns a buffer from `reserve` or a reply.
    ///
    /// # Safety
    /// `ptr` and `len` name one live buffer this module handed out, freed once.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn release(ptr: *mut u8, len: usize) {
        // SAFETY: the caller passes back a boxed slice this module leaked, exactly once.
        drop(unsafe { Box::from_raw(slice_from_raw_parts_mut(ptr, len)) });
    }

    /// # Safety
    /// `profile`/`profile_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn read_plan(
        profile: *const u8,
        profile_len: usize,
        gap_tolerance: u32,
    ) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let profile = unsafe { std::slice::from_raw_parts(profile, profile_len) };
        leak(super::read_plan(profile, gap_tolerance))
    }

    /// # Safety
    /// `profile`/`profile_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn lint(profile: *const u8, profile_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let profile = unsafe { std::slice::from_raw_parts(profile, profile_len) };
        leak(super::lint(profile))
    }

    /// # Safety
    /// Both pointer and length pairs name live buffers from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn decode(
        profile: *const u8,
        profile_len: usize,
        dump: *const u8,
        dump_len: usize,
    ) -> u64 {
        // SAFETY: the caller guarantees both buffers, written through `reserve`.
        let (profile, dump) = unsafe {
            (
                std::slice::from_raw_parts(profile, profile_len),
                std::slice::from_raw_parts(dump, dump_len),
            )
        };
        leak(super::decode(profile, dump))
    }

    /// # Safety
    /// Both pointer and length pairs name live buffers from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn split(
        profile: *const u8,
        profile_len: usize,
        block: *const u8,
        block_len: usize,
    ) -> u64 {
        // SAFETY: the caller guarantees both buffers, written through `reserve`.
        let (profile, block) = unsafe {
            (
                std::slice::from_raw_parts(profile, profile_len),
                std::slice::from_raw_parts(block, block_len),
            )
        };
        leak(super::split(profile, block))
    }

    /// Hands a reply to the host as `ptr << 32 | len`; the host releases it.
    fn leak(reply: String) -> u64 {
        let bytes = reply.into_bytes().into_boxed_slice();
        let len = u64::try_from(bytes.len()).unwrap_or(0);
        let ptr = u64::try_from(Box::into_raw(bytes).cast::<u8>().addr()).unwrap_or(0);
        ptr << 32 | len
    }
}
