//! The funnel's adapter for a device behind a broker (ADR 7, 10): a recipe publishes to its
//! topics, and its preconditions and read-back are the retained state the broker's messages left.

use std::time::Duration;

use sunreye_profile::{Setting, Source, Step};

use super::{Applied, Job, Outcome, Refusal, snapshot};
use crate::subscriber::Writer;

/// How long a write waits for the device to republish its state: EVCC does within about 2 s.
pub const READ_BACK: Duration = Duration::from_secs(5);

/// Runs `job` through `writer`, waiting up to `wait` for the read-back.
///
/// Preconditions are read first. A step that fails stops the recipe and is never retried.
///
/// # Errors
/// [`Refusal::Precondition`] when a precondition does not hold; nothing was published.
pub async fn run(mut writer: Writer, mut job: Job, wait: Duration) -> Result<Applied, Refusal> {
    let mut applied = Applied {
        outcome: Outcome::Unknown,
        before: None,
        after: None,
        failed_step: None,
    };
    if let Some(unread) = preconditions(&writer, &job)? {
        applied.failed_step = Some(unread);
        return Ok(applied);
    }
    let Some(read_back) = job.setting.read_back() else {
        // Write-only: nothing to compare with, before or after.
        if let Err(failure) = steps(&writer, &job).await {
            (applied.outcome, applied.failed_step) = failure;
        }
        return Ok(applied);
    };
    // A profile writing registers never reaches a broker.
    let Source::Quantity(at) = read_back else {
        return Ok(applied);
    };
    let Some(before) = writer.held(at) else {
        return Ok(applied);
    };
    applied.before = Some(before);
    if fits(&job.setting, &job.words, before) {
        applied.outcome = Outcome::Unchanged;
        return Ok(applied);
    }
    if !snapshot(job.snapshot.take(), applied.before).await {
        return Ok(applied);
    }
    if let Err(failure) = steps(&writer, &job).await {
        (applied.outcome, applied.failed_step) = failure;
        applied.after = writer.held(at);
        return Ok(applied);
    }
    let (setting, words) = (&job.setting, &job.words);
    applied.after = writer
        .until(at, |value| fits(setting, words, value), wait)
        .await;
    applied.outcome = match applied.after {
        Some(after) if fits(setting, words, after) => Outcome::Verified,
        Some(_) => Outcome::Mismatch,
        None => Outcome::Unknown,
    };
    Ok(applied)
}

/// Whether `value` is the one `words` encode: the equal-value skip compares words (ADR 7).
fn fits(setting: &Setting, words: &[u16], value: f64) -> bool {
    setting.encode(value).as_deref() == Some(words)
}

/// Reads every precondition from the held state; the step, counted from 1, of one not held.
fn preconditions(writer: &Writer, job: &Job) -> Result<Option<u32>, Refusal> {
    for (step, number) in job.setting.recipe().iter().zip(1..) {
        let Step::Precondition { source, values } = step else {
            continue;
        };
        let Source::Quantity(at) = source else {
            return Ok(Some(number));
        };
        let Some(held) = writer.held(*at) else {
            return Ok(Some(number));
        };
        if !values
            .iter()
            .any(|v| f64::from(*v).to_bits() == held.to_bits())
        {
            return Err(Refusal::Precondition);
        }
    }
    Ok(None)
}

/// Publishes each step in turn; on a failure, its outcome and the failing step, counted from 1.
/// Nothing is retried.
async fn steps(writer: &Writer, job: &Job) -> Result<(), (Outcome, Option<u32>)> {
    let value = job.setting.decode(&job.words);
    let payload = value.and_then(|v| job.setting.payload(v));
    let mut wrote = false;
    for (step, number) in job.setting.recipe().iter().zip(1..) {
        let sent = match step {
            Step::Publish { topic } => payload
                .as_deref()
                .is_some_and(|p| writer.publish(topic, p).is_ok()),
            Step::Delay(pause) => {
                tokio::time::sleep(*pause).await;
                continue;
            }
            Step::Precondition { .. } => continue,
            // A profile reading topics declares no register step.
            Step::Write { .. }
            | Step::WriteBlock { .. }
            | Step::Rmw { .. }
            | Step::Activate { .. }
            | Step::Unlock(_)
            | Step::SnapshotToggle(_) => false,
        };
        if !sent {
            let outcome = if wrote {
                Outcome::Partial
            } else {
                Outcome::Unknown
            };
            return Err((outcome, Some(number)));
        }
        wrote = true;
    }
    Ok(())
}
