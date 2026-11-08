//! Decoding register words with a profile, and planning the reads that fetch them.
//!
//! Decoding follows the 2.x engine and is proved against the oracle corpus: register-bound metrics
//! first (word, signed word, low-word-first double word, scale, offset, range clamp), then computed
//! metrics in profile order. An unanswered register yields no reading, never zero.

use std::collections::{BTreeSet, HashMap};

use crate::profile::{Binding, Expr, KeyAndFactor, Metric, Profile, Range, RegisterType};

/// Words the device answered, by register address.
pub type Words = HashMap<u16, u16>;

/// Most registers one request may ask for.
pub const MAX_BLOCK: u16 = 120;

/// One read request. A grouped block holds every register a computed metric needs, so the inputs are
/// sampled in one transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    pub start: u16,
    pub count: u16,
    pub grouped: bool,
}

/// Every reading the profile can compute from `words`, in profile order.
pub fn decode(profile: &Profile, words: &Words) -> Vec<(String, f64)> {
    let mut values: HashMap<&str, f64> = HashMap::new();
    for metric in &profile.metrics {
        if let Binding::Modbus { addr, kind } = &metric.binding
            && let Some(value) = raw_value(*kind, addr, words).and_then(|raw| scaled(metric, raw))
        {
            values.insert(&metric.key, value);
        }
    }
    for metric in &profile.metrics {
        if let Binding::Compute { expr } = &metric.binding {
            let value = clamped(metric.range, evaluate(expr, &values));
            values.insert(&metric.key, value);
        }
    }
    profile.metrics.iter().filter_map(|m| values.get(m.key.as_str()).map(|v| (m.key.clone(), *v))).collect()
}

fn raw_value(kind: RegisterType, addr: &[u16], words: &Words) -> Option<f64> {
    let low = *words.get(addr.first()?)?;
    match kind {
        RegisterType::UWord => Some(f64::from(low)),
        RegisterType::SWord => Some(f64::from(i16::from_ne_bytes(low.to_ne_bytes()))),
        RegisterType::UDword => {
            let high = *words.get(addr.get(1)?)?;
            Some(f64::from(low) + f64::from(high) * 65536.0)
        }
        RegisterType::Raw => None,
    }
}

fn scaled(metric: &Metric, raw: f64) -> Option<f64> {
    let value = raw * metric.scale + metric.offset.unwrap_or(0.0);
    value.is_finite().then(|| clamped(metric.range, value))
}

fn clamped(range: Option<Range>, value: f64) -> f64 {
    range.map_or(value, |r| value.max(r.min).min(r.max))
}

fn evaluate(expr: &Expr, values: &HashMap<&str, f64>) -> f64 {
    let get = |key: &str| values.get(key).copied().unwrap_or(0.0);
    let total = |keys: &[String]| keys.iter().fold(0.0, |acc, key| acc + get(key));
    match expr {
        Expr::Sum(keys) => total(keys),
        Expr::Diff([a, b]) => get(a) - get(b),
        Expr::Scale(KeyAndFactor(key, factor)) => get(key) * factor,
        Expr::Combine { add, sub } => total(add) - total(sub.as_deref().unwrap_or_default()),
        Expr::Ratio { num, den, scale } => {
            let denominator = total(den);
            if denominator == 0.0 { 0.0 } else { total(num) / denominator * scale.unwrap_or(1.0) }
        }
        Expr::Clamp { key, min, max } => {
            let low = min.map_or(get(key), |min| get(key).max(min));
            max.map_or(low, |max| low.min(max))
        }
    }
}

/// The reads that fetch every register the profile binds.
pub fn plan_reads(profile: &Profile) -> Vec<Block> {
    let groups = atomic_groups(profile);
    let rest =
        readable(&profile.metrics).into_iter().filter(|addr| !groups.iter().any(|g| covers(*g, *addr)));
    let mut plan: Vec<Block> = groups.iter().copied().chain(split_into_blocks(rest)).collect();
    plan.sort_by_key(|block| block.start);
    plan
}

/// A block's mapped registers as plain blocks: the fallback for a device that refuses a spanning read.
pub fn split_block(profile: &Profile, block: Block) -> Vec<Block> {
    split_into_blocks(readable(&profile.metrics).into_iter().filter(|addr| covers(block, *addr)))
}

fn covers(block: Block, addr: u16) -> bool {
    addr >= block.start && u32::from(addr) < u32::from(block.start) + u32::from(block.count)
}

fn addresses(metric: &Metric) -> Vec<u16> {
    match &metric.binding {
        Binding::Modbus { addr, kind: RegisterType::UDword } => addr.clone(),
        Binding::Modbus { addr, kind: RegisterType::UWord | RegisterType::SWord } => {
            addr.first().copied().into_iter().collect()
        }
        _ => Vec::new(),
    }
}

fn readable(metrics: &[Metric]) -> BTreeSet<u16> {
    metrics.iter().flat_map(addresses).collect()
}

/// Ascending addresses into contiguous blocks, split on gaps and at [`MAX_BLOCK`].
fn split_into_blocks(sorted: impl IntoIterator<Item = u16>) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    for addr in sorted {
        match blocks.last_mut() {
            Some(last)
                if u32::from(addr) <= u32::from(last.start) + u32::from(last.count)
                    && addr - last.start < MAX_BLOCK =>
            {
                last.count = last.count.max(addr - last.start + 1);
            }
            _ => blocks.push(Block { start: addr, count: 1, grouped: false }),
        }
    }
    blocks
}

/// One spanning block per cluster of computed metrics that share registers; a cluster wider than a
/// request cannot be read atomically and is left to the plain blocks.
fn atomic_groups(profile: &Profile) -> Vec<Block> {
    let by_key: HashMap<&str, &Metric> = profile.metrics.iter().map(|m| (m.key.as_str(), m)).collect();
    let mut spans: Vec<(u16, u16)> = Vec::new();
    for metric in &profile.metrics {
        if !matches!(metric.binding, Binding::Compute { .. }) {
            continue;
        }
        let mut found = BTreeSet::new();
        collect_addresses(metric, &by_key, &mut found, &mut BTreeSet::new());
        if let (Some(min), Some(max), true) = (found.first(), found.last(), found.len() >= 2) {
            spans.push((*min, *max));
        }
    }
    spans.sort_unstable();
    let mut merged: Vec<(u16, u16)> = Vec::new();
    for (min, max) in spans {
        match merged.last_mut() {
            Some(last) if min <= last.1 => last.1 = last.1.max(max),
            _ => merged.push((min, max)),
        }
    }
    merged
        .into_iter()
        .filter(|(min, max)| max - min < MAX_BLOCK)
        .map(|(min, max)| Block { start: min, count: max - min + 1, grouped: true })
        .collect()
}

fn collect_addresses<'a>(
    metric: &'a Metric,
    by_key: &HashMap<&'a str, &'a Metric>,
    found: &mut BTreeSet<u16>,
    seen: &mut BTreeSet<&'a str>,
) {
    if !seen.insert(&metric.key) {
        return;
    }
    if let Binding::Compute { expr } = &metric.binding {
        for key in expr.inputs() {
            if let Some(dep) = by_key.get(key) {
                collect_addresses(dep, by_key, found, seen);
            }
        }
    } else {
        found.extend(addresses(metric));
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::Path;

    use serde_json::Value;

    use super::*;
    use crate::profile::Bundle;

    fn corpus() -> Vec<Value> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/profile-decode.ndjson");
        let text = std::fs::read_to_string(path).expect("corpus");
        text.lines().map(|line| serde_json::from_str(line).expect("json")).collect()
    }

    /// The registers a corpus case answers, by address.
    fn answered(case: &Value) -> Words {
        let mut regs = Words::new();
        for run in case["runs"].as_array().expect("runs") {
            let start = u16::try_from(run["start"].as_u64().expect("start")).expect("u16");
            let words = run["words"].as_array().expect("words");
            for (addr, word) in (start..).zip(words) {
                regs.insert(addr, u16::try_from(word.as_u64().expect("word")).expect("u16"));
            }
        }
        regs
    }

    fn profile(json: &str) -> Profile {
        serde_json::from_str(&format!(
            r#"{{"id":"p","name":"p","manufacturer":"m","version":"1","metrics":[{json}]}}"#
        ))
        .expect("profile")
    }

    fn modbus(key: &str, addr: &str, kind: &str, extra: &str) -> String {
        format!(
            r#"{{"key":"{key}","scale":1,"binding":{{"via":"modbus","addr":{addr},"type":"{kind}"}}{extra}}}"#
        )
    }

    fn compute(key: &str, expr: &str) -> String {
        format!(r#"{{"key":"{key}","scale":1,"binding":{{"via":"compute","expr":{expr}}}}}"#)
    }

    fn words(pairs: &[(u16, u16)]) -> Words {
        pairs.iter().copied().collect()
    }

    fn value(profile: &Profile, key: &str, words: &Words) -> Option<f64> {
        decode(profile, words).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    #[test]
    fn every_profile_decodes_every_oracle_case_to_the_recorded_readings() {
        let bundle = Bundle::official().expect("bundle");
        let mut cases = 0;
        for row in corpus() {
            let id = row["profile"]["id"].as_str().expect("id");
            let profile = bundle.profile(id).expect("profile");
            for case in row["cases"].as_array().expect("cases") {
                let regs = answered(case);
                let got: BTreeMap<String, f64> = decode(profile, &regs).into_iter().collect();
                let want: BTreeMap<String, f64> = case["readings"]
                    .as_object()
                    .expect("readings")
                    .iter()
                    .map(|(k, v)| (k.clone(), v.as_f64().expect("number")))
                    .collect();
                assert_eq!(got, want, "{id} {}", case["name"]);
                cases += 1;
            }
        }
        assert_eq!(cases, 20 * 6);
    }

    #[test]
    fn every_profile_plans_the_oracle_blocks() {
        let bundle = Bundle::official().expect("bundle");
        for row in corpus() {
            let id = row["profile"]["id"].as_str().expect("id");
            let want: Vec<(u64, u64)> = row["blocks"]
                .as_array()
                .expect("blocks")
                .iter()
                .map(|b| (b["start"].as_u64().expect("start"), b["count"].as_u64().expect("count")))
                .collect();
            let got: Vec<(u64, u64)> = plan_reads(bundle.profile(id).expect("profile"))
                .iter()
                .map(|b| (u64::from(b.start), u64::from(b.count)))
                .collect();
            assert_eq!(got, want, "{id}");
        }
    }

    #[test]
    fn an_unanswered_register_is_absent_never_zero() {
        let p = profile(&[modbus("a", "[1]", "U_WORD", ""), modbus("d", "[10,11]", "U_DWORD", "")].join(","));
        assert_eq!(decode(&p, &Words::new()), []);
        assert_eq!(value(&p, "d", &words(&[(10, 5)])), None, "half a double word");
        assert_eq!(value(&p, "d", &words(&[(11, 5)])), None);
    }

    #[test]
    fn raw_and_control_metrics_read_nothing() {
        let p = profile(&format!(
            r#"{},{{"key":"c","scale":1,"binding":{{"via":"control","expr":{{"snapshotToggle":{{"target":"a","lockedValue":0}}}}}}}}"#,
            modbus("raw", "[1,2,3]", "RAW", "")
        ));
        assert_eq!(decode(&p, &words(&[(1, 1), (2, 2), (3, 3)])), []);
        assert_eq!(plan_reads(&p), []);
    }

    #[test]
    fn computed_metrics_follow_their_expressions_and_missing_inputs_read_as_zero() {
        let p = profile(
            &[
                modbus("a", "[1]", "U_WORD", ""),
                modbus("b", "[2]", "S_WORD", ""),
                compute("sum", r#"{"sum":["a","b","gone"]}"#),
                compute("diff", r#"{"diff":["a","b"]}"#),
                compute("scaled", r#"{"scale":["a",2.5]}"#),
                compute("mix", r#"{"combine":{"add":["a"],"sub":["b"]}}"#),
                compute("ratio", r#"{"ratio":{"num":["a"],"den":["b"],"scale":100}}"#),
                compute("pos", r#"{"clamp":{"key":"b","min":0}}"#),
                compute("cap", r#"{"clamp":{"key":"a","max":10}}"#),
            ]
            .join(","),
        );
        let w = words(&[(1, 40), (2, 0xfff6)]);
        let want = |key| value(&p, key, &w);
        assert_eq!(want("sum"), Some(30.0));
        assert_eq!(want("diff"), Some(50.0));
        assert_eq!(want("scaled"), Some(100.0));
        assert_eq!(want("mix"), Some(50.0));
        assert_eq!(want("ratio"), Some(40.0 / -10.0 * 100.0));
        assert_eq!(want("pos"), Some(0.0));
        assert_eq!(want("cap"), Some(10.0));
        let none = Words::new();
        assert_eq!(value(&p, "sum", &none), Some(0.0));
        assert_eq!(value(&p, "ratio", &none), Some(0.0), "a zero denominator reads as 0");
    }

    #[test]
    fn a_block_never_exceeds_the_per_request_cap() {
        let metrics: Vec<String> =
            (0..130).map(|i| modbus(&format!("m{i}"), &format!("[{i}]"), "U_WORD", "")).collect();
        let p = profile(&metrics.join(","));
        let plan: Vec<(u16, u16)> = plan_reads(&p).iter().map(|b| (b.start, b.count)).collect();
        assert_eq!(plan, [(0, 120), (120, 10)]);
    }

    #[test]
    fn the_inputs_of_a_computed_metric_are_read_in_one_grouped_block() {
        let p = profile(
            &[
                modbus("a", "[500]", "U_WORD", ""),
                modbus("b", "[520]", "U_WORD", ""),
                modbus("c", "[900]", "U_WORD", ""),
                compute("sum", r#"{"sum":["a","b"]}"#),
                compute("via", r#"{"scale":["sum",2]}"#),
            ]
            .join(","),
        );
        let plan: Vec<(u16, u16, bool)> =
            plan_reads(&p).iter().map(|b| (b.start, b.count, b.grouped)).collect();
        assert_eq!(plan, [(500, 21, true), (900, 1, false)]);
    }

    #[test]
    fn a_cyclic_or_dangling_compute_graph_still_plans() {
        let p = profile(
            &[
                modbus("a", "[1]", "U_WORD", ""),
                compute("x", r#"{"sum":["y","a"]}"#),
                compute("y", r#"{"sum":["x","ghost"]}"#),
            ]
            .join(","),
        );
        assert_eq!(plan_reads(&p).len(), 1);
    }
}
