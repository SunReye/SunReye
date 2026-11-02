//! Device profiles: the official set compiled into the binary, pinned to one revision.
//!
//! `profiles/official.json` bundles the built profile JSON of `SunReye-Official-Profiles` at
//! `source.commit`. Each entry carries the `sha256` of its source file; a test holds the pin against
//! the oracle corpus, which records the same digests.

use std::sync::Arc;

use serde::Deserialize;

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

#[derive(Debug, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub version: String,
    pub metrics: Vec<Metric>,
}

#[derive(Debug, Deserialize)]
pub struct Metric {
    pub key: String,
    pub label: Option<String>,
    pub unit: Option<String>,
    pub group: Option<String>,
    pub scale: f64,
    pub offset: Option<f64>,
    pub range: Option<Range>,
    pub binding: Binding,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

/// Where a metric's value comes from. `Control` metrics are settings the core never writes in 4.0.
#[derive(Debug, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Expr {
    Sum(Vec<String>),
    Diff([String; 2]),
    Scale(String, f64),
    Combine { add: Vec<String>, sub: Option<Vec<String>> },
    Ratio { num: Vec<String>, den: Vec<String>, scale: Option<f64> },
    Clamp { key: String, min: Option<f64>, max: Option<f64> },
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
            Self::Scale(key, _) | Self::Clamp { key, .. } => vec![key.as_str()],
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

    use serde_json::Value;

    use super::*;

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
}
