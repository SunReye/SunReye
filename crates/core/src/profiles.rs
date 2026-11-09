//! The profiles the core can read devices with (ADR 8): the official ones bundled at build time.

use std::collections::HashMap;
use std::sync::Arc;

use sunreye_profile::{LoadError, Profile};

/// The official profiles, as `profiles/` holds them at build time.
const BUNDLED: &[&str] = &[include_str!("../../../profiles/deye-sg05lp3.json")];

/// Loaded profiles by id.
#[derive(Debug, Clone, Default)]
pub struct Catalogue(Arc<HashMap<String, Arc<Profile>>>);

impl Catalogue {
    /// Loads the bundled profiles.
    ///
    /// # Errors
    /// A bundled profile does not load in this build.
    pub fn bundled() -> Result<Self, LoadError> {
        let profiles = BUNDLED
            .iter()
            .map(|json| Profile::load(json).map(|p| (p.id.clone(), Arc::new(p))))
            .collect::<Result<_, _>>()?;
        Ok(Self(Arc::new(profiles)))
    }

    #[must_use]
    pub fn get(&self, id: &str) -> Option<Arc<Profile>> {
        self.0.get(id).cloned()
    }
}
