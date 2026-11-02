//! Retention: how long each rollup tier is kept, from core settings, and the pass that drops what is older.

use jiff::Timestamp;

use crate::rollup::Tier;
use crate::store::{Store, StoreError};

const TIERS: [Tier; 3] = [Tier::Minute, Tier::Hour, Tier::Day];
const DAY_US: i64 = 86_400_000_000;

fn key(tier: Tier) -> &'static str {
    match tier {
        Tier::Minute => "retention.minute_days",
        Tier::Hour => "retention.hour_days",
        Tier::Day => "retention.day_days",
    }
}

/// 3.x's retention (`packages/db/src/timescale/policies.sql`).
const fn default_days(tier: Tier) -> Option<i64> {
    match tier {
        Tier::Minute => Some(90),
        Tier::Hour => Some(3650),
        Tier::Day => None,
    }
}

/// Days `tier` is kept; none keeps it forever. A missing, malformed or non-positive setting is the default.
pub fn retention_days(tier: Tier, setting: Option<&str>) -> Option<i64> {
    match setting.map(str::parse::<i64>) {
        Some(Ok(days @ 1..)) => Some(days),
        Some(_) => {
            tracing::warn!(setting = key(tier), "not a positive number of days, using the default");
            default_days(tier)
        }
        None => default_days(tier),
    }
}

/// Drops each tier's buckets that ended before its retention reaches back from `now`.
pub async fn retain(store: &Store, now: Timestamp) -> Result<(), StoreError> {
    for tier in TIERS {
        let Some(days) = retention_days(tier, store.setting(key(tier)).await?.as_deref()) else { continue };
        store.drop_buckets(tier, days_before(now, days)).await?;
    }
    Ok(())
}

fn days_before(now: Timestamp, days: i64) -> Timestamp {
    let cutoff = now.as_microsecond().saturating_sub(days.saturating_mul(DAY_US));
    Timestamp::from_microsecond(cutoff).unwrap_or(Timestamp::MIN)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modbus::Transport;
    use crate::samples::{ClosedMinute, Sample, minute_of};
    use crate::store::{NewConnection, NewDevice};

    fn at(instant: &str) -> Timestamp {
        instant.parse().expect("instant")
    }

    #[test]
    fn minutes_keep_90_days_hours_10_years_and_days_forever_by_default() {
        assert_eq!(retention_days(Tier::Minute, None), Some(90));
        assert_eq!(retention_days(Tier::Hour, None), Some(3650));
        assert_eq!(retention_days(Tier::Day, None), None);
    }

    #[test]
    fn a_positive_setting_replaces_the_default_and_anything_else_falls_back() {
        assert_eq!(retention_days(Tier::Minute, Some("7")), Some(7));
        assert_eq!(retention_days(Tier::Day, Some("1")), Some(1));
        for bad in ["0", "-3", "a week", "", "1.5"] {
            assert_eq!(retention_days(Tier::Minute, Some(bad)), Some(90), "{bad:?}");
            assert_eq!(retention_days(Tier::Day, Some(bad)), None, "{bad:?}");
        }
    }

    async fn with_readings(instants: &[&str]) -> (Store, i64) {
        let store = Store::in_memory().await.expect("store");
        let connection =
            NewConnection { transport: Transport::Tcp, host: "h".into(), port: 502, logger_serial: None };
        let connection = store.add_connection(&connection).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: "p".into(), unit_id: 1 };
        let device = store.add_device(&device).await.expect("device");
        for instant in instants {
            let sample = Sample { at_ms: at(instant).as_millisecond(), values: vec![("power".into(), 1.0)] };
            let minute = ClosedMinute { minute: minute_of(sample.at_ms), samples: vec![sample] };
            store.append_minute(device, &minute).await.expect("append");
        }
        (store, device)
    }

    async fn starts(store: &Store, tier: Tier, device: i64) -> Vec<Timestamp> {
        store.buckets(tier, device, "power").await.expect("buckets").iter().map(|b| b.start).collect()
    }

    #[tokio::test]
    async fn a_pass_drops_each_tier_past_its_own_retention() {
        let (store, device) =
            with_readings(&["2026-05-07T22:00:00Z", "2026-05-08T06:00:00Z", "2026-05-10T00:10:00Z"]).await;
        for (tier, days) in [(Tier::Minute, "1"), (Tier::Hour, "2"), (Tier::Day, "3")] {
            store.set_setting(key(tier), days).await.expect("setting");
        }
        retain(&store, at("2026-05-10T00:30:00Z")).await.expect("retain");
        assert_eq!(starts(&store, Tier::Minute, device).await, [at("2026-05-10T00:10:00Z")]);
        assert_eq!(starts(&store, Tier::Hour, device).await, [at("2026-05-08T06:00:00Z")]);
        assert_eq!(
            starts(&store, Tier::Day, device).await,
            [at("2026-05-07T00:00:00Z"), at("2026-05-08T00:00:00Z")]
        );
    }

    #[tokio::test]
    async fn a_pass_with_the_defaults_keeps_buckets_younger_than_90_days() {
        let (store, device) =
            with_readings(&["2026-05-07T22:00:00Z", "2026-05-08T06:00:00Z", "2026-05-10T00:10:00Z"]).await;
        retain(&store, at("2026-08-05T23:00:00Z")).await.expect("retain");
        assert_eq!(starts(&store, Tier::Minute, device).await.len(), 2, "the 7 May minute is 90 days old");
        assert_eq!(starts(&store, Tier::Hour, device).await.len(), 2);
        assert_eq!(starts(&store, Tier::Day, device).await.len(), 2);
    }

    #[tokio::test]
    async fn a_retention_reaching_before_any_instant_keeps_everything() {
        let (store, device) = with_readings(&["2026-05-07T22:00:00Z", "2026-05-08T06:00:00Z"]).await;
        store.set_setting(key(Tier::Minute), &i64::MAX.to_string()).await.expect("setting");
        retain(&store, at("2026-05-10T00:00:00Z")).await.expect("retain");
        assert_eq!(starts(&store, Tier::Minute, device).await.len(), 2);
    }
}
