//! Reading the oracle corpus (`fixtures/oracle/`) in tests.

use std::path::Path;

use serde_json::{Value, json};

/// Every line of `file`, parsed.
pub fn oracle(file: &str) -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle").join(file);
    let text = std::fs::read_to_string(path).expect("corpus");
    text.lines().map(|line| serde_json::from_str(line).expect("json")).collect()
}

/// JSON writes 100 where a float prints 100.0; both are the number 100.
pub fn as_floats(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64()),
        Value::Array(items) => items.iter().map(as_floats).collect(),
        Value::Object(fields) => fields.iter().map(|(k, v)| (k.clone(), as_floats(v))).collect(),
        other => other.clone(),
    }
}
