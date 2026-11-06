//! A published state number: at most two decimals, trailing zeros trimmed. 3.x sent `String(number)` with the
//! float noise (`23.400000000000006`); 4.0 deviates on purpose (#317) and the oracle keeps the 3.x payloads.

/// The payload for `value`, rounded half away from zero on its shortest decimal form, so `12.345` is `12.35`
/// although its binary value lies below. Values under 0.005 read `0`; profile scales are at least 0.01, so no
/// decoded register loses a digit. None for NaN and the infinities: nothing is published.
pub fn state(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    let written = format!("{}", value.abs());
    let (whole, fraction) = written.split_once('.').unwrap_or((&written, ""));
    let kept = fraction.bytes().chain(std::iter::repeat(b'0')).take(2);
    let mut digits: Vec<u8> = whole.bytes().chain(kept).collect();
    if fraction.as_bytes().get(2).is_some_and(|d| *d >= b'5') {
        carry(&mut digits);
    }
    let (whole, fraction) = digits.split_at(digits.len() - 2);
    let whole = String::from_utf8_lossy(whole);
    let fraction = String::from_utf8_lossy(fraction);
    let fraction = fraction.trim_end_matches('0');
    let zero = whole.bytes().all(|d| d == b'0') && fraction.is_empty();
    let sign = if value < 0.0 && !zero { "-" } else { "" };
    Some(if fraction.is_empty() { format!("{sign}{whole}") } else { format!("{sign}{whole}.{fraction}") })
}

/// Adds one to the last decimal digit, a leading `1` when every digit was a `9`.
fn carry(digits: &mut Vec<u8>) {
    for digit in digits.iter_mut().rev() {
        if *digit == b'9' {
            *digit = b'0';
        } else {
            *digit += 1;
            return;
        }
    }
    digits.insert(0, b'1');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mqtt::fixture::cases;

    /// Two decimals by a route independent of [`state`]: scale, round, scale back.
    fn near_two_decimals(recorded: &str) -> f64 {
        (recorded.parse::<f64>().expect("number") * 100.0).round() / 100.0
    }

    /// Every reading the state cases recorded, by metric key.
    fn recorded_readings() -> Vec<(String, serde_json::Value)> {
        let steps: Vec<serde_json::Value> = cases("state/")
            .iter()
            .flat_map(|c| c["output"]["steps"].as_array().cloned().unwrap_or_default())
            .collect();
        steps
            .iter()
            .filter_map(|s| s["readings"].as_object())
            .flatten()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    #[test]
    fn every_recorded_state_payload_goes_out_rounded_to_two_decimals() {
        let readings = recorded_readings();
        assert!(readings.len() > 40, "{}", readings.len());
        for (key, value) in readings {
            let got = state(value.as_f64().expect("number")).expect("finite");
            let want = near_two_decimals(&value.to_string());
            assert!((got.parse::<f64>().expect("number") - want).abs() < 1e-9, "{key}: {got}");
            let decimals = got.split_once('.').map_or(0, |(_, d)| d.len());
            assert!(decimals <= 2 && !(got.contains('.') && got.ends_with('0')), "{key}: {got}");
        }
    }

    #[test]
    fn ties_round_half_away_from_zero_on_the_decimal_as_written() {
        let cases = [
            (23.400_000_000_000_006, "23.4"),
            (-12.34, "-12.34"),
            (50.0, "50"),
            (50.01, "50.01"),
            (12.345, "12.35"),
            (-12.345, "-12.35"),
            (0.125, "0.13"),
            (-0.125, "-0.13"),
            (1.005, "1.01"),
            (9.995, "10"),
            (-9.995, "-10"),
            (99.999, "100"),
            (0.004, "0"),
            (-0.004, "0"),
            (0.005, "0.01"),
            (0.0, "0"),
            (-0.0, "0"),
            (1e-7, "0"),
            (15.870_966_750_000_001, "15.87"),
            (214_902_376.600_000_02, "214902376.6"),
            (1e21, "1000000000000000000000"),
            (f64::MAX, &format!("{}", f64::MAX)),
        ];
        for (value, want) in cases {
            assert_eq!(state(value).as_deref(), Some(want), "{value:?}");
        }
    }

    #[test]
    fn nan_and_infinity_are_not_published() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(state(value), None, "{value}");
        }
    }
}
