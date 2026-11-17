//! UTC days, as the weather archive is asked for and learned by (ADR 17). Pure.

use std::time::{SystemTime, UNIX_EPOCH};

use jiff::civil::Date;
use jiff::tz::TimeZone;

/// The UTC day `time` falls on.
pub fn of(time: SystemTime) -> Date {
    jiff::Timestamp::try_from(time)
        .unwrap_or(jiff::Timestamp::UNIX_EPOCH)
        .to_zoned(TimeZone::UTC)
        .date()
}

/// The start of the UTC `day`.
pub fn start(day: Date) -> SystemTime {
    day.to_zoned(TimeZone::UTC)
        .map_or(UNIX_EPOCH, |z| SystemTime::from(z.timestamp()))
}
