//! Imported surroundings (ADR 20): the terrain, buildings, trees and ground around the plant,
//! fetched from open map data when the admin asks, by the module's own task (ADR 15).
//!
//! A fetch becomes one document in metres around its centre, kept in the data directory under
//! its SHA-256, which a scene names it by. Neither the document nor the status names the
//! centre, so a viewer who reads them learns no location.

#[cfg(test)]
pub mod fake;
mod png;
mod source;

use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use sunreye_pv as pv;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Code, INTERNAL, Problem, ProblemDetails};
use crate::auth::hex;
use crate::location::Location;

pub use source::{Ask, Https, Overpass, Source, TerrainTiles, Web};

/// The radii an area may reach, in metres.
const RADII: [u16; 3] = [100, 200, 300];

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const RADIUS: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::SurroundingsRadius,
};
const LOCATION: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::SurroundingsLocation,
};
const BUSY: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::SurroundingsBusy,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::SurroundingsNone,
};

/// The sources a core fetches from: the open Terrain Tiles and OpenStreetMap, over HTTPS.
#[must_use]
pub fn open_data() -> Vec<Box<dyn Source>> {
    let web: Arc<dyn Web> = Arc::new(Https);
    vec![
        Box::new(TerrainTiles::new(Arc::clone(&web))),
        Box::new(Overpass::new(web)),
    ]
}

/// The stored documents: `<sha256>.json` in the data directory's `surroundings`, which backups
/// take (ADR 3).
#[derive(Debug, Clone)]
pub struct Documents {
    dir: Arc<PathBuf>,
}

impl Documents {
    /// Documents kept in `dir`, created by the first fetch.
    #[must_use]
    pub fn new(dir: PathBuf) -> Self {
        Self { dir: Arc::new(dir) }
    }

    /// The document named by the SHA-256 `id`; `None` when none is stored under it.
    pub async fn read(&self, id: &str) -> Option<Arc<pv::Imported>> {
        let bytes = self.bytes(id).await.ok()??;
        serde_json::from_slice(&bytes).ok().map(Arc::new)
    }

    /// The stored bytes of `id`; `None` when it is no digest or names nothing.
    async fn bytes(&self, id: &str) -> std::io::Result<Option<Vec<u8>>> {
        let is_digest =
            id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        if !is_digest {
            return Ok(None);
        }
        let path = self.dir.join(format!("{id}.json"));
        match tokio::task::spawn_blocking(move || std::fs::read(path)).await? {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Stores `document` under its SHA-256, which it returns. Blocking.
    fn store(&self, document: &pv::Imported) -> std::io::Result<String> {
        let bytes = serde_json::to_vec(document)?;
        let id = hex(ring::digest::digest(&ring::digest::SHA256, &bytes).as_ref());
        std::fs::create_dir_all(&*self.dir)?;
        let path = self.dir.join(format!("{id}.json"));
        let part = path.with_extension("part");
        std::fs::write(&part, bytes)?;
        std::fs::rename(part, path)?;
        Ok(id)
    }
}

/// What to load: the area's radius, and a more exact centre than the plant's location.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, ToSchema)]
#[schema(as = SurroundingsLoad)]
#[serde(deny_unknown_fields)]
pub struct Load {
    /// 100, 200 or 300 m.
    pub radius: u16,
    /// With `longitude`, where the area is centred instead of the plant's location, which is
    /// stored to 0.01° only. It is sent to the sources and kept nowhere.
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, ToSchema)]
#[schema(as = SurroundingsPhase)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Nothing was loaded since the core started.
    #[default]
    Idle,
    Fetching,
    Ready,
    Failed,
}

/// The last load.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, ToSchema)]
pub struct SurroundingsStatus {
    pub state: Phase,
    /// The SHA-256 of the last document fetched; a failed load keeps it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<String>,
    /// Why the last load failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The surroundings feature module; clones share one, and dropping the last stops its task.
#[derive(Clone)]
pub struct Surroundings(Arc<Inner>);

struct Inner {
    documents: Documents,
    location: watch::Receiver<Option<Location>>,
    status: Arc<Mutex<SurroundingsStatus>>,
    wanted: mpsc::UnboundedSender<pv::Area>,
    task: JoinHandle<()>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Surroundings {
    /// Starts the task that fetches from `sources` into `dir`; a load without a centre of its
    /// own is centred on `location`. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(
        dir: PathBuf,
        sources: Vec<Box<dyn Source>>,
        location: watch::Receiver<Option<Location>>,
    ) -> Self {
        let documents = Documents::new(dir);
        let status = Arc::new(Mutex::new(SurroundingsStatus::default()));
        let (wanted, areas) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            areas,
            Arc::new(sources),
            documents.clone(),
            Arc::clone(&status),
        ));
        Self(Arc::new(Inner {
            documents,
            location,
            status,
            wanted,
            task,
        }))
    }

    /// The stored documents, as the layout and the forecast read them.
    #[must_use]
    pub fn documents(&self) -> Documents {
        self.0.documents.clone()
    }

    /// The last load.
    #[must_use]
    pub fn status(&self) -> SurroundingsStatus {
        crate::lock(&self.0.status).clone()
    }

    /// Asks the task to fetch the area; the status tells how it went.
    ///
    /// # Errors
    /// Another radius than 100, 200 or 300 m, no centre given and no location set, a centre off
    /// the globe, or a load still running.
    pub fn load(&self, load: Load) -> Result<SurroundingsStatus, Problem> {
        if !RADII.contains(&load.radius) {
            return Err(RADIUS);
        }
        let centre = match (load.latitude, load.longitude) {
            (Some(latitude), Some(longitude)) => Some(Location {
                latitude,
                longitude,
            }),
            (None, None) => *self.0.location.borrow(),
            _ => None,
        };
        let on_globe = |at: &Location| {
            (-85.0..=85.0).contains(&at.latitude) && (-180.0..=180.0).contains(&at.longitude)
        };
        let centre = centre.filter(on_globe).ok_or(LOCATION)?;
        let mut status = crate::lock(&self.0.status);
        if status.state == Phase::Fetching {
            return Err(BUSY);
        }
        status.state = Phase::Fetching;
        status.error = None;
        let area = pv::Area {
            centre: pv::Location {
                latitude: centre.latitude,
                longitude: centre.longitude,
            },
            radius: f64::from(load.radius),
        };
        // The task lives as long as the module.
        self.0.wanted.send(area).ok();
        Ok(status.clone())
    }

    /// Loading and its status are the admin's; a viewer reads the document the scene names.
    pub fn routes(self) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(status, load))
            .routes(routes!(document))
            .with_state(self)
    }
}

/// Fetches each area asked for, one at a time, and stores what it becomes.
async fn run(
    mut areas: mpsc::UnboundedReceiver<pv::Area>,
    sources: Arc<Vec<Box<dyn Source>>>,
    documents: Documents,
    status: Arc<Mutex<SurroundingsStatus>>,
) {
    while let Some(area) = areas.recv().await {
        let (sources, documents) = (Arc::clone(&sources), documents.clone());
        let stored = tokio::task::spawn_blocking(move || {
            let mut fetched = pv::Fetched::default();
            for source in sources.iter() {
                source.fetch(&area, &mut fetched)?;
            }
            let document = pv::Imported::new(&area, &fetched);
            documents.store(&document).map_err(|e| e.to_string())
        })
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
        let mut status = crate::lock(&status);
        match stored {
            Ok(id) => {
                tracing::info!("surroundings fetched");
                *status = SurroundingsStatus {
                    state: Phase::Ready,
                    document: Some(id),
                    error: None,
                };
            }
            Err(e) => {
                tracing::warn!("surroundings: {e}");
                status.state = Phase::Failed;
                status.error = Some(e);
            }
        }
    }
}

/// How the last load went.
#[utoipa::path(get, path = "/api/v1/surroundings", responses(
    (status = 200, body = SurroundingsStatus),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn status(State(surroundings): State<Surroundings>) -> Json<SurroundingsStatus> {
    Json(surroundings.status())
}

/// Fetches the surroundings of the plant's location, or of a more exact centre, from the open
/// Terrain Tiles and OpenStreetMap into a new document. The answer comes at once; the status
/// tells when the document is ready. Loading again fetches again.
#[utoipa::path(post, path = "/api/v1/surroundings", request_body = Load, responses(
    (status = 202, body = SurroundingsStatus),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn load(
    State(surroundings): State<Surroundings>,
    body: Result<Json<Load>, JsonRejection>,
) -> Result<(StatusCode, Json<SurroundingsStatus>), Problem> {
    let Json(load) = body.map_err(|_| BODY)?;
    Ok((StatusCode::ACCEPTED, Json(surroundings.load(load)?)))
}

/// A fetched document: everything in metres east and north of its centre.
#[utoipa::path(get, path = "/api/v1/surroundings/{id}",
    params(("id" = String, Path, description = "The document's SHA-256 in hex")),
    responses(
        (status = 200, body = pv::Imported),
        (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
async fn document(State(surroundings): State<Surroundings>, Path(id): Path<String>) -> Response {
    match surroundings.0.documents.bytes(&id).await {
        Ok(Some(bytes)) => ([(header::CONTENT_TYPE, "application/json")], bytes).into_response(),
        Ok(None) => NONE.into_response(),
        Err(_) => INTERNAL.into_response(),
    }
}

#[cfg(test)]
mod tests;
