//! The `/api/profile` manifest: a profile's identity, what its roles say the device can do, and one
//! render-ready entry per metric (`fixtures/oracle/README.md` §2). The dashboard builds itself from it.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use utoipa::ToSchema;

use crate::profile::{Access, Flow, Metric, MetricKind, Profile, Range, Storage};

/// The kind each canonical role prescribes, for a metric that states none. Held against the 2.x role
/// catalog by a test.
const ROLE_KINDS: &[(&str, MetricKind)] = &[
    ("pv.string.power", MetricKind::Measurement),
    ("pv.string.voltage", MetricKind::Measurement),
    ("pv.string.current", MetricKind::Measurement),
    ("pv.total.power", MetricKind::Measurement),
    ("pv.string.energy.today", MetricKind::Cumulative),
    ("pv.string.energy.total", MetricKind::Cumulative),
    ("production.today", MetricKind::Cumulative),
    ("production.total", MetricKind::Cumulative),
    ("battery.soc", MetricKind::Measurement),
    ("battery.power", MetricKind::Measurement),
    ("battery.voltage", MetricKind::Measurement),
    ("battery.current", MetricKind::Measurement),
    ("battery.temperature", MetricKind::Measurement),
    ("battery.mode", MetricKind::Status),
    ("battery.energy.charged.today", MetricKind::Cumulative),
    ("battery.energy.charged.total", MetricKind::Cumulative),
    ("battery.energy.discharged.today", MetricKind::Cumulative),
    ("battery.energy.discharged.total", MetricKind::Cumulative),
    ("grid.power", MetricKind::Measurement),
    ("grid.frequency", MetricKind::Measurement),
    ("grid.phase.voltage", MetricKind::Measurement),
    ("grid.phase.current", MetricKind::Measurement),
    ("grid.phase.power", MetricKind::Measurement),
    ("grid.energy.imported.today", MetricKind::Cumulative),
    ("grid.energy.imported.total", MetricKind::Cumulative),
    ("grid.energy.exported.today", MetricKind::Cumulative),
    ("grid.energy.exported.total", MetricKind::Cumulative),
    ("load.power", MetricKind::Measurement),
    ("load.phase.power", MetricKind::Measurement),
    ("load.phase.voltage", MetricKind::Measurement),
    ("load.phase.current", MetricKind::Measurement),
    ("load.energy.today", MetricKind::Cumulative),
    ("load.energy.total", MetricKind::Cumulative),
    ("backup.power", MetricKind::Measurement),
    ("backup.phase.power", MetricKind::Measurement),
    ("backup.phase.voltage", MetricKind::Measurement),
    ("backup.phase.current", MetricKind::Measurement),
    ("backup.frequency", MetricKind::Measurement),
    ("backup.energy.today", MetricKind::Cumulative),
    ("backup.energy.total", MetricKind::Cumulative),
    ("generator.power", MetricKind::Measurement),
    ("generator.phase.power", MetricKind::Measurement),
    ("generator.phase.voltage", MetricKind::Measurement),
    ("generator.phase.current", MetricKind::Measurement),
    ("generator.energy.today", MetricKind::Cumulative),
    ("generator.energy.total", MetricKind::Cumulative),
    ("ev.charge.power", MetricKind::Measurement),
    ("ev.vehicle.soc", MetricKind::Measurement),
    ("ev.session.energy", MetricKind::Cumulative),
    ("ev.connected", MetricKind::Status),
    ("ev.charging", MetricKind::Status),
    ("optimizer.target.current", MetricKind::Measurement),
    ("optimizer.applied.current", MetricKind::Measurement),
    ("optimizer.threshold.power", MetricKind::Measurement),
    ("optimizer.excess.power", MetricKind::Measurement),
    ("optimizer.local.sink.power", MetricKind::Measurement),
    ("optimizer.headroom.energy", MetricKind::Measurement),
    ("optimizer.surplus.energy", MetricKind::Measurement),
    ("optimizer.soc.envelope", MetricKind::Measurement),
    ("optimizer.soakable.energy", MetricKind::Measurement),
    ("optimizer.unavoidable.energy", MetricKind::Measurement),
    ("optimizer.ev.demand.energy", MetricKind::Measurement),
    ("optimizer.sell.limit.power", MetricKind::Measurement),
    ("optimizer.grid.charge.current", MetricKind::Measurement),
    ("optimizer.state", MetricKind::Status),
    ("optimizer.price.regime", MetricKind::Status),
    ("optimizer.override", MetricKind::Status),
    ("optimizer.ineffective", MetricKind::Status),
    ("optimizer.enabled", MetricKind::Setting),
    ("optimizer.mode", MetricKind::Setting),
    ("optimizer.restore.pending", MetricKind::Status),
    ("inverter.status", MetricKind::Status),
    ("inverter.relay_status", MetricKind::Status),
    ("inverter.temperature.dc", MetricKind::Measurement),
    ("inverter.temperature.ac", MetricKind::Measurement),
    ("inverter.power", MetricKind::Measurement),
    ("inverter.efficiency", MetricKind::Measurement),
    ("setting.battery.max_charge_current", MetricKind::Setting),
    ("setting.battery.max_discharge_current", MetricKind::Setting),
    ("setting.battery.max_grid_charge_current", MetricKind::Setting),
    ("setting.battery.max_charge_power", MetricKind::Setting),
    ("setting.battery.max_discharge_power", MetricKind::Setting),
    ("setting.battery.max_grid_charge_power", MetricKind::Setting),
    ("setting.battery.grid_charge", MetricKind::Setting),
    ("setting.work_mode", MetricKind::Setting),
    ("setting.solar_sell.max_power", MetricKind::Setting),
    ("setting.solar_sell.enabled", MetricKind::Setting),
];

#[derive(Debug, Serialize, ToSchema)]
pub struct InverterManifest {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub capabilities: InverterCapabilities,
    pub metrics: Vec<ManifestMetric>,
}

/// An optional subsystem the roles of a profile show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Feature {
    SolarSell,
    GridCharge,
    TimeOfUse,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools, reason = "one flag per subsystem, serialised as a flat object")]
pub struct InverterCapabilities {
    pub battery: bool,
    /// Distinct PV string indices.
    pub pv_strings: u32,
    /// 1 or 3, from distinct grid phase voltage indices.
    pub phases: u32,
    pub grid: bool,
    pub generator: bool,
    pub backup_load: bool,
    pub features: Vec<Feature>,
    /// Keys of the metrics the profile marks writable.
    pub controls: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct ManifestMetric {
    pub key: String,
    /// MQTT topic suffix.
    pub topic: String,
    pub label: String,
    #[schema(required = true)]
    pub unit: Option<String>,
    pub group: String,
    pub kind: MetricKind,
    pub storage: Storage,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_labels: Option<BTreeMap<i32, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow: Option<Flow>,
}

#[must_use]
pub fn manifest(profile: &Profile) -> InverterManifest {
    InverterManifest {
        id: profile.id.clone(),
        name: profile.name.clone(),
        manufacturer: profile.manufacturer.clone(),
        capabilities: capabilities(profile),
        metrics: profile.metrics.iter().map(metric).collect(),
    }
}

fn role_kind(role: &str) -> Option<MetricKind> {
    ROLE_KINDS.iter().find(|(name, _)| *name == role).map(|(_, kind)| *kind)
}

/// The kind a metric states: itself, its role, being writable, or counting kWh; a measurement otherwise.
fn kind_of(metric: &Metric) -> MetricKind {
    let stated = metric.kind.or_else(|| metric.role.as_deref().and_then(role_kind));
    let derived = || {
        if metric.access == Some(Access::ReadWrite) {
            Some(MetricKind::Setting)
        } else {
            (metric.unit.as_deref() == Some("kWh")).then_some(MetricKind::Cumulative)
        }
    };
    stated.or_else(derived).unwrap_or(MetricKind::Measurement)
}

fn metric(metric: &Metric) -> ManifestMetric {
    let kind = kind_of(metric);
    let default_storage = if kind == MetricKind::Setting { Storage::Config } else { Storage::Series };
    ManifestMetric {
        key: metric.key.clone(),
        topic: metric.topic.clone().unwrap_or_else(|| metric.key.replace('.', "/")),
        label: metric.label.clone().unwrap_or_else(|| metric.key.clone()),
        unit: metric.unit.clone(),
        group: metric.group.clone().unwrap_or_default(),
        kind,
        storage: metric.storage.unwrap_or(default_storage),
        writable: metric.access == Some(Access::ReadWrite),
        role: metric.role.clone(),
        index: metric.index,
        range: metric.range,
        enum_labels: metric.enum_labels.clone(),
        flow: metric.flow.clone(),
    }
}

fn has_role(profile: &Profile, prefix: &str) -> bool {
    profile.metrics.iter().any(|m| m.role.as_deref().is_some_and(|role| role.starts_with(prefix)))
}

/// How many distinct indices the metrics of `role` carry.
fn indices(profile: &Profile, role: &str) -> u32 {
    let seen: BTreeSet<u32> =
        profile.metrics.iter().filter(|m| m.role.as_deref() == Some(role)).filter_map(|m| m.index).collect();
    u32::try_from(seen.len()).unwrap_or(u32::MAX)
}

/// An explicit statement wins; a schema older than 3 could not state one, and its `load.` roles meant a
/// backup output.
fn backup_output(profile: &Profile) -> Option<bool> {
    if profile.schema_version.is_none_or(|version| version >= 3) {
        profile.declares.and_then(|declares| declares.backup_output)
    } else {
        has_role(profile, "load.").then_some(true)
    }
}

fn features(profile: &Profile) -> Vec<Feature> {
    let role = |wanted: &str| profile.metrics.iter().any(|m| m.role.as_deref() == Some(wanted));
    let grouped = profile.metrics.iter().any(|m| m.group.as_deref() == Some("timeofuse"));
    [
        (Feature::SolarSell, role("setting.solar_sell.enabled")),
        (Feature::GridCharge, role("setting.battery.grid_charge")),
        (Feature::TimeOfUse, grouped),
    ]
    .into_iter()
    .filter_map(|(feature, present)| present.then_some(feature))
    .collect()
}

fn capabilities(profile: &Profile) -> InverterCapabilities {
    InverterCapabilities {
        battery: has_role(profile, "battery."),
        pv_strings: indices(profile, "pv.string.power"),
        phases: indices(profile, "grid.phase.voltage").max(1),
        grid: has_role(profile, "grid."),
        generator: has_role(profile, "generator."),
        backup_load: backup_output(profile).unwrap_or_else(|| has_role(profile, "backup.")),
        features: features(profile),
        controls: profile
            .metrics
            .iter()
            .filter(|m| m.access == Some(Access::ReadWrite))
            .map(|m| m.key.clone())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{Value, json};

    use super::*;
    use crate::profile::Bundle;

    fn oracle(file: &str) -> Vec<Value> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle").join(file);
        let text = std::fs::read_to_string(path).expect("corpus");
        text.lines().map(|line| serde_json::from_str(line).expect("json")).collect()
    }

    fn profile(json: &Value) -> Profile {
        serde_json::from_value(json.clone()).expect("profile")
    }

    /// A profile of `metrics`, each `[key, extra fields]`, on `schema`.
    fn profile_of(schema: u32, declares: &Value, metrics: &[Value]) -> Profile {
        let metrics: Vec<Value> = metrics
            .iter()
            .map(|m| {
                let mut metric = json!({"key": "k", "scale": 1, "binding": {"via": "control", "expr": {}}});
                metric.as_object_mut().expect("object").extend(m.as_object().expect("object").clone());
                metric
            })
            .collect();
        profile(&json!({
            "schemaVersion": schema, "id": "p", "name": "P", "manufacturer": "M", "version": "1.0.0",
            "declares": declares, "metrics": metrics
        }))
    }

    /// JSON writes 100 where a float prints 100.0; both are the number 100.
    fn as_floats(value: Value) -> Value {
        match value {
            Value::Number(n) => json!(n.as_f64()),
            Value::Array(items) => items.into_iter().map(as_floats).collect(),
            Value::Object(fields) => fields.into_iter().map(|(k, v)| (k, as_floats(v))).collect(),
            other => other,
        }
    }

    fn served(profile: &Profile) -> Value {
        serde_json::to_value(manifest(profile)).expect("json")
    }

    #[test]
    fn every_official_profile_answers_what_the_2x_engine_answers() {
        let bundle = Bundle::official().expect("bundle");
        let rows = oracle("profile-manifest.ndjson");
        assert_eq!(bundle.profiles.len(), rows.len());
        for (pinned, row) in bundle.profiles.iter().zip(&rows) {
            assert_eq!(row["profile"]["sha256"], json!(pinned.sha256));
            let (ours, theirs) = (as_floats(served(&pinned.profile)), as_floats(row["manifest"].clone()));
            assert_eq!(ours, theirs, "{}", pinned.profile.id);
        }
    }

    #[test]
    fn the_role_kinds_are_the_2x_role_catalog() {
        let [catalog] = oracle("role-kinds.ndjson").try_into().expect("one line");
        let ours: Value = ROLE_KINDS.iter().map(|(role, kind)| ((*role).to_owned(), json!(kind))).collect();
        assert_eq!(ours, catalog);
    }

    #[test]
    fn a_kind_resolves_from_itself_then_its_role_then_access_then_kwh_then_measurement() {
        let kinds = |metrics: &[Value]| -> Vec<Value> {
            served(&profile_of(3, &Value::Null, metrics))["metrics"]
                .as_array()
                .expect("metrics")
                .iter()
                .map(|m| m["kind"].clone())
                .collect()
        };
        let metrics = [
            json!({"kind": "status", "role": "pv.string.power", "access": "rw", "unit": "kWh"}),
            json!({"role": "production.total", "access": "rw"}),
            json!({"access": "rw", "unit": "kWh"}),
            json!({"unit": "kWh"}),
            json!({"unit": "W"}),
            json!({"role": "not.a.role"}),
        ];
        assert_eq!(
            kinds(&metrics),
            ["status", "cumulative", "setting", "cumulative", "measurement", "measurement"]
        );
    }

    #[test]
    fn storage_is_stated_or_config_for_a_setting_and_series_for_anything_else() {
        let storages: Vec<Value> = served(&profile_of(
            3,
            &Value::Null,
            &[
                json!({"access": "rw"}),
                json!({"access": "rw", "storage": "series"}),
                json!({"storage": "none"}),
                json!({}),
            ],
        ))["metrics"]
            .as_array()
            .expect("metrics")
            .iter()
            .map(|m| m["storage"].clone())
            .collect();
        assert_eq!(storages, ["config", "series", "none", "series"]);
    }

    #[test]
    fn a_metric_without_a_topic_or_label_falls_back_to_its_key() {
        let served = served(&profile_of(3, &Value::Null, &[json!({"key": "dc.pv1.power"})]));
        let metric = &served["metrics"][0];
        assert_eq!((&metric["topic"], &metric["label"]), (&json!("dc/pv1/power"), &json!("dc.pv1.power")));
        assert_eq!(metric["unit"], Value::Null);
        assert_eq!(metric["group"], "");
    }

    #[test]
    fn a_profile_without_roles_has_one_phase_and_nothing_else() {
        let capabilities = &served(&profile_of(3, &Value::Null, &[json!({})]))["capabilities"];
        assert_eq!(
            capabilities,
            &json!({
                "battery": false, "pvStrings": 0, "phases": 1, "grid": false, "generator": false,
                "backupLoad": false, "features": [], "controls": []
            })
        );
    }

    #[test]
    fn strings_and_phases_count_distinct_indices() {
        let metrics = [
            json!({"role": "pv.string.power", "index": 1}),
            json!({"role": "pv.string.power", "index": 1}),
            json!({"role": "pv.string.power", "index": 3}),
            json!({"role": "pv.string.voltage", "index": 7}),
            json!({"role": "grid.phase.voltage", "index": 1}),
            json!({"role": "grid.phase.voltage"}),
        ];
        let capabilities = &served(&profile_of(3, &Value::Null, &metrics))["capabilities"];
        assert_eq!((&capabilities["pvStrings"], &capabilities["phases"]), (&json!(2), &json!(1)));
    }

    #[test]
    fn features_follow_their_rules_in_a_fixed_order_and_controls_are_the_writable_keys() {
        let metrics = [
            json!({"key": "a", "group": "timeofuse"}),
            json!({"key": "b", "role": "setting.battery.grid_charge", "access": "rw"}),
            json!({"key": "c", "role": "setting.solar_sell.enabled", "access": "rw"}),
        ];
        let capabilities = &served(&profile_of(3, &Value::Null, &metrics))["capabilities"];
        assert_eq!(capabilities["features"], json!(["solar_sell", "grid_charge", "time_of_use"]));
        assert_eq!(capabilities["controls"], json!(["b", "c"]));
    }

    #[test]
    fn a_backup_output_is_declared_on_schema_3_and_implied_by_load_roles_before_it() {
        let load = [json!({"role": "load.power"})];
        let backup = [json!({"role": "backup.power"})];
        let flag = |schema, declares: &Value, metrics: &[Value]| {
            served(&profile_of(schema, declares, metrics))["capabilities"]["backupLoad"].clone()
        };
        assert_eq!(flag(2, &Value::Null, &load), true, "v2: load roles mean a backup output");
        assert_eq!(flag(3, &Value::Null, &load), false, "v3: silence means none");
        assert_eq!(flag(3, &json!({"backupOutput": true}), &load), true);
        assert_eq!(flag(3, &json!({"backupOutput": false}), &backup), false, "a declaration wins");
        assert_eq!(flag(3, &Value::Null, &backup), true, "a metered backup output");
        assert_eq!(flag(2, &Value::Null, &[json!({})]), false);
    }

    #[test]
    fn range_enum_labels_and_flow_appear_only_when_stated() {
        let full = served(&profile_of(
            3,
            &Value::Null,
            &[json!({
                "range": {"min": -5, "max": 100.5},
                "enumLabels": {"-1": "Fault", "0": "Idle"},
                "flow": {"positive": "Charging", "negative": "Discharging"}
            })],
        ));
        let metric = &full["metrics"][0];
        assert_eq!(metric["range"], json!({"min": -5.0, "max": 100.5}));
        assert_eq!(metric["enumLabels"], json!({"-1": "Fault", "0": "Idle"}));
        assert_eq!(metric["flow"], json!({"positive": "Charging", "negative": "Discharging"}));
        let bare = served(&profile_of(3, &Value::Null, &[json!({})]));
        for field in ["range", "enumLabels", "flow", "role", "index"] {
            assert!(bare["metrics"][0].get(field).is_none(), "{field}");
        }
    }
}
