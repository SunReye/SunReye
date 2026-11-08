//! Device profiles: the official set compiled into the binary, pinned to one revision.
//!
//! `profiles/official.json` bundles the built profile JSON of `SunReye-Official-Profiles` at
//! `source.commit`. Each entry carries the `sha256` of its source file; a test holds the pin against
//! the oracle corpus, which records the same digests.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use utoipa::openapi::{ArrayBuilder, ObjectBuilder, RefOr, Schema, Type};
use utoipa::{PartialSchema, ToSchema};

const BUNDLE: &str = include_str!("../profiles/official.json");

#[derive(Debug, Deserialize)]
pub struct Bundle {
    pub source: Source,
    pub profiles: Vec<Pinned>,
}

#[derive(Debug, Deserialize)]
pub struct Source {
    pub repository: String,
    pub commit: String,
}

#[derive(Debug, Deserialize)]
pub struct Pinned {
    pub sha256: String,
    pub profile: Arc<Profile>,
}

/// A device profile as the core reads it. Serialized, it is what the published profile says of these fields.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct Profile {
    /// Absent reads as the current schema.
    #[serde(rename = "schemaVersion", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub schema_version: Option<u32>,
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    /// Semver of the profile content.
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub declares: Option<Declares>,
    pub metrics: Vec<Metric>,
}

/// What the profile states about hardware no metric implies.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
pub struct Declares {
    #[serde(rename = "backupOutput", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub backup_output: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct Metric {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub label: Option<String>,
    /// Published profiles write `null` for a unitless metric.
    #[schema(required = true)]
    pub unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub group: Option<String>,
    pub scale: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub offset: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub access: Option<Access>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub kind: Option<MetricKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub storage: Option<Storage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub range: Option<Range>,
    #[serde(rename = "enumLabels", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub enum_labels: Option<BTreeMap<i32, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub flow: Option<Flow>,
    pub binding: Binding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
pub enum Access {
    #[serde(rename = "r")]
    Read,
    #[serde(rename = "rw")]
    ReadWrite,
}

/// How a widget treats the metric.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MetricKind {
    Measurement,
    Cumulative,
    Status,
    Setting,
}

/// Where a metric's values are kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Storage {
    Series,
    Config,
    None,
}

/// What the sign of a signed metric means.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct Flow {
    pub positive: String,
    pub negative: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

/// Where a metric's value comes from. `Control` metrics are settings the core never writes in 4.0.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "via", rename_all = "lowercase")]
pub enum Binding {
    Modbus {
        addr: Vec<u16>,
        #[serde(rename = "type")]
        kind: RegisterType,
    },
    Compute {
        expr: Expr,
    },
    Control,
}

/// Where inside a binding the schema fails. An internally tagged enum buffers its content, so the path of
/// a bad `addr`, `type` or `expr` stops at the binding; this reads the same map flat.
pub(crate) fn binding_fault(
    node: &serde_json::Value,
) -> Option<serde_path_to_error::Error<serde_json::Error>> {
    #[derive(Deserialize)]
    #[allow(dead_code, reason = "read only to check the schema")]
    struct Flat {
        via: Via,
        addr: Option<Vec<u16>>,
        #[serde(rename = "type")]
        kind: Option<RegisterType>,
        expr: Option<Expr>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "lowercase")]
    #[allow(dead_code, reason = "read only to check the schema")]
    enum Via {
        Modbus,
        Compute,
        Control,
    }
    serde_path_to_error::deserialize::<_, Flat>(node).err()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
pub enum RegisterType {
    #[serde(rename = "U_WORD")]
    UWord,
    #[serde(rename = "S_WORD")]
    SWord,
    #[serde(rename = "U_DWORD")]
    UDword,
    #[serde(rename = "RAW")]
    Raw,
}

impl Metric {
    /// Read from a device register, as opposed to derived from other metrics.
    pub const fn is_register(&self) -> bool {
        matches!(self.binding, Binding::Modbus { .. })
    }
}

/// A derived value; keys name other metrics, and a key without a value reads as 0.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum Expr {
    Sum(Vec<String>),
    Diff([String; 2]),
    Scale(KeyAndFactor),
    Combine {
        add: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        sub: Option<Vec<String>>,
    },
    Ratio {
        num: Vec<String>,
        den: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        scale: Option<f64>,
    },
    Clamp {
        key: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        min: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        max: Option<f64>,
    },
}

/// `[key, factor]`; utoipa describes a tuple variant as an array of objects, so the pair names itself.
#[derive(Debug, Deserialize, Serialize)]
pub struct KeyAndFactor(pub String, pub f64);

impl ToSchema for KeyAndFactor {}

impl PartialSchema for KeyAndFactor {
    fn schema() -> RefOr<Schema> {
        ArrayBuilder::new()
            .prefix_items([
                ObjectBuilder::new().schema_type(Type::String).build(),
                ObjectBuilder::new().schema_type(Type::Number).build(),
            ])
            .min_items(Some(2))
            .max_items(Some(2))
            .into()
    }
}

impl Expr {
    /// The metric keys the expression reads.
    pub fn inputs(&self) -> Vec<&str> {
        fn keys(list: &[String]) -> Vec<&str> {
            list.iter().map(String::as_str).collect()
        }
        match self {
            Self::Sum(list) => keys(list),
            Self::Diff(pair) => keys(pair),
            Self::Scale(KeyAndFactor(key, _)) | Self::Clamp { key, .. } => vec![key.as_str()],
            Self::Combine { add, sub } => [keys(add), keys(sub.as_deref().unwrap_or_default())].concat(),
            Self::Ratio { num, den, .. } => [keys(num), keys(den)].concat(),
        }
    }
}

impl Bundle {
    /// The profiles this binary ships.
    pub fn official() -> Result<Self, serde_json::Error> {
        serde_json::from_str(BUNDLE)
    }

    pub fn profile(&self, id: &str) -> Option<&Arc<Profile>> {
        self.profiles.iter().map(|p| &p.profile).find(|p| p.id == id)
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{Value, json};

    use super::*;
    use crate::oracle::as_floats;

    fn corpus() -> Vec<Value> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/profile-decode.ndjson");
        let text = std::fs::read_to_string(path).expect("corpus");
        text.lines().map(|line| serde_json::from_str(line).expect("json")).collect()
    }

    #[test]
    fn the_bundle_is_the_revision_the_oracle_was_recorded_from() {
        let bundle = Bundle::official().expect("bundle");
        assert_eq!(bundle.source.repository, "SunReye/SunReye-Official-Profiles");
        assert_eq!(bundle.source.commit.len(), 40);
        let corpus = corpus();
        assert_eq!(bundle.profiles.len(), corpus.len());
        for (pinned, row) in bundle.profiles.iter().zip(&corpus) {
            let want = &row["profile"];
            let got = serde_json::json!({
                "id": pinned.profile.id, "name": pinned.profile.name,
                "manufacturer": pinned.profile.manufacturer, "version": pinned.profile.version,
                "sha256": pinned.sha256,
            });
            assert_eq!(&got, want);
        }
    }

    fn bundle_json() -> Value {
        serde_json::from_str(BUNDLE).expect("bundle")
    }

    fn keep(node: &Value, keys: &[&str]) -> Value {
        let fields = node.as_object().expect("object");
        keys.iter().filter_map(|k| fields.get(*k).map(|v| ((*k).to_owned(), v.clone()))).collect()
    }

    /// What the published profile says of the fields the core models; the legacy `type`/`addresses`,
    /// `computeExpr`, `controlExpr` and `deadband` are not among them.
    fn modelled(profile: &Value) -> Value {
        let mut out =
            keep(profile, &["schemaVersion", "id", "name", "manufacturer", "version", "declares", "metrics"]);
        out["metrics"] = profile["metrics"]
            .as_array()
            .expect("metrics")
            .iter()
            .map(|metric| {
                let mut out = keep(
                    metric,
                    &[
                        "key",
                        "topic",
                        "label",
                        "unit",
                        "group",
                        "scale",
                        "offset",
                        "access",
                        "role",
                        "index",
                        "kind",
                        "storage",
                        "range",
                        "enumLabels",
                        "flow",
                    ],
                );
                let binding = &metric["binding"];
                out["binding"] = match binding["via"].as_str().expect("via") {
                    "modbus" => keep(binding, &["via", "addr", "type"]),
                    "compute" => keep(binding, &["via", "expr"]),
                    _ => keep(binding, &["via"]),
                };
                out
            })
            .collect();
        out
    }

    fn has_null(value: &Value) -> bool {
        match value {
            Value::Null => true,
            Value::Array(items) => items.iter().any(has_null),
            Value::Object(fields) => fields.values().any(has_null),
            _ => false,
        }
    }

    #[test]
    fn a_serialized_profile_says_what_the_published_profile_says() {
        let bundle = Bundle::official().expect("bundle");
        let source = bundle_json();
        for (pinned, raw) in bundle.profiles.iter().zip(source["profiles"].as_array().expect("profiles")) {
            let ours = as_floats(&serde_json::to_value(&*pinned.profile).expect("serialize"));
            let want = as_floats(&modelled(&raw["profile"]));
            for (got, want) in ours["metrics"]
                .as_array()
                .expect("metrics")
                .iter()
                .zip(want["metrics"].as_array().expect("metrics"))
            {
                assert_eq!(got, want, "{} {}", pinned.profile.id, want["key"]);
            }
            assert_eq!(ours, want, "{}", pinned.profile.id);
        }
    }

    /// An absent optional field serializes as absent: `null` would change the fingerprint that decides a
    /// profile's version bump. `unit` is the one field published profiles write as `null`.
    #[test]
    fn an_absent_field_is_omitted_never_null() {
        let sparse = json!({
            "id": "p", "name": "P", "manufacturer": "M", "version": "1.0.0",
            "metrics": [{"key": "k", "unit": null, "scale": 1, "binding": {"via": "control"}}]
        });
        let profile: Profile = serde_json::from_value(sparse.clone()).expect("profile");
        let mut ours = serde_json::to_value(&profile).expect("serialize");
        assert_eq!(as_floats(&ours), as_floats(&sparse));
        ours["metrics"][0].as_object_mut().expect("metric").remove("unit");
        assert!(!has_null(&ours), "{ours}");
    }

    #[test]
    fn every_expression_arm_serializes_as_the_profile_writes_it() {
        let exprs = [
            json!({"sum": ["a", "b"]}),
            json!({"diff": ["a", "b"]}),
            json!({"scale": ["a", 0.5]}),
            json!({"combine": {"add": ["a"], "sub": ["b"]}}),
            json!({"combine": {"add": ["a"]}}),
            json!({"ratio": {"num": ["a"], "den": ["b"], "scale": 100.0}}),
            json!({"ratio": {"num": ["a"], "den": ["b"]}}),
            json!({"clamp": {"key": "a", "min": 0.0}}),
        ];
        for expr in exprs {
            let parsed: Expr = serde_json::from_value(expr.clone()).expect("expr");
            assert_eq!(serde_json::to_value(&parsed).expect("serialize"), expr);
        }
    }
}
