//! `GET /api/energy/series`: the statistics page's energy figures on 3.x's path and shape
//! (`apps/server/src/routes/history.ts`), with a `year` bucket 2.x had no query for.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use jiff::Timestamp;
use jiff::tz::TimeZone;
use serde::Deserialize;

use super::history::{Source, source};
use super::rollup::{instant, non_empty};
use super::{ApiError, ApiQuery, ErrorBody};
use crate::plant_zone;
use crate::rollup::Tier;
use crate::run::Core;
use crate::statistics::{self, Cut, Period, PeriodEnergy, Rises, Roles, Source as Counter, View};
use crate::store::{BucketWindow, StoreError};

/// Most rollup buckets one counter read takes: five years of hours fit, as `limit` caps a history read.
const MAX_BUCKETS: i64 = 50_000;

#[derive(Debug, Clone, Copy, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
enum Bucket {
    Hour,
    Day,
    Month,
    Year,
}

impl Bucket {
    /// The period a bar covers and the tier its energy is read from: hours and days from hourly
    /// buckets, which the plant zone cuts; months and years from daily ones, as 2.x read them.
    const fn reading(self) -> (Period, View) {
        match self {
            Self::Hour => (Period::Hour, View::Hour),
            Self::Day => (Period::Day, View::Hour),
            Self::Month => (Period::Month, View::Day),
            Self::Year => (Period::Year, View::Day),
        }
    }
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct SeriesQuery {
    /// Start of the window, RFC 3339, inclusive.
    from: String,
    /// End of the window, RFC 3339, exclusive.
    to: String,
    #[param(inline)]
    bucket: Bucket,
    /// `plant`, or a device's decimal id, retired or not. Without it, the first device in service.
    source: Option<String>,
    /// As `source`, which wins when both are set.
    inverter_id: Option<String>,
}

const fn tier(view: View) -> Tier {
    match view {
        View::Hour => Tier::Hour,
        View::Day => Tier::Day,
    }
}

/// Refuses a window the read would walk more than [`MAX_BUCKETS`] buckets of per counter.
fn refuse_wide(view: View, from: Timestamp, to: Timestamp) -> Result<(), ApiError> {
    let span = (to.as_microsecond() - from.as_microsecond()).max(0);
    let width = view.width_us();
    let buckets = span / width + i64::from(span % width != 0);
    if buckets <= MAX_BUCKETS {
        return Ok(());
    }
    let unit = if view == View::Hour { "hours" } else { "days" };
    Err(ApiError::bad_request(format!("The window holds too many {unit}: ask for {MAX_BUCKETS} at most")))
}

/// The devices a source reads: a plant's history members, one device, or none.
async fn members(core: &Core, wanted: Option<&str>) -> Result<Vec<i64>, StoreError> {
    Ok(match source(core, wanted).await? {
        Source::Nothing => Vec::new(),
        Source::Device(device) => vec![device],
        Source::Plant(plant) => plant.members,
    })
}

/// The roles of the first member whose profile is known, as the plant's other reads fold by.
async fn roles(core: &Core, members: &[i64]) -> Result<Roles, StoreError> {
    let devices = core.store.devices().await?;
    for device in members.iter().filter_map(|id| devices.iter().find(|d| d.id == *id)) {
        if let Some(profile) = core.profile(&device.profile_id).await? {
            return Ok(statistics::roles_of(&profile));
        }
    }
    Ok(Roles::new())
}

/// What a read takes the members' counters over.
struct Read<'a> {
    core: &'a Core,
    members: &'a [i64],
    zone: &'a TimeZone,
    view: View,
    from: Timestamp,
    to: Timestamp,
}

impl Read<'_> {
    /// The rise of one counter in each bucket of the window, per member, each chained from that member's
    /// last bucket before the window: a member joining, falling silent or restarting books only its own.
    async fn rises(&self, counter: &Counter) -> Result<Vec<Rises>, StoreError> {
        let tier = tier(self.view);
        let window = BucketWindow {
            from: self.from,
            to: self.to,
            limit: MAX_BUCKETS.unsigned_abs().try_into().unwrap_or(u32::MAX),
        };
        let mut rises = Vec::with_capacity(self.members.len());
        for device in self.members {
            let before = self.core.store.bucket_before(tier, *device, &counter.key, self.from).await?;
            let within = self.core.store.buckets_between(tier, *device, &counter.key, window).await?;
            rises.push(statistics::rises(counter, self.view, self.zone, before.as_ref(), &within));
        }
        Ok(rises)
    }
}

/// Energy per period of the window, oldest first, zero-filled; the periods are the plant time zone's.
#[utoipa::path(
    get,
    path = "/api/energy/series",
    operation_id = "energySeries",
    params(SeriesQuery),
    responses(
        (status = 200, body = Vec<PeriodEnergy>),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
pub async fn energy_series(
    State(core): State<Arc<Core>>,
    ApiQuery(query): ApiQuery<SeriesQuery>,
) -> Result<Json<Vec<PeriodEnergy>>, ApiError> {
    let (from, to) = (instant("from", &query.from)?, instant("to", &query.to)?);
    let (period, view) = query.bucket.reading();
    refuse_wide(view, from, to)?;
    let zone = plant_zone::plant_zone(&core.store).await?;
    let wanted = non_empty(query.source.as_deref()).or(non_empty(query.inverter_id.as_deref()));
    let members = members(&core, wanted).await?;
    let roles = roles(&core, &members).await?;
    let read = Read { core: &core, members: &members, zone: &zone, view, from, to };
    let mut rises = Vec::new();
    for counter in statistics::sources(&roles, view) {
        rises.extend(read.rises(&counter).await?.into_iter().map(|member| (counter.field, member)));
    }
    let buckets = statistics::totals_by_bucket(rises);
    let cut = Cut { period, zone: &zone, from, to };
    Ok(Json(statistics::energy_series(&cut, &buckets, !statistics::meters_load(&roles))))
}
