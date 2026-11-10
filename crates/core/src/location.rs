//! The plant's location (ADR 17): set by the admin, stored to 0.01°, every change appended to the
//! change log (ADR 19).
//!
//! The location module owns the `location` table. The weather device and the solar forecast watch
//! it, so a change applies at once.

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

use crate::api::{Clock, Code, Problem, ProblemDetails, internal};
use crate::changes::{self, Action, Entry, Subject};
use crate::storage::{Database, Error};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::LocationNone,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::LocationValue,
};
/// Who sets the location: the one admin (ADR 9).
const ACTOR: &str = "admin";

/// The plant's location in degrees, north and east positive.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}

impl Location {
    /// To 0.01° (about 1 km), as it is stored and may leave the home.
    #[must_use]
    pub fn rounded(self) -> Self {
        let round = |degrees: f64| (degrees * 100.0).round() / 100.0;
        Self {
            latitude: round(self.latitude),
            longitude: round(self.longitude),
        }
    }
}

/// The location feature module; clones share one location.
#[derive(Debug, Clone)]
pub struct PlantLocation {
    database: Database,
    current: Arc<watch::Sender<Option<Location>>>,
}

impl PlantLocation {
    /// Reads the stored location.
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

    /// The location, now and after each change.
    #[must_use]
    pub fn watch(&self) -> watch::Receiver<Option<Location>> {
        self.current.subscribe()
    }

    /// Sets the location at `changed`, rounded to 0.01°.
    ///
    /// # Errors
    /// A coordinate off the globe, or the file cannot be written.
    pub async fn set(&self, location: Location, changed: SystemTime) -> Result<Location, Problem> {
        let on_globe = (-90.0..=90.0).contains(&location.latitude)
            && (-180.0..=180.0).contains(&location.longitude);
        if !on_globe {
            return Err(VALUE);
        }
        let location = location.rounded();
        self.database
            .run(move |db| write(db, location, changed))
            .await
            .map_err(internal)?;
        self.current.send_replace(Some(location));
        Ok(location)
    }

    /// The location routes, behind the admin's session.
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(location, set_location))
            .with_state((self, clock))
    }
}

fn read(db: &Connection) -> rusqlite::Result<Option<Location>> {
    db.query_row("SELECT latitude, longitude FROM location", [], |row| {
        Ok(Location {
            latitude: row.get(0)?,
            longitude: row.get(1)?,
        })
    })
    .optional()
}

fn write(db: &Connection, location: Location, changed: SystemTime) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO location (id, latitude, longitude) VALUES (0, ?1, ?2)
         ON CONFLICT (id) DO UPDATE SET latitude = excluded.latitude,
         longitude = excluded.longitude",
        params![location.latitude, location.longitude],
    )?;
    let entry = Entry {
        subject: Subject::Location,
        id: 0,
        action: Action::Change,
        state: serde_json::to_value(location).ok(),
        actor: ACTOR,
        changed,
        applies_from: changed,
    };
    changes::append(&tx, &entry)?;
    tx.commit()
}

type LocationState = State<(PlantLocation, Clock)>;

/// The plant's location.
#[utoipa::path(get, path = "/api/v1/location", responses(
    (status = 200, body = Location),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn location(State((location, _)): LocationState) -> Result<Json<Location>, Problem> {
    let current = *location.current.borrow();
    current.map(Json).ok_or(NONE)
}

/// Sets the plant's location, stored to 0.01°; the weather and solar forecasts follow at once.
#[utoipa::path(put, path = "/api/v1/location", request_body = Location, responses(
    (status = 200, body = Location),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn set_location(
    State((location, clock)): LocationState,
    body: Result<Json<Location>, JsonRejection>,
) -> Result<Json<Location>, Problem> {
    let Json(draft) = body.map_err(|_| BODY)?;
    Ok(Json(location.set(draft, clock()).await?))
}
