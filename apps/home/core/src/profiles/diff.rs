//! What an update changes (ADR 8): the settings and quantities it adds, removes or changes.

use serde::Serialize;
use sunreye_profile::Profile;
use utoipa::ToSchema;

use crate::settings::Declared;

/// A served profile and the update waiting for it, as the admin reviews it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Update {
    pub id: String,
    /// The version served.
    pub from: String,
    /// The version the update serves.
    pub to: String,
    /// The settings it changes, in the served profile's order, then those it adds.
    pub settings: Vec<SettingChange>,
    /// The quantities it changes, in the same order.
    pub quantities: Vec<QuantityChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Delta {
    Added,
    Removed,
    /// Any part of its declaration differs.
    Changed,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SettingChange {
    pub key: String,
    pub change: Delta,
    pub before: Option<Declared>,
    pub after: Option<Declared>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct QuantityChange {
    pub key: String,
    pub change: Delta,
}

impl Update {
    #[must_use]
    pub fn between(from: &Profile, to: &Profile) -> Self {
        let settings = changes(
            from.settings(),
            to.settings(),
            |s| &s.key,
            |key, change, before, after| SettingChange {
                key: key.to_owned(),
                change,
                before: before.map(Declared::from),
                after: after.map(Declared::from),
            },
        );
        let quantities = changes(
            from.quantities(),
            to.quantities(),
            |q| &q.key,
            |key, change, _, _| QuantityChange {
                key: key.to_owned(),
                change,
            },
        );
        Self {
            id: to.id.clone(),
            from: from.version.clone(),
            to: to.version.clone(),
            settings,
            quantities,
        }
    }

    /// The settings it adds or changes: each needs the admin's enable once applied.
    #[must_use]
    pub fn touched(&self) -> Vec<String> {
        self.settings
            .iter()
            .filter(|s| s.change != Delta::Removed)
            .map(|s| s.key.clone())
            .collect()
    }
}

/// The items of `from` that `to` removes or changes, then those it adds, by key. Declarations
/// compare by their debug form, which covers every field.
fn changes<T: std::fmt::Debug, C>(
    from: &[T],
    to: &[T],
    key: impl Fn(&T) -> &str,
    change: impl Fn(&str, Delta, Option<&T>, Option<&T>) -> C,
) -> Vec<C> {
    let mut changes = Vec::new();
    for old in from {
        match to.iter().find(|new| key(new) == key(old)) {
            None => changes.push(change(key(old), Delta::Removed, Some(old), None)),
            Some(new) if format!("{old:?}") != format!("{new:?}") => {
                changes.push(change(key(old), Delta::Changed, Some(old), Some(new)));
            }
            Some(_) => {}
        }
    }
    for new in to
        .iter()
        .filter(|new| from.iter().all(|old| key(old) != key(new)))
    {
        changes.push(change(key(new), Delta::Added, None, Some(new)));
    }
    changes
}
