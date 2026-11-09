//! Settings writes (ADR 7): the checks a write passes before it reaches a device, the recipe it
//! runs inside its endpoint's task, and the outcome it ends in.
//!
//! [`crate::devices::Devices::write_setting`] is the one funnel; [`run`] is the only code that
//! issues a write.

pub mod log;

use std::time::{Duration, SystemTime};

use axum::http::StatusCode;
use serde::Serialize;
use sunreye_profile::{Profile, Setting, Step};
use utoipa::ToSchema;

use crate::api::{Code, Problem};
use crate::transport::{Client, Endpoint, Error};

/// How a write ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// The read-back holds the requested value.
    Verified,
    /// The read-back holds another value, or the device refused the first step.
    Mismatch,
    /// The device's state is not known: a step timed out, the read-back failed, or the setting is
    /// write-only.
    Unknown,
    /// A step failed after an earlier one wrote; the device's state is uncertain.
    Partial,
    /// The current value already equals the request; nothing was written.
    Unchanged,
}

/// Why a write was refused before the device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The profile declares no such setting.
    None,
    /// The key is a quantity, read and never written.
    ReadOnly,
    /// The value is outside the range, off the step, not among the values, or does not fit.
    Value,
    /// The device's writes are switched off.
    WritesOff,
    /// The setting's minimum interval has not passed since its last write.
    Interval,
}

impl From<Refusal> for Problem {
    fn from(refusal: Refusal) -> Self {
        let (status, code) = match refusal {
            Refusal::None => (StatusCode::NOT_FOUND, Code::SettingNone),
            Refusal::ReadOnly => (StatusCode::CONFLICT, Code::SettingReadOnly),
            Refusal::Value => (StatusCode::UNPROCESSABLE_ENTITY, Code::SettingValue),
            Refusal::WritesOff => (StatusCode::CONFLICT, Code::SettingWritesOff),
            Refusal::Interval => (StatusCode::TOO_MANY_REQUESTS, Code::SettingInterval),
        };
        Self { status, code }
    }
}

/// A write as its actor asks for it.
#[derive(Debug, Clone)]
pub struct Request {
    pub key: String,
    pub value: f64,
    /// `admin`, or a named controller.
    pub actor: &'static str,
}

/// A write that passed its checks: the setting and the words of its value.
#[derive(Debug, Clone)]
pub struct Job {
    pub unit: u8,
    pub setting: Setting,
    pub words: Vec<u16>,
}

/// What a write did on the device.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Applied {
    pub outcome: Outcome,
    /// The value read before writing.
    pub before: Option<f64>,
    /// The value read back afterwards.
    pub after: Option<f64>,
    /// The recipe step that failed, counted from 1.
    pub failed_step: Option<u32>,
}

/// Checks `request` against the profile, the device's switch and the setting's last write.
///
/// # Errors
/// The [`Refusal`] that stops the write.
pub fn check(
    profile: &Profile,
    request: &Request,
    writes: bool,
    last: Option<SystemTime>,
    now: SystemTime,
) -> Result<(Setting, Vec<u16>), Refusal> {
    let Some(setting) = profile.setting(&request.key) else {
        let read = profile.quantities().iter().any(|q| q.key == request.key);
        return Err(if read {
            Refusal::ReadOnly
        } else {
            Refusal::None
        });
    };
    let words = setting.encode(request.value).ok_or(Refusal::Value)?;
    if !writes {
        return Err(Refusal::WritesOff);
    }
    // A clock stepped back behind the last write still waits.
    let since = last.map(|last| now.duration_since(last).unwrap_or(Duration::ZERO));
    if since.is_some_and(|since| since < setting.min_interval()) {
        return Err(Refusal::Interval);
    }
    Ok((setting.clone(), words))
}

/// Runs `job` on `client`, connecting to `endpoint` when it has none.
///
/// A step that fails stops the recipe and is never retried; the value is then read back once
/// more, on a fresh connection if the wire may hold half a reply.
pub async fn run(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    timeout: Duration,
    job: &Job,
) -> Applied {
    let mut applied = Applied {
        outcome: Outcome::Unknown,
        before: None,
        after: None,
        failed_step: None,
    };
    let Some(read_back) = job.setting.read_back() else {
        // Write-only: nothing to compare with, before or after.
        if let Err((step, error)) = steps(endpoint, client, timeout, job).await {
            applied.outcome = failed(step, &error);
            applied.failed_step = Some(step);
        }
        return applied;
    };
    let Ok(before) = read(endpoint, client, timeout, job, read_back).await else {
        return applied;
    };
    applied.before = job.setting.decode(&before);
    if before == job.words {
        applied.outcome = Outcome::Unchanged;
        return applied;
    }
    let result = steps(endpoint, client, timeout, job).await;
    let after = read(endpoint, client, timeout, job, read_back).await.ok();
    applied.after = after.as_deref().and_then(|w| job.setting.decode(w));
    applied.outcome = match (&result, after) {
        (Err((step, error)), _) => failed(*step, error),
        (Ok(()), Some(after)) if after == job.words => Outcome::Verified,
        (Ok(()), Some(_)) => Outcome::Mismatch,
        (Ok(()), None) => Outcome::Unknown,
    };
    applied.failed_step = result.err().map(|(step, _)| step);
    applied
}

/// The outcome of a recipe that stopped at `step`, counted from 1.
const fn failed(step: u32, error: &Error) -> Outcome {
    match (step, error) {
        (1, Error::Exception(_)) => Outcome::Mismatch,
        (1, _) => Outcome::Unknown,
        _ => Outcome::Partial,
    }
}

async fn steps(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    timeout: Duration,
    job: &Job,
) -> Result<(), (u32, Error)> {
    for (step, number) in job.setting.recipe().iter().zip(1..) {
        let result = match *step {
            Step::Write { register } => {
                let words = &job.words;
                exchange(endpoint, client, timeout, async |c: &mut Client| {
                    c.write_registers(job.unit, register, words).await
                })
                .await
            }
        };
        result.map_err(|error| (number, error))?;
    }
    Ok(())
}

async fn read(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    timeout: Duration,
    job: &Job,
    start: u16,
) -> Result<Vec<u16>, Error> {
    let mut words = vec![0; usize::from(job.setting.width())];
    exchange(endpoint, client, timeout, async |c: &mut Client| {
        c.read_holding(job.unit, start, &mut words).await
    })
    .await?;
    Ok(words)
}

/// One request on `client`, connected first when it has none. An error other than an exception
/// drops the connection: the wire may hold half a reply.
async fn exchange(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    timeout: Duration,
    request: impl AsyncFnOnce(&mut Client) -> Result<(), Error>,
) -> Result<(), Error> {
    let connected = match client {
        Some(connected) => connected,
        None => client.insert(Client::connect(endpoint, timeout).await?),
    };
    let result = request(connected).await;
    if matches!(result, Err(ref e) if !matches!(e, Error::Exception(_))) {
        *client = None;
    }
    result
}

#[cfg(test)]
mod tests;
