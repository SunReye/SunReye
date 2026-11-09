//! Settings writes (ADR 7): the checks a write passes before it reaches a device, the recipe it
//! runs inside its endpoint's task, and the outcome it ends in.
//!
//! [`crate::devices::Devices::write_setting`] is the one funnel; [`run`] is the only code that
//! issues a write.

pub mod log;

use std::time::{Duration, SystemTime};

use axum::http::StatusCode;
use serde::Serialize;
use sunreye_profile::{Profile, ReadBack, Setting, Step};
use utoipa::ToSchema;

use crate::api::{Code, Problem};
use crate::transport::{Client, Endpoint, Error};

/// How a write ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// The read-back holds the requested value.
    Verified,
    /// The read-back holds another value, or the device refused a step before anything was written.
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
    let mut link = Link {
        endpoint,
        client,
        timeout,
        unit: job.unit,
    };
    let mut applied = Applied {
        outcome: Outcome::Unknown,
        before: None,
        after: None,
        failed_step: None,
    };
    let width = usize::from(job.setting.width());
    let Some(read_back) = job.setting.read_back() else {
        // Write-only: nothing to compare with, before or after.
        if let Err(failure) = steps(&mut link, job).await {
            applied.outcome = failure.outcome();
            applied.failed_step = Some(failure.step);
        }
        return applied;
    };
    let Ok(before) = link.read_back(read_back, width).await else {
        return applied;
    };
    applied.before = job.setting.decode(&before);
    if before == job.words {
        applied.outcome = Outcome::Unchanged;
        return applied;
    }
    let result = steps(&mut link, job).await;
    let after = link.read_back(read_back, width).await.ok();
    applied.after = after.as_deref().and_then(|w| job.setting.decode(w));
    applied.outcome = match (&result, after) {
        (Err(failure), _) => failure.outcome(),
        (Ok(()), Some(after)) if after == job.words => Outcome::Verified,
        (Ok(()), Some(_)) => Outcome::Mismatch,
        (Ok(()), None) => Outcome::Unknown,
    };
    applied.failed_step = result.err().map(|failure| failure.step);
    applied
}

/// Where a recipe stopped.
struct Failure {
    /// Counted from 1.
    step: u32,
    error: Error,
    /// An earlier write was acknowledged.
    wrote: bool,
}

impl Failure {
    const fn outcome(&self) -> Outcome {
        match (self.wrote, &self.error) {
            (true, _) => Outcome::Partial,
            (false, Error::Exception(_)) => Outcome::Mismatch,
            (false, _) => Outcome::Unknown,
        }
    }
}

async fn steps(link: &mut Link<'_>, job: &Job) -> Result<(), Failure> {
    let mut wrote = false;
    for (step, number) in job.setting.recipe().iter().zip(1..) {
        let result = match step {
            Step::Write { register } => link.write(*register, &job.words).await,
            Step::WriteBlock {
                register,
                head,
                tail,
            } => {
                let words = [head.as_slice(), &job.words, tail].concat();
                link.write(*register, &words).await
            }
            Step::Rmw { register, mask } => link.rmw(*register, *mask, &job.words).await,
            Step::Delay(pause) => {
                tokio::time::sleep(*pause).await;
                Ok(false)
            }
        };
        match result {
            Ok(written) => wrote |= written,
            Err(error) => {
                return Err(Failure {
                    step: number,
                    error,
                    wrote,
                });
            }
        }
    }
    Ok(())
}

/// The device a recipe talks to, through its endpoint task's client.
struct Link<'a> {
    endpoint: &'a Endpoint,
    client: &'a mut Option<Client>,
    timeout: Duration,
    unit: u8,
}

impl Link<'_> {
    /// Writes `words` from `register`; `Ok(true)` once acknowledged.
    async fn write(&mut self, register: u16, words: &[u16]) -> Result<bool, Error> {
        let unit = self.unit;
        self.exchange(async |c: &mut Client| c.write_registers(unit, register, words).await)
            .await
            .map(|()| true)
    }

    /// Reads `register` afresh and writes it back with the low bits of `words` in the bits `mask`
    /// selects; the value fits the mask, as [`sunreye_profile::Setting::encode`] checked.
    async fn rmw(&mut self, register: u16, mask: u16, words: &[u16]) -> Result<bool, Error> {
        let [current] = self.read(register, 1).await?[..] else {
            return Err(Error::Protocol("a masked register is one word"));
        };
        let value = words.first().copied().unwrap_or_default() << mask.trailing_zeros();
        self.write(register, &[current & !mask | value & mask])
            .await
    }

    /// The fields `read_back` selects of `width` registers.
    async fn read_back(&mut self, read_back: ReadBack, width: usize) -> Result<Vec<u16>, Error> {
        let words = self.read(read_back.register, width).await?;
        Ok(words.into_iter().map(|w| read_back.field(w)).collect())
    }

    /// `width` holding registers from `start`.
    async fn read(&mut self, start: u16, width: usize) -> Result<Vec<u16>, Error> {
        let unit = self.unit;
        let mut words = vec![0; width];
        self.exchange(async |c: &mut Client| c.read_holding(unit, start, &mut words).await)
            .await?;
        Ok(words)
    }

    /// One request, connected first when there is no client. An error other than an exception
    /// drops the connection: the wire may hold half a reply.
    async fn exchange(
        &mut self,
        request: impl AsyncFnOnce(&mut Client) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let connected = match self.client {
            Some(connected) => connected,
            None => self
                .client
                .insert(Client::connect(self.endpoint, self.timeout).await?),
        };
        let result = request(connected).await;
        if matches!(result, Err(ref e) if !matches!(e, Error::Exception(_))) {
            *self.client = None;
        }
        result
    }
}

#[cfg(test)]
mod tests;
