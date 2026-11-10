//! Uploaded car bodies (ADR 20): GLB files the admin uploads for a car place, kept in the data
//! directory under their SHA-256, which the scene names them by.
//!
//! The browser parses them, so the core admits only a well-formed glTF 2.0 container whose
//! buffers and images are embedded: a `uri` anywhere could make a viewer's browser fetch it.

use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt as _;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Code, INTERNAL, Problem, ProblemDetails, internal};
use crate::auth::hex;

/// The largest upload, in bytes.
pub const MAX: usize = 20 * 1024 * 1024;
const GLB: &str = "model/gltf-binary";
const HEADER: usize = 12;
const CHUNK: usize = 8;
const JSON_CHUNK: u32 = 0x4E4F_534A;

const SIZE: Problem = Problem {
    status: StatusCode::PAYLOAD_TOO_LARGE,
    code: Code::CarSize,
};
const FILE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::CarFile,
};
const URI: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::CarUri,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::CarNone,
};
const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};

/// The car bodies feature module: the directory they are kept in.
#[derive(Debug, Clone)]
pub struct CarBodies {
    dir: Arc<PathBuf>,
}

impl CarBodies {
    /// Bodies kept in `dir`, created on the first upload; backups include it (ADR 20).
    #[must_use]
    pub fn new(dir: PathBuf) -> Self {
        Self { dir: Arc::new(dir) }
    }

    /// Uploading is the admin's; reading is a viewer's, who sees the scene.
    pub fn routes(self) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(upload))
            .routes(routes!(body))
            .with_state(self)
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.glb"))
    }
}

/// A stored body's id.
#[derive(Serialize, ToSchema)]
struct Uploaded {
    /// Its SHA-256 in hex.
    id: String,
}

/// Stores a GLB of at most 20 MB with every buffer and image embedded; the same file twice is
/// one body.
#[utoipa::path(post, path = "/api/v1/car-bodies",
    request_body(content = Vec<u8>, content_type = "model/gltf-binary"),
    responses(
        (status = 201, body = Uploaded),
        (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
async fn upload(
    State(bodies): State<CarBodies>,
    request: Body,
) -> Result<(StatusCode, Json<Uploaded>), Problem> {
    let bytes = capped(request).await?;
    check(&bytes)?;
    let id = hex(ring::digest::digest(&ring::digest::SHA256, &bytes).as_ref());
    let (dir, path) = (Arc::clone(&bodies.dir), bodies.path(&id));
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&*dir)?;
        let part = path.with_extension("part");
        std::fs::write(&part, bytes)?;
        std::fs::rename(part, path)
    })
    .await
    .map_err(internal)?
    .map_err(internal)?;
    Ok((StatusCode::CREATED, Json(Uploaded { id })))
}

/// An uploaded body.
#[utoipa::path(get, path = "/api/v1/car-bodies/{id}",
    params(("id" = String, Path, description = "The body's SHA-256 in hex")),
    responses(
        (status = 200, body = Vec<u8>, content_type = "model/gltf-binary"),
        (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
async fn body(State(bodies): State<CarBodies>, Path(id): Path<String>) -> Response {
    let is_digest = id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !is_digest {
        return NONE.into_response();
    }
    let path = bodies.path(&id);
    match tokio::task::spawn_blocking(move || std::fs::read(path)).await {
        Ok(Ok(bytes)) => ([(header::CONTENT_TYPE, GLB)], bytes).into_response(),
        Ok(Err(e)) if e.kind() == ErrorKind::NotFound => NONE.into_response(),
        _ => INTERNAL.into_response(),
    }
}

/// The request's bytes, refused once they pass [`MAX`] without reading the rest.
async fn capped(request: Body) -> Result<Vec<u8>, Problem> {
    let mut stream = request.into_data_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| BODY)?;
        if bytes.len() + chunk.len() > MAX {
            return Err(SIZE);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// A glTF 2.0 binary container whose first chunk is a JSON document without a `uri`.
fn check(bytes: &[u8]) -> Result<(), Problem> {
    let word = |at: usize| {
        let four = bytes.get(at..at + 4)?;
        Some(u32::from_le_bytes(four.try_into().ok()?))
    };
    let length = |at: usize| word(at).and_then(|n| usize::try_from(n).ok());
    let well_formed = bytes.starts_with(b"glTF")
        && word(4) == Some(2)
        && length(8) == Some(bytes.len())
        && word(HEADER + 4) == Some(JSON_CHUNK);
    if !well_formed {
        return Err(FILE);
    }
    let mut at = HEADER;
    while at < bytes.len() {
        let end = length(at)
            .and_then(|n| (at + CHUNK).checked_add(n))
            .filter(|end| *end <= bytes.len())
            .ok_or(FILE)?;
        at = end;
    }
    let size = length(HEADER).ok_or(FILE)?;
    let start = HEADER + CHUNK;
    let document: Value =
        serde_json::from_slice(bytes.get(start..start + size).ok_or(FILE)?).map_err(|_| FILE)?;
    let version = document
        .pointer("/asset/version")
        .and_then(Value::as_str)
        .ok_or(FILE)?;
    if !version.starts_with("2.") {
        return Err(FILE);
    }
    if names_uri(&document) {
        return Err(URI);
    }
    Ok(())
}

fn names_uri(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.contains_key("uri") || map.values().any(names_uri),
        Value::Array(items) => items.iter().any(names_uri),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => false,
    }
}
