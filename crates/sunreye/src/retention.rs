//! How long each tier is kept, from core settings, and the pass that drops what is older (ADR 0004).

use jiff::Timestamp;

use crate::rollup::Tier;
use crate::settings::positive;
use crate::store::{Store, StoreError};

const TIERS: [Tier; 3] = [Tier::Minute, Tier::Hour, Tier::Day];
const RAW_KEY: &str = "retention.raw_days";
const RAW_DAYS: u64 = 7;

fn key(tier: Tier) -> &'static str {
    match tier {
        Tier::Minute => "retention.minute_days",
        Tier::Hour => "retention.hour_days",
        Tier::Day => "retention.day_days",
    }
}

const fn default_days(tier: Tier) -> Option<u64> {
    match tier {
        Tier::Minute => Some(90),
        Tier::Hour => Some(3650),
        Tier::Day => None,
    }
}

/// Days raw readings are kept. A missing, malformed or non-positive setting is the default.
pub fn raw_days(setting: Option<&str>) -> u64 {
    positive(RAW_KEY, setting, "days").unwrap_or(RAW_DAYS)
}

/// Days `tier` is kept; none keeps it forever. A missing, malformed or non-positive setting is the default.
pub fn retention_days(tier: Tier, setting: Option<&str>) -> Option<u64> {
    positive(key(tier), setting, "days").or(default_days(tier))
}

/// Drops the raw readings and each tier's buckets that ended before their retention reaches back from `now`.
pub async fn retain(store: &Store, now: Timestamp) -> Result<(), StoreError> {
    let raw = raw_days(store.setting(RAW_KEY).await?.as_deref());
    store.drop_readings(days_before(now, raw)).await?;
    for tier in TIERS {
        let Some(days) = retention_days(tier, store.setting(key(tier)).await?.as_deref()) else { continue };
        store.drop_buckets(tier, days_before(now, days)).await?;
    }
    Ok(())
}

fn days_before(now: Timestamp, days: u64) -> Timestamp {
    let back = i64::try_from(days).unwrap_or(i64::MAX).saturating_mul(Tier::Day.width_us());
    Timestamp::from_microsecond(now.as_microsecond().saturating_sub(back)).unwrap_or(Timestamp::MIN)
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
    fn raw_keeps_7_days_minutes_90_days_hours_10_years_and_days_forever_by_default() {
        assert_eq!(raw_days(None), 7);
        assert_eq!(retention_days(Tier::Minute, None), Some(90));
        assert_eq!(retention_days(Tier::Hour, None), Some(3650));
        assert_eq!(retention_days(Tier::Day, None), None);
    }

    #[test]
    fn a_positive_setting_replaces_the_default_and_anything_else_falls_back() {
        assert_eq!(retention_days(Tier::Minute, Some("7")), Some(7));
        assert_eq!(retention_days(Tier::Day, Some("1")), Some(1));
        assert_eq!(raw_days(Some("30")), 30);
        for bad in ["0", "-3", "a week", "", "1.5"] {
            assert_eq!(retention_days(Tier::Minute, Some(bad)), Some(90), "{bad:?}");
            assert_eq!(retention_days(Tier::Day, Some(bad)), None, "{bad:?}");
            assert_eq!(raw_days(Some(bad)), 7, "{bad:?}");
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
        for (key, days) in [
            ("retention.raw_days", "2"),
            ("retention.minute_days", "1"),
            ("retention.hour_days", "3"),
            ("retention.day_days", "2"),
        ] {
            store.set_setting(key, days).await.expect("setting");
        }
        retain(&store, at("2026-05-10T00:30:00Z")).await.expect("retain");
        let readings = store.readings(device, 0, i64::MAX).await.expect("readings");
        assert_eq!(
            readings.iter().map(|s| s.at_ms).collect::<Vec<_>>(),
            [at("2026-05-08T06:00:00Z"), at("2026-05-10T00:10:00Z")].map(Timestamp::as_millisecond)
        );
        assert_eq!(starts(&store, Tier::Minute, device).await, [at("2026-05-10T00:10:00Z")]);
        assert_eq!(
            starts(&store, Tier::Hour, device).await,
            [at("2026-05-07T22:00:00Z"), at("2026-05-08T06:00:00Z")]
        );
        assert_eq!(starts(&store, Tier::Day, device).await, [at("2026-05-08T00:00:00Z")]);
    }

    #[tokio::test]
    async fn a_pass_with_the_defaults_keeps_buckets_younger_than_90_days() {
        let (store, device) =
            with_readings(&["2026-05-07T22:00:00Z", "2026-05-08T06:00:00Z", "2026-05-10T00:10:00Z"]).await;
        retain(&store, at("2026-08-05T23:00:00Z")).await.expect("retain");
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings"), [], "raw keeps 7 days");
        assert_eq!(starts(&store, Tier::Minute, device).await.len(), 2, "the 7 May minute is 90 days old");
        assert_eq!(starts(&store, Tier::Hour, device).await.len(), 2);
        assert_eq!(starts(&store, Tier::Day, device).await.len(), 2);
    }

    #[tokio::test]
    async fn a_retention_reaching_before_any_instant_keeps_everything() {
        let (store, device) = with_readings(&["2026-05-07T22:00:00Z", "2026-05-08T06:00:00Z"]).await;
        store.set_setting(key(Tier::Minute), &u64::MAX.to_string()).await.expect("setting");
        retain(&store, at("2026-05-10T00:00:00Z")).await.expect("retain");
        assert_eq!(starts(&store, Tier::Minute, device).await.len(), 2);
    }
}
