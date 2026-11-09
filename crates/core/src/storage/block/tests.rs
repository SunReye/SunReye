//! The block format is stored data: its bytes are pinned.

use super::{decode, encode};
use crate::storage::encode::Point;

/// 2026-08-26 12:00 UTC in 100 ms ticks.
const HOUR: i64 = 17_877_456_000;

fn hour() -> Vec<Point> {
    vec![
        Point {
            time: HOUR + 5,
            value: Some(2300),
        },
        Point {
            time: HOUR + 55,
            value: Some(2301),
        },
        Point {
            time: HOUR + 105,
            value: None,
        },
        Point {
            time: HOUR + 300,
            value: Some(2290),
        },
    ]
}

#[test]
fn a_block_is_a_version_then_zigzag_varint_deltas_of_time_and_value() {
    // Each point: the time delta, then the value delta shifted left with the low bit as gap flag.
    assert_eq!(
        encode(HOUR, &hour()),
        [
            0x01, 0x0a, 0xf0, 0x47, 0x64, 0x04, 0x64, 0x01, 0x86, 0x03, 0x2a
        ]
    );
}

#[test]
fn a_block_decodes_to_the_points_it_was_encoded_from() {
    let extremes = vec![
        Point {
            time: HOUR,
            value: Some(-(1 << 53)),
        },
        Point {
            time: HOUR + 35_999,
            value: Some(1 << 53),
        },
    ];
    for points in [hour(), extremes] {
        assert_eq!(decode(HOUR, &encode(HOUR, &points)), Some(points));
    }
}

#[test]
fn a_truncated_or_unknown_block_is_refused() {
    let block = encode(HOUR, &hour());
    assert_eq!(decode(HOUR, &block[..block.len() - 1]), None);
    assert_eq!(decode(HOUR, &[0x02]), None);
}
