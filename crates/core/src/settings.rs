//! Settings writes (ADR 7): the checks a write passes before it reaches a device, the recipe it
//! runs inside its endpoint's task, and the outcome it ends in.
//!
//! [`crate::devices::Devices::write_setting`] is the one funnel; [`run`] is the only code that
//! issues a write.

pub mod enable;
pub mod log;
pub mod publish;
pub mod snapshot;

use std::pin::Pin;
use std::time::{Duration, SystemTime};

use axum::http::StatusCode;
use serde::Serialize;
use sunreye_profile::{Profile, Setting, Source, Step};
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
    /// Refused before the device; nothing was written and the interval does not start.
    Refused,
}

/// Why a write was refused before anything was written.
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
    /// A precondition read from the device does not hold.
    Precondition,
    /// The device's connection holds no secret of the name its unlock step names.
    SecretMissing,
    /// The secret is not a whole number of the unlock step's type.
    SecretValue,
    /// A snapshot toggle released with no value stored to restore.
    NoSnapshot,
    /// The setting needs the admin's enable and has none (ADR 8).
    NotEnabled,
    /// The setting is a community profile's and the admin has not enabled it (ADR 8).
    Community,
}

impl From<Refusal> for Problem {
    fn from(refusal: Refusal) -> Self {
        let (status, code) = match refusal {
            Refusal::None => (StatusCode::NOT_FOUND, Code::SettingNone),
            Refusal::ReadOnly => (StatusCode::CONFLICT, Code::SettingReadOnly),
            Refusal::Value => (StatusCode::UNPROCESSABLE_ENTITY, Code::SettingValue),
            Refusal::WritesOff => (StatusCode::CONFLICT, Code::SettingWritesOff),
            Refusal::Interval => (StatusCode::TOO_MANY_REQUESTS, Code::SettingInterval),
            Refusal::Precondition => (StatusCode::CONFLICT, Code::SettingPrecondition),
            Refusal::SecretMissing => (StatusCode::CONFLICT, Code::SecretMissing),
            Refusal::SecretValue => (StatusCode::UNPROCESSABLE_ENTITY, Code::SecretValue),
            Refusal::NoSnapshot => (StatusCode::CONFLICT, Code::SettingNoSnapshot),
            Refusal::NotEnabled => (StatusCode::CONFLICT, Code::SettingNotEnabled),
            Refusal::Community => (StatusCode::CONFLICT, Code::SettingCommunity),
        };
        Self { status, code }
    }
}

/// Whether a setting may be written, as far as trust goes (ADR 8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Enable {
    /// An official setting verified on hardware: it writes with no enable.
    Verified,
    /// The admin enabled it as it is declared now.
    On,
    /// An official setting that needs the admin's enable.
    Off,
    /// A community profile's setting that needs the admin's enable.
    Community,
}

/// Where `setting` stands, as far as trust goes (ADR 8).
#[derive(Debug, Clone, Copy)]
pub struct Standing<'a> {
    /// Its profile is official.
    pub official: bool,
    /// An applied update added or changed it.
    pub changed: bool,
    /// The fingerprint the admin enabled it with, if at all.
    pub enabled: Option<&'a str>,
}

impl Enable {
    #[must_use]
    pub fn of(setting: &Setting, standing: Standing<'_>) -> Self {
        let Standing {
            official,
            changed,
            enabled,
        } = standing;
        if official && setting.verified() && !changed {
            Self::Verified
        } else if enabled == Some(enable::fingerprint(setting).as_str()) {
            Self::On
        } else if official {
            Self::Off
        } else {
            Self::Community
        }
    }
}

/// A setting's declared values: what a write may carry.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Declared {
    /// The bounds of a value; absent when `values` lists them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Bounds>,
    /// The only values it takes, when the profile enumerates them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<f64>>,
    /// A value is a whole number of steps.
    pub step: f64,
}

/// The inclusive bounds of a setting's value.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, ToSchema)]
pub struct Bounds {
    pub min: f64,
    pub max: f64,
}

impl From<&Setting> for Declared {
    fn from(setting: &Setting) -> Self {
        Self {
            range: setting.range().map(|(min, max)| Bounds { min, max }),
            values: setting.values().map(<[f64]>::to_vec),
            step: setting.step(),
        }
    }
}

/// What lets a device's setting write: the device's switch (ADR 7) and the setting's enable
/// (ADR 8).
#[derive(Debug, Clone, Copy)]
pub struct Permit {
    pub writes: bool,
    pub enable: Enable,
}

/// A write as its actor asks for it.
#[derive(Debug, Clone)]
pub struct Request {
    pub key: String,
    pub value: f64,
    /// `admin`, or a named controller.
    pub actor: &'static str,
    /// The trusted device key a remote write comes through (ADR 16); `None` at home.
    pub via: Option<String>,
}

/// A write that passed its checks: the setting and the words of its value.
#[derive(Debug)]
pub struct Job {
    pub unit: u8,
    pub setting: Setting,
    pub words: Vec<u16>,
    /// The words of the secret its unlock step writes; `None` without one.
    pub unlock: Option<Secret>,
    /// Stores the value read before writing, as a snapshot toggle engages; `None` otherwise.
    pub snapshot: Option<Snapshot>,
}

/// Stores the value read before a write, and reports whether it was stored. Nothing is written
/// unless it was.
#[expect(clippy::type_complexity, reason = "an async callback, named once")]
pub struct Snapshot(
    Box<dyn FnOnce(f64) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>,
);

impl Snapshot {
    pub fn new<F>(store: impl FnOnce(f64) -> F + Send + Sync + 'static) -> Self
    where
        F: Future<Output = bool> + Send + 'static,
    {
        Self(Box::new(move |value| Box::pin(store(value))))
    }
}

impl std::fmt::Debug for Snapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Snapshot(..)")
    }
}

/// The words of a connection's secret. Debug output never shows them, so neither does a log.
#[derive(Clone)]
pub struct Secret(Vec<u16>);

impl Secret {
    #[must_use]
    pub const fn new(words: Vec<u16>) -> Self {
        Self(words)
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(..)")
    }
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

/// Checks `request` against the profile, the device's switch, the setting's enable and its last
/// write.
///
/// # Errors
/// The [`Refusal`] that stops the write.
pub fn check(
    profile: &Profile,
    request: &Request,
    permit: Permit,
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
    if !permit.writes {
        return Err(Refusal::WritesOff);
    }
    match permit.enable {
        Enable::Verified | Enable::On => {}
        Enable::Off => return Err(Refusal::NotEnabled),
        Enable::Community => return Err(Refusal::Community),
    }
    // A clock stepped back behind the last write still waits.
    let since = last.map(|last| now.duration_since(last).unwrap_or(Duration::ZERO));
    if since.is_some_and(|since| since < setting.min_interval()) {
        return Err(Refusal::Interval);
    }
    Ok((setting.clone(), words))
}

/// The words `setting`'s unlock step writes, from `secret`, the value its connection holds under
/// the step's name; `None` without an unlock step.
///
/// # Errors
/// The secret is not set, or is not a code of the step's type.
pub fn unlock(setting: &Setting, secret: Option<&str>) -> Result<Option<Secret>, Refusal> {
    let Some(unlock) = setting.unlock() else {
        return Ok(None);
    };
    let secret = secret.ok_or(Refusal::SecretMissing)?;
    let words = unlock.encode(secret).ok_or(Refusal::SecretValue)?;
    Ok(Some(Secret(words)))
}

/// Runs `job` on `client`, connecting to `endpoint` when it has none.
///
/// Preconditions are read first. A step that fails stops the recipe and is never retried; the
/// value is then read back once more, on a fresh connection if the wire may hold half a reply.
///
/// # Errors
/// [`Refusal::Precondition`] when a precondition does not hold; nothing was written.
pub async fn run(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    timeout: Duration,
    mut job: Job,
) -> Result<Applied, Refusal> {
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
    if let Some(unread) = preconditions(&mut link, &job).await? {
        // Nothing was written; the device's state is unchanged but unconfirmed.
        applied.failed_step = Some(unread);
        return Ok(applied);
    }
    let width = usize::from(job.setting.width());
    let Some(read_back) = job.setting.read_back() else {
        // Write-only: nothing to compare with, before or after.
        if let Err(failure) = steps(&mut link, &job).await {
            applied.outcome = failure.outcome();
            applied.failed_step = Some(failure.step);
        }
        return Ok(applied);
    };
    let Ok(before) = link.read_back(read_back, width).await else {
        return Ok(applied);
    };
    applied.before = job.setting.decode(&before);
    if before == job.words {
        applied.outcome = Outcome::Unchanged;
        return Ok(applied);
    }
    if !snapshot(job.snapshot.take(), applied.before).await {
        return Ok(applied);
    }
    let result = steps(&mut link, &job).await;
    let after = link.read_back(read_back, width).await.ok();
    applied.after = after.as_deref().and_then(|w| job.setting.decode(w));
    applied.outcome = match (&result, after) {
        (Err(failure), _) => failure.outcome(),
        (Ok(()), Some(after)) if after == job.words => Outcome::Verified,
        (Ok(()), Some(_)) => Outcome::Mismatch,
        (Ok(()), None) => Outcome::Unknown,
    };
    applied.failed_step = result.err().map(|failure| failure.step);
    Ok(applied)
}

/// Stores `before` through `snapshot`, if any: before the write, so a release can restore it
/// whatever the write's outcome. `false` when it was not stored and nothing may be written.
async fn snapshot(snapshot: Option<Snapshot>, before: Option<f64>) -> bool {
    match (snapshot, before) {
        (None, _) => true,
        (Some(Snapshot(store)), Some(value)) => store(value).await,
        (Some(_), None) => false,
    }
}

/// Reads every precondition; the step, counted from 1, of one that cannot be read.
async fn preconditions(link: &mut Link<'_>, job: &Job) -> Result<Option<u32>, Refusal> {
    for (step, number) in job.setting.recipe().iter().zip(1..) {
        let Step::Precondition { source, values } = step else {
            continue;
        };
        let Source::Register(field) = source else {
            return Ok(Some(number));
        };
        let read = link.read(field.register, 1).await;
        let Ok([word]) = read.as_deref() else {
            return Ok(Some(number));
        };
        if !values.contains(&field.extract(*word)) {
            return Err(Refusal::Precondition);
        }
    }
    Ok(None)
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

/// Runs the recipe, then its relock once the unlock was sent, even after a failure. Nothing is
/// retried. A failing relock is named counting on from the recipe's last step.
async fn steps(link: &mut Link<'_>, job: &Job) -> Result<(), Failure> {
    let mut wrote = false;
    let mut unlocked = false;
    let result = recipe(link, job, &mut wrote, &mut unlocked).await;
    if !unlocked {
        return result;
    }
    let mut relocked = Ok(());
    let after = u32::try_from(job.setting.recipe().len()).unwrap_or(u32::MAX);
    for (relock, number) in job.setting.finally().iter().zip(after.saturating_add(1)..) {
        if let Err(error) = link.write(relock.register, &relock.words).await
            && relocked.is_ok()
        {
            relocked = Err(Failure {
                step: number,
                error,
                wrote,
            });
        }
    }
    result.and(relocked)
}

async fn recipe(
    link: &mut Link<'_>,
    job: &Job,
    wrote: &mut bool,
    unlocked: &mut bool,
) -> Result<(), Failure> {
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
            Step::Activate { register, value } => link.write(*register, &[*value]).await,
            Step::Unlock(unlock) => {
                let Some(Secret(code)) = &job.unlock else {
                    return Err(Failure {
                        step: number,
                        error: Error::Protocol("no secret to unlock with"),
                        wrote: *wrote,
                    });
                };
                *unlocked = true;
                // Not a write of the setting: its value is unchanged.
                link.write(unlock.register, code).await.map(|_| false)
            }
            // A precondition was read before the recipe began; a toggle's target is written
            // through the funnel instead.
            Step::Precondition { .. } | Step::SnapshotToggle(_) => Ok(false),
            Step::Delay(pause) => {
                tokio::time::sleep(*pause).await;
                Ok(false)
            }
            Step::Publish { .. } => Err(Error::Protocol("a topic is not a register")),
        };
        match result {
            Ok(written) => *wrote |= written,
            Err(error) => {
                return Err(Failure {
                    step: number,
                    error,
                    wrote: *wrote,
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
    async fn read_back(&mut self, read_back: Source, width: usize) -> Result<Vec<u16>, Error> {
        // A profile reading topics writes through its broker, never here.
        let Source::Register(read_back) = read_back else {
            return Err(Error::Protocol("a topic is not a register"));
        };
        let words = self.read(read_back.register, width).await?;
        Ok(words.into_iter().map(|w| read_back.extract(w)).collect())
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
