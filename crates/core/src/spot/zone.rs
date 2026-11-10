//! The bidding zone the spot-price device fetches for (ADR 12): none until the admin chooses one,
//! every change appended to the change log (ADR 19).
//!
//! The spot module owns the `spot_zone` table. The device watches it, so a change applies at once.

use std::sync::Arc;
use std::time::SystemTime;

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::BiddingZone;
use crate::api::{Clock, Code, Problem, ProblemDetails, internal};
use crate::changes::{self, Action, Entry, Subject};
use crate::storage::{Database, Error};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};

/// Whether spot prices are fetched, and for which bidding zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SpotPriceZone {
    /// `null` fetches none.
    zone: Option<BiddingZone>,
}

/// The bidding-zone feature module; clones share one zone.
#[derive(Debug, Clone)]
pub struct SpotZone {
    database: Database,
    current: Arc<watch::Sender<Option<BiddingZone>>>,
}

impl SpotZone {
    /// Reads the stored zone.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn open(database: Database) -> Result<Self, Error> {
        let stored = database.run(read).await?;
        Ok(Self {
            database,
            current: Arc::new(watch::channel(stored).0),
        })
    }

    /// The zone, now and after each change.
    #[must_use]
    pub fn watch(&self) -> watch::Receiver<Option<BiddingZone>> {
        self.current.subscribe()
    }

    /// The zone routes, behind the admin's session.
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(spot_prices, set_spot_prices))
            .with_state((self, clock))
    }
}

fn read(db: &Connection) -> rusqlite::Result<Option<BiddingZone>> {
    let code: Option<String> = db
        .query_row("SELECT zone FROM spot_zone", [], |row| row.get(0))
        .optional()?;
    // A zone a later core stored and this one has no source for fetches nothing.
    Ok(code.and_then(|code| serde_json::from_value(serde_json::Value::String(code)).ok()))
}

fn write(db: &Connection, spot: SpotPriceZone, changed: SystemTime) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    match spot.zone {
        Some(zone) => tx.execute(
            "INSERT INTO spot_zone (id, zone) VALUES (0, ?1)
             ON CONFLICT (id) DO UPDATE SET zone = excluded.zone",
            params![zone.code()],
        )?,
        None => tx.execute("DELETE FROM spot_zone", [])?,
    };
    let entry = Entry {
        subject: Subject::Spot,
        id: 0,
        action: Action::Change,
        state: serde_json::to_value(spot).ok(),
        actor: "admin",
        changed,
        applies_from: changed,
    };
    changes::append(&tx, &entry)?;
    tx.commit()
}

type ZoneState = State<(SpotZone, Clock)>;

/// The bidding zone spot prices are fetched for.
#[utoipa::path(get, path = "/api/v1/spot-prices", responses(
    (status = 200, body = SpotPriceZone),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn spot_prices(State((spot, _)): ZoneState) -> Json<SpotPriceZone> {
    let zone = *spot.current.borrow();
    Json(SpotPriceZone { zone })
}

/// Chooses the bidding zone spot prices are fetched for, or none; the device follows at once.
#[utoipa::path(put, path = "/api/v1/spot-prices", request_body = SpotPriceZone, responses(
    (status = 200, body = SpotPriceZone),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn set_spot_prices(
    State((spot, clock)): ZoneState,
    body: Result<Json<SpotPriceZone>, JsonRejection>,
) -> Result<Json<SpotPriceZone>, Problem> {
    let Json(draft) = body.map_err(|_| BODY)?;
    let changed = clock();
    spot.database
        .run(move |db| write(db, draft, changed))
        .await
        .map_err(internal)?;
    spot.current.send_replace(draft.zone);
    Ok(Json(draft))
}
