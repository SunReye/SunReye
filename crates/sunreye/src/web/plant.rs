//! `GET /api/sources`: what a dashboard may read a series from, in the 3.x `SourcesResponse` shape
//! (`packages/contracts/src/sources/types.ts`). Any session, as 3.x gates it; not on the kiosk allow-list.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use super::{ApiError, ErrorBody};
use crate::plant;
use crate::run::Core;

/// The zone the plant's buckets are cut in: the core keeps none and buckets in UTC.
const TIME_ZONE: &str = "UTC";

#[derive(Debug, Serialize, ToSchema)]
pub struct SourcesResponse {
    plant: PlantSource,
    /// Every device in roster order, retired ones included.
    devices: Vec<SourceView>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlantSource {
    /// The `plant` source's history members by slug; empty when nothing can be summed.
    members: Vec<String>,
    time_zone: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    slug: String,
    name: String,
    profile_id: String,
    role: String,
    retired: bool,
    /// Whether the plant series is read from this device.
    member: bool,
}

/// The plant and every device a series may be read from.
#[utoipa::path(
    get,
    path = "/api/sources",
    operation_id = "listSources",
    responses(
        (status = 200, body = SourcesResponse),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn sources(State(core): State<Arc<Core>>) -> Result<Json<SourcesResponse>, ApiError> {
    let rows = core.store.devices().await?;
    let members: Vec<i64> = plant::members(&rows, false).iter().map(|device| device.id).collect();
    let mut devices = Vec::with_capacity(rows.len());
    for row in &rows {
        let profile_name = core.profile(&row.profile_id).await?.map(|profile| profile.name.clone());
        devices.push(SourceView {
            slug: row.id.to_string(),
            name: row.name.clone().or(profile_name).unwrap_or_else(|| row.profile_id.clone()),
            profile_id: row.profile_id.clone(),
            role: row.role.clone(),
            retired: !row.in_service(),
            member: members.contains(&row.id),
        });
    }
    let plant = PlantSource {
        members: members.iter().map(ToString::to_string).collect(),
        time_zone: TIME_ZONE.to_owned(),
    };
    Ok(Json(SourcesResponse { plant, devices }))
}
