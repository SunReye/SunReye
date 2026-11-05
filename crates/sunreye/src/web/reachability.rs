//! Reachability for the add wizard: whether an endpoint accepts a connection, and which unit id on it
//! answers. Only reads.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::devices::{ModbusParams, UNIT_MAX, added_endpoint, checked_unit, modbus_only, refused};
use super::{ApiError, ApiJson, ErrorBody};
use crate::probe::{EndpointProbe, UnitScan, probe_endpoint, scan_units as scan};
use crate::run::Core;
use crate::settings::{TIMEOUT_KEY, poll_timeout};

/// The ids a scan asks when none are named: a device's factory id, a gateway's own, then where a second
/// device on a shared bus is set. Short, since every miss costs a full timeout.
const SCAN_CANDIDATES: [u8; 6] = [1, 0, 2, 3, 4, 5];
const SCAN_MAX: usize = 16;
/// Per id; a scan waits for a person.
const SCAN_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1500);

/// An endpoint to test, as the connection dialog holds it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ProbeRequest {
    /// `modbus`; the core reaches no other kind.
    kind: String,
    #[schema(value_type = ModbusParams)]
    params: Value,
}

/// Whether something accepts a connection at the endpoint: no unit id, no register read. A failure is a
/// result (`ok: false`), not an error of the request.
#[utoipa::path(
    post,
    path = "/api/connections/probe",
    operation_id = "probeConnection",
    request_body = ProbeRequest,
    responses(
        (status = 200, body = EndpointProbe),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn probe_connection(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<ProbeRequest>,
) -> Result<Json<EndpointProbe>, ApiError> {
    modbus_only(&request.kind)?;
    let endpoint = added_endpoint(request.params)?;
    let timeout = poll_timeout(core.store.setting(TIMEOUT_KEY).await?.as_deref());
    Ok(Json(probe_endpoint(&endpoint, timeout).await))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    /// `modbus`; the core reaches no other kind.
    kind: String,
    #[schema(value_type = ModbusParams)]
    params: Value,
    /// Whose register map the scan reads with.
    profile_id: String,
    /// The ids to ask, in order, at most 16; by default 1, 0, 2, 3, 4, 5.
    #[schema(value_type = Option<Vec<i64>>)]
    candidates: Option<Vec<i64>>,
}

fn checked_candidates(candidates: Option<Vec<i64>>) -> Result<Vec<u8>, ApiError> {
    let Some(candidates) = candidates else { return Ok(SCAN_CANDIDATES.to_vec()) };
    if candidates.is_empty() || candidates.len() > SCAN_MAX {
        return Err(refused("candidates", &format!("a scan asks 1–{SCAN_MAX} unit ids")));
    }
    let ids: Vec<u8> = candidates
        .into_iter()
        .map(checked_unit)
        .collect::<Result<_, _>>()
        .map_err(|_| refused("candidates", &format!("unit id must be 0–{UNIT_MAX}")))?;
    if (1..ids.len()).any(|i| ids[..i].contains(&ids[i])) {
        return Err(refused("candidates", "a unit id may only be scanned once"));
    }
    Ok(ids)
}

/// The first unit id that answers a one-register read with the profile's map. Only reads.
#[utoipa::path(
    post,
    path = "/api/connections/scan-units",
    operation_id = "scanUnits",
    request_body = ScanRequest,
    responses(
        (status = 200, body = UnitScan),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn scan_units(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<ScanRequest>,
) -> Result<Json<UnitScan>, ApiError> {
    modbus_only(&request.kind)?;
    let endpoint = added_endpoint(request.params)?;
    let candidates = checked_candidates(request.candidates)?;
    let Some(profile) = core.profile(&request.profile_id).await? else {
        return Err(refused("profileId", "profile not installed on this server"));
    };
    let found = scan(&profile, &endpoint, &candidates, SCAN_TIMEOUT).await;
    Ok(Json(found.map_err(|error| ApiError::bad_request(error.to_string()))?))
}
