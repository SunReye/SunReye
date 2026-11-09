//! v3 metrics to v5 roles through the v3 profile (ADR 18). A v3 metric and a v5 quantity of the
//! same key read the same register, each with its own scale and offset; the conversion goes through
//! the raw register value, so units and signs come out in ADR 4's conventions.

use std::collections::HashMap;

use serde::Deserialize;
use sunreye_profile::Profile;

/// `v5 = v3 · scale + offset`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Linear {
    pub scale: f64,
    pub offset: f64,
}

impl Linear {
    pub const fn apply(self, value: f64) -> f64 {
        value.mul_add(self.scale, self.offset)
    }
}

/// One metric of a v3 profile.
#[derive(Deserialize)]
struct Metric {
    key: String,
    #[serde(default)]
    addresses: Vec<u16>,
    #[serde(default = "one")]
    scale: f64,
    #[serde(default)]
    offset: f64,
}

const fn one() -> f64 {
    1.0
}

#[derive(Deserialize)]
struct Document {
    metrics: Vec<Metric>,
}

/// The v3 metrics `v5` reads, by key: the position of the v5 quantity and the conversion. `None`
/// when `v3` is not a v3 profile.
pub fn conversions(
    v3: &serde_json::Value,
    v5: &Profile,
) -> Option<HashMap<String, (usize, Linear)>> {
    let document = Document::deserialize(v3).ok()?;
    let metrics: HashMap<&str, &Metric> = document
        .metrics
        .iter()
        .map(|m| (m.key.as_str(), m))
        .collect();
    let mut converted: Vec<Option<Linear>> = Vec::new();
    for quantity in v5.quantities() {
        let metric = metrics.get(quantity.key.as_str());
        let linear = match (quantity.linear(), quantity.computed()) {
            (Some((address, scale, offset)), _) => metric
                .filter(|m| m.addresses.first() == Some(&address) && m.scale.abs() > 0.0)
                .map(|m| Linear {
                    scale: scale / m.scale,
                    offset: m.offset.mul_add(-scale / m.scale, offset),
                }),
            (None, Some((inputs, linear))) => metric
                .filter(|m| m.addresses.is_empty())
                .and_then(|_| computed(&converted, &inputs, linear)),
            (None, None) => None,
        };
        converted.push(linear);
    }
    Some(
        v5.quantities()
            .iter()
            .zip(converted)
            .enumerate()
            .filter_map(|(at, (q, linear))| Some((q.key.clone(), (at, linear?))))
            .collect(),
    )
}

/// A computed quantity converts when its inputs share one scale and no offset and it is a sum or
/// difference of them, or when every input is unchanged.
fn computed(converted: &[Option<Linear>], inputs: &[usize], linear: bool) -> Option<Linear> {
    let mut scales = inputs
        .iter()
        .map(|&at| converted.get(at).copied().flatten());
    let first = scales.next()??;
    let uniform = scales.all(|s| s == Some(first)) && first.offset.abs() < f64::EPSILON;
    let unchanged = (first.scale - 1.0).abs() < f64::EPSILON;
    (uniform && (linear || unchanged)).then_some(first)
}
