//! The tariff routes: configuration, so admin only (ADR 9).

use std::time::{Duration, SystemTime};

use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::days::Costs;
use super::{BAND, Band, DAY, Days, Schedule, Tariffs, Version, in_force};
use crate::api::{Clock, Code, Problem, ProblemDetails, internal};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::TariffNone,
};
const RANGE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::HistoryRange,
};
/// The longest range: as many days as history's day tier returns (ADR 9).
const SPAN: Duration = Duration::from_hours(24 * 1498);

impl Tariffs {
    /// The tariff routes.
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(tariff, change_tariff))
            .routes(routes!(reprice))
            .routes(routes!(payback))
            .routes(routes!(invest))
            .routes(routes!(costs))
            .with_state((self, clock))
    }
}

type TariffState = State<(Tariffs, Clock)>;

/// A price on given weekdays for a span of the plant-local wall-clock day. In the hour a DST
/// change skips it never applies; in the hour it repeats it applies twice.
#[derive(Serialize, Deserialize, ToSchema)]
struct BandView {
    /// ISO weekdays, Monday 1 to Sunday 7.
    days: Vec<u8>,
    /// `HH:MM`, from 00:00.
    from: String,
    /// `HH:MM`, up to 24:00; later than `from`.
    to: String,
    /// EUR/kWh.
    price: f64,
}

/// One flow's prices.
#[derive(Serialize, Deserialize, ToSchema)]
struct ScheduleView {
    /// EUR/kWh, signed; charged wherever no band applies.
    price: f64,
    /// Bands of one flow never share a minute of a weekday.
    bands: Vec<BandView>,
}

/// One tariff version, as the API reads it.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct Tariff {
    /// RFC 3339, UTC.
    applies_from: String,
    /// What a kWh bought from the grid costs.
    import: ScheduleView,
    /// What a kWh fed into the grid earns.
    export: ScheduleView,
}

impl From<&Version> for Tariff {
    fn from(version: &Version) -> Self {
        Self {
            applies_from: jiff::Timestamp::try_from(version.applies_from)
                .map(|t| t.to_string())
                .unwrap_or_default(),
            import: (&version.import).into(),
            export: (&version.export).into(),
        }
    }
}

impl From<&Schedule> for ScheduleView {
    fn from(schedule: &Schedule) -> Self {
        Self {
            price: schedule.price,
            bands: schedule
                .bands
                .iter()
                .map(|b| BandView {
                    days: b.days.days(),
                    from: clock_time(b.from),
                    to: clock_time(b.to),
                    price: b.price,
                })
                .collect(),
        }
    }
}

impl TryFrom<ScheduleView> for Schedule {
    type Error = Problem;

    fn try_from(view: ScheduleView) -> Result<Self, Problem> {
        let bands = view
            .bands
            .into_iter()
            .map(|b| {
                Some(Band {
                    days: Days::of(&b.days)?,
                    from: minute(&b.from)?,
                    to: minute(&b.to)?,
                    price: b.price,
                })
            })
            .collect::<Option<_>>()
            .ok_or(BAND)?;
        Ok(Self {
            price: view.price,
            bands,
        })
    }
}

/// `HH:MM` as minutes of the day, 00:00 to 24:00.
fn minute(text: &str) -> Option<u16> {
    let (hours, minutes) = text.split_once(':')?;
    if hours.len() != 2 || minutes.len() != 2 {
        return None;
    }
    let (hours, minutes): (u16, u16) = (hours.parse().ok()?, minutes.parse().ok()?);
    let minute = hours * 60 + minutes;
    (minutes < 60 && minute <= DAY).then_some(minute)
}

fn clock_time(minute: u16) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct At {
    /// RFC 3339; now when absent.
    at: Option<String>,
}

/// The tariff in force at an instant.
#[utoipa::path(get, path = "/api/v1/tariff", params(At), responses(
    (status = 200, body = Tariff),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn tariff(
    State((tariffs, clock)): TariffState,
    at: Result<Query<At>, QueryRejection>,
) -> Result<Json<Tariff>, Problem> {
    let Query(At { at }) = at.map_err(|_| QUERY)?;
    let at = match at {
        Some(at) => instant(&at).ok_or(QUERY)?,
        None => clock(),
    };
    let versions = tariffs.versions().await.map_err(internal)?;
    in_force(&versions, at).map(|v| Json(v.into())).ok_or(NONE)
}

/// A tariff change, applying from an instant on.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct TariffChange {
    /// RFC 3339, not before now; now when absent.
    applies_from: Option<String>,
    import: ScheduleView,
    export: ScheduleView,
}

/// Changes the tariff from an instant on. Editing changes only the future: prices already in force
/// stay as they were.
#[utoipa::path(put, path = "/api/v1/tariff", request_body = TariffChange, responses(
    (status = 200, body = Tariff),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_tariff(
    State((tariffs, clock)): TariffState,
    body: Result<Json<TariffChange>, JsonRejection>,
) -> Result<Json<Tariff>, Problem> {
    let Json(change) = body.map_err(|_| BODY)?;
    let now = clock();
    let applies_from = match change.applies_from {
        Some(text) => instant(&text).ok_or(BODY)?,
        None => now,
    };
    let version = Version {
        applies_from,
        import: change.import.try_into()?,
        export: change.export.try_into()?,
    };
    let version = tariffs.change(version, now).await?;
    Ok(Json((&version).into()))
}

/// A tariff applying from a date, even a past one.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct Reprice {
    /// RFC 3339, within change-point retention.
    applies_from: String,
    import: ScheduleView,
    export: ScheduleView,
}

/// Corrects the past: the tariff applies from its date, and the prices and the `cost.*` rates are
/// rebuilt from then on from stored history. Refused before change-point retention.
#[utoipa::path(post, path = "/api/v1/tariff/reprice", request_body = Reprice, responses(
    (status = 200, body = Tariff),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn reprice(
    State((tariffs, clock)): TariffState,
    body: Result<Json<Reprice>, JsonRejection>,
) -> Result<Json<Tariff>, Problem> {
    let Json(reprice) = body.map_err(|_| BODY)?;
    let version = Version {
        applies_from: instant(&reprice.applies_from).ok_or(BODY)?,
        import: reprice.import.try_into()?,
        export: reprice.export.try_into()?,
    };
    let version = tariffs.reprice(version, clock()).await?;
    Ok(Json((&version).into()))
}

/// The savings so far against the investment, in EUR to the cent.
#[derive(Serialize, ToSchema)]
struct Payback {
    /// What the admin entered; `null` until then.
    investment: Option<f64>,
    /// `cost.savings.rate` summed over every rolled-up hour.
    savings: f64,
    /// What the savings have yet to pay back, none once they have; `null` without an investment.
    remaining: Option<f64>,
}

/// The savings so far against the investment.
#[utoipa::path(get, path = "/api/v1/payback", responses(
    (status = 200, body = Payback),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn payback(State((tariffs, _)): TariffState) -> Result<Json<Payback>, Problem> {
    let (investment, savings) = tariffs.payback().await.map_err(internal)?;
    let cents = |euros: f64| (euros * 100.0).round() / 100.0;
    Ok(Json(Payback {
        investment,
        savings: cents(savings),
        remaining: investment.map(|i| cents((i - savings).max(0.0))),
    }))
}

/// The investment payback is measured against.
#[derive(Serialize, Deserialize, ToSchema)]
struct Investment {
    /// EUR, more than zero.
    amount: f64,
}

/// Sets the investment payback is measured against.
#[utoipa::path(put, path = "/api/v1/investment", request_body = Investment, responses(
    (status = 200, body = Investment),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn invest(
    State((tariffs, clock)): TariffState,
    body: Result<Json<Investment>, JsonRejection>,
) -> Result<Json<Investment>, Problem> {
    let Json(Investment { amount }) = body.map_err(|_| BODY)?;
    tariffs.invest(amount, clock()).await?;
    Ok(Json(Investment { amount }))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Span {
    /// The first instant, RFC 3339: a day starting from it on is read.
    from: String,
    /// The instant after the last, RFC 3339.
    to: String,
}

/// EUR to the cent.
#[derive(Serialize, ToSchema)]
struct Money {
    /// Paid for what was bought.
    paid: f64,
    /// Earned for what was fed in.
    earned: f64,
    /// The bill without the plant less the bill with it.
    saved: f64,
}

impl From<Costs> for Money {
    fn from(costs: Costs) -> Self {
        let Costs {
            paid,
            earned,
            saved,
        } = costs.cents();
        Self {
            paid,
            earned,
            saved,
        }
    }
}

/// One plant-local day's costs.
#[derive(Serialize, ToSchema)]
struct CostDay {
    /// RFC 3339, UTC.
    start: String,
    /// RFC 3339, UTC.
    end: String,
    #[serde(flatten)]
    money: Money,
}

/// The days with rolled-up costs, in order, and their total.
#[derive(Serialize, ToSchema)]
struct CostDays {
    days: Vec<CostDay>,
    total: Money,
}

/// What the plant paid, earned and saved per plant-local day, from the daily rollups of the
/// `cost.*` rates; the current day covers its closed hours.
#[utoipa::path(get, path = "/api/v1/costs", params(Span), responses(
    (status = 200, body = CostDays),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn costs(
    State((tariffs, _)): TariffState,
    span: Result<Query<Span>, QueryRejection>,
) -> Result<Json<CostDays>, Problem> {
    let Query(Span { from, to }) = span.map_err(|_| QUERY)?;
    let range = instant(&from).ok_or(QUERY)?..instant(&to).ok_or(QUERY)?;
    let span = range.end.duration_since(range.start).map_err(|_| RANGE)?;
    if span.is_zero() || span > SPAN {
        return Err(RANGE);
    }
    let days = tariffs.days(range).await.map_err(internal)?;
    let mut total = Costs::default();
    let days = days
        .into_iter()
        .map(|(start, (end, costs))| {
            total = total + costs;
            CostDay {
                start: rfc3339(start),
                end: rfc3339(end),
                money: costs.into(),
            }
        })
        .collect();
    Ok(Json(CostDays {
        days,
        total: total.into(),
    }))
}

fn rfc3339(time: SystemTime) -> String {
    jiff::Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
}

fn instant(text: &str) -> Option<SystemTime> {
    text.parse::<jiff::Timestamp>().ok().map(Into::into)
}
