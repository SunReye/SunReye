//! Who may reach each route (ADR 9): the one table the guard reads. A route missing here is
//! admin only, and the API tests fail until it is classified.

use axum::http::Method;

/// What a route requires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Access {
    /// Anyone, signed in or not.
    Public,
    /// A viewer, a `read` token, or more.
    Read,
    /// The admin, an `admin` token, or Home Assistant ingress.
    Admin,
}

use Access::{Admin, Public, Read};

/// Method, path as routed, and what it requires.
const ROUTES: &[(Method, &str, Access)] = &[
    (Method::POST, "/api/v1/setup", Public),
    (Method::POST, "/api/v1/login", Public),
    (Method::GET, "/api/v1/session", Read),
    (Method::GET, "/api/v1/live", Read),
    (Method::GET, "/api/v1/problems", Read),
    // EVCC's HTTP custom meter, with a `read` token (ADR 10).
    (Method::GET, "/api/v1/roles/{role}", Read),
    (Method::GET, "/api/v1/capabilities", Read),
    (Method::GET, "/api/v1/devices/{id}/history", Read),
    (Method::GET, "/api/v1/devices/{id}/statistics", Read),
    (Method::GET, "/api/v1/devices/{id}/forecasts", Read),
    // History of the plant's points (ADR 14).
    (Method::GET, "/api/v1/balance", Read),
    // The scene viewers see read-only (ADR 20).
    (Method::GET, "/api/v1/layout", Read),
    (Method::GET, "/api/v1/module-types", Read),
    // Measured against the model, as history; no location (ADR 20).
    (Method::GET, "/api/v1/corrections", Read),
    // Uploaded car bodies the scene names.
    (Method::GET, "/api/v1/car-bodies/{id}", Read),
    (Method::POST, "/api/v1/car-bodies", Admin),
    (Method::PUT, "/api/v1/layout", Admin),
    (Method::POST, "/api/v1/module-types", Admin),
    (Method::GET, "/api/v1/connections", Admin),
    (Method::POST, "/api/v1/connections", Admin),
    (Method::PUT, "/api/v1/connections/{id}", Admin),
    (Method::DELETE, "/api/v1/connections/{id}", Admin),
    (Method::GET, "/api/v1/devices", Admin),
    (Method::POST, "/api/v1/devices", Admin),
    (Method::PUT, "/api/v1/devices/{id}", Admin),
    (Method::DELETE, "/api/v1/devices/{id}", Admin),
    (Method::PUT, "/api/v1/devices/{id}/settings/{key}", Admin),
    (
        Method::PUT,
        "/api/v1/devices/{id}/settings/{key}/enabled",
        Admin,
    ),
    (
        Method::DELETE,
        "/api/v1/devices/{id}/settings/{key}/enabled",
        Admin,
    ),
    (Method::GET, "/api/v1/devices/{id}/deadbands", Admin),
    (Method::PUT, "/api/v1/devices/{id}/deadbands/{role}", Admin),
    (
        Method::DELETE,
        "/api/v1/devices/{id}/deadbands/{role}",
        Admin,
    ),
    (Method::GET, "/api/v1/writes", Admin),
    (Method::POST, "/api/v1/scan", Admin),
    (Method::GET, "/api/v1/location", Admin),
    (Method::PUT, "/api/v1/location", Admin),
    (Method::GET, "/api/v1/timezone", Admin),
    (Method::PUT, "/api/v1/timezone", Admin),
    (Method::GET, "/api/v1/retention", Admin),
    (Method::PUT, "/api/v1/retention", Admin),
    (Method::GET, "/api/v1/spot-prices", Admin),
    (Method::PUT, "/api/v1/spot-prices", Admin),
    (Method::GET, "/api/v1/changes", Admin),
    (Method::GET, "/api/v1/topology", Admin),
    (Method::PUT, "/api/v1/topology", Admin),
    (Method::GET, "/api/v1/tariff", Admin),
    (Method::PUT, "/api/v1/tariff", Admin),
    (Method::POST, "/api/v1/tariff/reprice", Admin),
    (Method::PUT, "/api/v1/investment", Admin),
    // Payback names the investment, which is configuration.
    (Method::GET, "/api/v1/payback", Admin),
    // Profile distribution is configuration (ADR 8, ADR 9).
    (Method::GET, "/api/v1/profile-indexes", Admin),
    (Method::POST, "/api/v1/profile-indexes", Admin),
    (Method::POST, "/api/v1/profile-indexes/check", Admin),
    (Method::GET, "/api/v1/profile-updates", Admin),
    (Method::POST, "/api/v1/profile-updates/{id}", Admin),
    (Method::GET, "/api/v1/viewers", Admin),
    (Method::POST, "/api/v1/viewers", Admin),
    (Method::DELETE, "/api/v1/viewers/{id}", Admin),
    // Import from v3 (ADR 18).
    (Method::GET, "/api/v1/import", Admin),
    (Method::POST, "/api/v1/import", Admin),
    (Method::GET, "/api/v1/import/files", Admin),
    (Method::POST, "/api/v1/import/upload", Admin),
    // Backups hold the whole store (ADR 3).
    (Method::POST, "/api/v1/backups", Admin),
    // A line may name a host (ADR 2).
    (Method::GET, "/api/v1/logs", Admin),
    (Method::GET, "/api/v1/tokens", Admin),
    (Method::POST, "/api/v1/tokens", Admin),
    (Method::DELETE, "/api/v1/tokens/{id}", Admin),
];

/// What the route `path`, as routed with its `{parameters}`, requires for `method`; `None`
/// when it is not classified.
#[must_use]
pub fn access(method: &Method, path: &str) -> Option<Access> {
    ROUTES
        .iter()
        .find(|(m, p, _)| m == method && *p == path)
        .map(|&(_, _, access)| access)
}
