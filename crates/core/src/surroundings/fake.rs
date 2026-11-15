//! The web and sources for tests: recorded answers, no network.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use sunreye_pv as pv;

use super::{Ask, Source, Web};

/// Answers each URL with the bytes served for it and keeps what was asked.
#[derive(Debug, Default)]
pub struct Recorded {
    files: Mutex<HashMap<String, Vec<u8>>>,
    asked: Mutex<Vec<Ask>>,
}

impl Recorded {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::default()
    }

    pub fn serve(&self, url: &str, bytes: impl Into<Vec<u8>>) {
        crate::lock(&self.files).insert(url.to_owned(), bytes.into());
    }

    pub fn asked(&self) -> Vec<Ask> {
        crate::lock(&self.asked).clone()
    }
}

impl Web for Recorded {
    fn ask(&self, ask: &Ask) -> Result<Vec<u8>, String> {
        crate::lock(&self.asked).push(ask.clone());
        let file = crate::lock(&self.files).get(&ask.url).cloned();
        file.ok_or_else(|| "not found".to_owned())
    }
}

/// A source that answers every area with `fetched`, failing the fetches listed in `fail`, and
/// keeps the areas asked for.
#[derive(Debug)]
pub struct Fake {
    fetched: pv::Fetched,
    fail: Mutex<Vec<bool>>,
    asked: Arc<Mutex<Vec<pv::Vicinity>>>,
}

impl Fake {
    #[must_use]
    pub fn new(fetched: pv::Fetched, fail: &[bool]) -> (Self, Arc<Mutex<Vec<pv::Vicinity>>>) {
        let asked = Arc::default();
        let source = Self {
            fetched,
            fail: Mutex::new(fail.iter().rev().copied().collect()),
            asked: Arc::clone(&asked),
        };
        (source, asked)
    }
}

impl Source for Fake {
    fn fetch(&self, area: &pv::Vicinity, fetched: &mut pv::Fetched) -> Result<(), String> {
        crate::lock(&self.asked).push(*area);
        if crate::lock(&self.fail).pop() == Some(true) {
            return Err("offline".to_owned());
        }
        fetched.tiles.extend(self.fetched.tiles.iter().cloned());
        fetched
            .map
            .elements
            .extend(self.fetched.map.elements.iter().cloned());
        Ok(())
    }
}
