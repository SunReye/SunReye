//! What the SDK generator reads from the core's public surface: every profile the core ships names only
//! roles the catalogue knows, and the document carries the profile types and the role catalogue.

use serde_json::json;
use sunreye::profile::Bundle;
use sunreye::role::{ROLES, find};
use sunreye::web::openapi;

#[test]
fn every_role_an_official_profile_maps_is_in_the_catalogue() {
    let bundle = Bundle::official().expect("bundle");
    for pinned in &bundle.profiles {
        for metric in &pinned.profile.metrics {
            if let Some(role) = metric.role.as_deref() {
                assert!(find(role).is_some(), "{} maps unknown role {role}", pinned.profile.id);
            }
        }
    }
}

#[test]
fn the_document_names_the_roles_in_catalogue_order() {
    let document = serde_json::to_value(openapi()).expect("document");
    let names: Vec<&str> = ROLES.iter().map(|r| r.name).collect();
    assert_eq!(document["components"]["schemas"]["Role"]["enum"], json!(names));
}

#[test]
fn the_document_describes_a_profile_as_the_core_reads_it() {
    let document = serde_json::to_value(openapi()).expect("document");
    let profile = &document["components"]["schemas"]["Profile"];
    assert_eq!(profile["required"], json!(["id", "name", "manufacturer", "version", "metrics"]));
    let metric = &document["components"]["schemas"]["Metric"];
    assert_eq!(metric["required"], json!(["key", "unit", "scale", "binding"]));
}
