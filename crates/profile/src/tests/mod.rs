//! Tests through the public interface only.

mod deadband;
mod decode;
mod deye;
mod http;
mod identify;
mod lint;
mod load;
mod plan;
mod publish;
mod setting;
mod step;
mod sunspec;
mod topic;
mod types;
mod unit;

/// Every capability this build loads, for a case that is not about `requires`.
fn all() -> serde_json::Value {
    serde_json::json!(crate::CAPABILITIES)
}

/// Every capability but `name`.
fn all_but(name: &str) -> serde_json::Value {
    let rest: Vec<_> = crate::CAPABILITIES.iter().filter(|c| **c != name).collect();
    serde_json::json!(rest)
}
