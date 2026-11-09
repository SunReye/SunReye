//! The built-in SunSpec binding over a client (ADR 5): the identify probe and, at connect, the
//! chain its read plan compiles from.

pub use sunreye_profile::sunspec::PROFILE;
use sunreye_profile::sunspec::{Chain, Discovery, Next};

use crate::transport::{Client, Error};

/// The SunSpec model chain of `unit`, or `None` when it holds no SunSpec map. A refused read is
/// an answer; every other error ends the discovery.
///
/// # Errors
/// A timeout, an I/O error or a reply that does not frame the request: reconnect.
pub async fn discover(client: &mut Client, unit: u8) -> Result<Option<Chain>, Error> {
    let mut discovery = Discovery::new();
    let mut words = [0; 2];
    loop {
        match discovery.next() {
            Next::Read { start, count } => {
                let words = words
                    .get_mut(..usize::from(count))
                    .ok_or(Error::Protocol("count out of range"))?;
                match client.read_holding(unit, start, words).await {
                    Ok(()) => discovery.answer(Some(words)),
                    Err(Error::Exception(_)) => discovery.answer(None),
                    Err(e) => return Err(e),
                }
            }
            Next::Found(chain) => return Ok(Some(chain)),
            Next::Absent => return Ok(None),
        }
    }
}

#[cfg(test)]
mod tests;
