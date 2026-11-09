//! Deadbands per device and role (ADR 4): the admin's override, else the profile's, else the
//! role's default, else none.

use std::collections::BTreeMap;
use std::time::SystemTime;

use rusqlite::{Connection, params};
use serde::Serialize;
use sunreye_profile::{DeadbandRefusal, Profile, Quantity};
use utoipa::ToSchema;

use super::{Refusal, entry};
use crate::changes::{self, Action, Subject};
use crate::endpoint::CADENCE;
use crate::storage::Policy;

/// Overrides of one device, by role.
pub type Overrides = BTreeMap<String, f64>;

/// Where a role's deadband comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeadbandSource {
    /// The admin's, for this device.
    Override,
    /// The device's profile, for its hardware.
    Profile,
    /// The role's default by unit.
    Default,
    /// Every change is stored: a counter, an enum, or a role without a default.
    None,
}

/// The deadband a role of a device is stored with.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct RoleDeadband {
    pub role: String,
    /// In the role's unit; `null` stores every change.
    pub deadband: Option<f64>,
    pub source: DeadbandSource,
}

/// How `quantity` is stored, with the deadband `overrides` give its role.
pub fn policy(quantity: &Quantity, overrides: &Overrides) -> Policy {
    let mut policy = Policy::new(quantity.kind(), quantity.unit(), quantity.step(), CADENCE);
    policy.deadband = resolve(quantity, overrides).deadband.unwrap_or(0.0);
    policy
}

/// Each role of `profile`, in its order, with the deadband it is stored with. A role read at
/// several indices shows its first quantity's.
pub fn deadbands(profile: &Profile, overrides: &Overrides) -> Vec<RoleDeadband> {
    let mut deadbands: Vec<RoleDeadband> = Vec::new();
    for quantity in profile.quantities() {
        if !deadbands.iter().any(|d| d.role == quantity.role) {
            deadbands.push(resolve(quantity, overrides));
        }
    }
    deadbands
}

fn resolve(quantity: &Quantity, overrides: &Overrides) -> RoleDeadband {
    let default = Policy::new(quantity.kind(), quantity.unit(), quantity.step(), CADENCE).deadband;
    let (deadband, source) = if let Some(&deadband) = overrides.get(&quantity.role) {
        (Some(deadband), DeadbandSource::Override)
    } else if let Some(deadband) = quantity.deadband() {
        (Some(deadband), DeadbandSource::Profile)
    } else if default > 0.0 {
        (Some(default), DeadbandSource::Default)
    } else {
        (None, DeadbandSource::None)
    };
    RoleDeadband {
        role: quantity.role.clone(),
        deadband,
        source,
    }
}

/// Whether `deadband` may override `role` of `profile`: every quantity of the role admits it.
pub fn check(profile: &Profile, role: &str, deadband: f64) -> Result<(), Refusal> {
    let mut quantities = profile.quantities().iter().filter(|q| q.role == role);
    let first = quantities.next().ok_or(Refusal::DeadbandRole)?;
    for quantity in std::iter::once(first).chain(quantities) {
        quantity.admits(deadband).map_err(|refusal| match refusal {
            DeadbandRefusal::Kind => Refusal::DeadbandKind,
            DeadbandRefusal::Step => Refusal::DeadbandStep,
        })?;
    }
    Ok(())
}

/// The overrides of `device`.
pub fn overrides(db: &Connection, device: u32) -> rusqlite::Result<Overrides> {
    db.prepare_cached("SELECT role, deadband FROM deadband_override WHERE device = ?1")?
        .query_map([device], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

/// Overrides `role` of `device` with `deadband`, or removes its override with `None`, logging
/// the change. Removing none logs nothing.
pub fn set(
    db: &Connection,
    device: u32,
    role: &str,
    deadband: Option<f64>,
    changed: SystemTime,
) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    let had = tx.execute(
        "DELETE FROM deadband_override WHERE device = ?1 AND role = ?2",
        params![device, role],
    )? > 0;
    let (action, state) = match deadband {
        Some(deadband) => {
            tx.execute(
                "INSERT INTO deadband_override (device, role, deadband) VALUES (?1, ?2, ?3)",
                params![device, role, deadband],
            )?;
            let action = if had { Action::Change } else { Action::Add };
            (
                action,
                serde_json::json!({ "role": role, "deadband": deadband }),
            )
        }
        None if had => (Action::Remove, serde_json::json!({ "role": role })),
        None => return Ok(()),
    };
    let entry = entry(Subject::Deadband, device, action, Some(&state), changed);
    changes::append(&tx, &entry)?;
    tx.commit()
}

#[cfg(test)]
mod tests;
