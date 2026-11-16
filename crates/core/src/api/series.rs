//! The series catalog (ADR 22, ADR 9): every device with stored history, present or removed, and
//! its stored series.

use std::collections::BTreeMap;
use std::time::SystemTime;

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use sunreye_profile::RoleKind;
use utoipa::ToSchema;

use super::{Problem, ProblemDetails, internal};
use crate::bus::DeviceId;
use crate::devices::Devices;
use crate::storage::{Catalogued, Reader};
use crate::{plant, spot, tariff, weather};

/// The core's own devices (ADR 15), never removed.
const COMPUTED: [DeviceId; 4] = [weather::DEVICE, plant::DEVICE, tariff::DEVICE, spot::DEVICE];

/// Every device with stored history, by id.
#[derive(Serialize, ToSchema)]
pub struct SeriesCatalog {
    devices: Vec<CatalogDevice>,
}

#[derive(Serialize, ToSchema)]
struct CatalogDevice {
    id: u32,
    /// Its registry name, a removed device's from its tombstone; `null` for a computed device
    /// (ADR 15), which the SPA names by its id, or one removed before tombstones were kept.
    name: Option<String>,
    /// Whether it was removed; its history stays.
    removed: bool,
    /// By name.
    series: Vec<CatalogSeries>,
}

#[derive(Serialize, ToSchema)]
struct CatalogSeries {
    /// Such as `pv.mppt.power[2]`.
    series: String,
    /// `null` for a series last declared before kinds were stored.
    kind: Option<SeriesKind>,
    /// Its symbol, such as `W`, as stored with its history (ADR 3); `null` when it has none.
    unit: Option<String>,
    /// The first stored instant, of a change point or a rollup's start, RFC 3339, UTC.
    first: String,
    /// The last stored instant, a gap's included, RFC 3339, UTC.
    last: String,
}

/// What a series' values are (ADR 4).
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
enum SeriesKind {
    Measurement,
    Counter,
    Status,
    Held,
}

impl From<RoleKind> for SeriesKind {
    fn from(kind: RoleKind) -> Self {
        match kind {
            RoleKind::Measurement => Self::Measurement,
            RoleKind::Counter => Self::Counter,
            RoleKind::Status => Self::Status,
            RoleKind::Held => Self::Held,
        }
    }
}

/// Every device with a stored change point or rollup, present or removed, and each of its
/// stored series with its kind, unit and first and last stored instant. Forecasts are not history
/// and are not listed.
#[utoipa::path(get, path = "/api/v1/series",
    responses(
        (status = 200, body = SeriesCatalog),
        (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
pub async fn catalog(
    State((reader, devices)): State<(Reader, Devices)>,
) -> Result<Json<SeriesCatalog>, Problem> {
    let stored = reader.catalog().await.map_err(internal)?;
    let names: BTreeMap<u32, (String, bool)> = devices
        .names()
        .await
        .map_err(internal)?
        .into_iter()
        .map(|(id, name, removed)| (id, (name, removed)))
        .collect();
    let mut listed: Vec<CatalogDevice> = Vec::new();
    for series in stored {
        let id = series.device.0;
        if listed.last().is_none_or(|d| d.id != id) {
            let known = names.get(&id).cloned();
            listed.push(CatalogDevice {
                id,
                // History the registry and the core's own devices lack is a removed device's.
                removed: known
                    .as_ref()
                    .map_or_else(|| !COMPUTED.contains(&DeviceId(id)), |n| n.1),
                name: known.map(|n| n.0),
                series: Vec::new(),
            });
        }
        if let Some(device) = listed.last_mut() {
            device.series.push(view(series));
        }
    }
    Ok(Json(SeriesCatalog { devices: listed }))
}

fn view(stored: Catalogued) -> CatalogSeries {
    CatalogSeries {
        series: stored.series,
        kind: stored.kind.map(SeriesKind::from),
        unit: stored.unit,
        first: rfc3339(stored.first),
        last: rfc3339(stored.last),
    }
}

fn rfc3339(time: SystemTime) -> String {
    jiff::Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
}
