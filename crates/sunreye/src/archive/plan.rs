//! Which bucket tier answers each UTC day of one device, ported from 2.x `planReplay`
//! (`packages/db/src/replay.ts`), which recorded `fixtures/oracle/archives`: the finest tier whose rows span
//! the whole day; at the first and last day, a tier reaching the history's edge. A day no tier answers is a
//! gap, reported and not imported. Raw readings are not planned: they all land.

const DAY_MS: i64 = 86_400_000;

/// The bucket tiers, finest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Bucketed {
    Minute,
    Hourly,
    Daily,
}

impl Bucketed {
    pub const fn width_ms(self) -> i64 {
        match self {
            Self::Minute => 60_000,
            Self::Hourly => 3_600_000,
            Self::Daily => DAY_MS,
        }
    }
}

/// What one tier holds: its first bucket's start to its last bucket's end, in Unix milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub tier: Bucketed,
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Chunk {
    pub tier: Bucketed,
    pub start: i64,
    pub end: i64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// Ascending.
    pub chunks: Vec<Chunk>,
    pub gaps: Vec<(i64, i64)>,
}

impl Plan {
    /// Whether a row of `tier` at `at` lands: its tier answers the chunk it falls in.
    pub fn lands(&self, tier: Bucketed, at: i64) -> bool {
        let after = self.chunks.partition_point(|c| c.start <= at);
        after > 0 && self.chunks[after - 1].end > at && self.chunks[after - 1].tier == tier
    }
}

pub fn plan(windows: &[Window]) -> Plan {
    let mut out = Plan::default();
    let (Some(from), Some(to)) = (windows.iter().map(|w| w.from).min(), windows.iter().map(|w| w.to).max())
    else {
        return out;
    };
    let mut cursor = from;
    while cursor < to {
        let day_end = (cursor.div_euclid(DAY_MS) + 1) * DAY_MS;
        let (start, end) = (cursor, day_end.min(to));
        let (first, last) = (cursor == from, day_end >= to);
        match answer(windows, start, end, first, last) {
            Some(chunk) => {
                if chunk.start > start {
                    out.gaps.push((start, chunk.start));
                }
                out.chunks.push(chunk);
                if chunk.end < end {
                    out.gaps.push((chunk.end, end));
                }
            }
            None => out.gaps.push((start, end)),
        }
        cursor = day_end;
    }
    out
}

/// The finest tier answering `[start, end)`, the span narrowed to what it holds at an edge.
fn answer(windows: &[Window], start: i64, end: i64, first: bool, last: bool) -> Option<Chunk> {
    let finest = |usable: &dyn Fn(&Window) -> bool| {
        [Bucketed::Minute, Bucketed::Hourly, Bucketed::Daily]
            .into_iter()
            .find_map(|tier| windows.iter().find(|w| w.tier == tier).filter(|w| usable(w)))
    };
    let whole = |w: &Window| w.from <= start && w.to >= end;
    if !(first || last) {
        return finest(&whole).map(|w| Chunk { tier: w.tier, start, end });
    }
    let at_edge = |w: &Window| {
        w.from.max(start) < w.to.min(end) && (whole(w) || (first && w.to >= end) || (last && w.from <= start))
    };
    finest(&at_edge).map(|w| Chunk { tier: w.tier, start: w.from.max(start), end: w.to.min(end) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(instant: &str) -> i64 {
        instant.parse::<jiff::Timestamp>().expect("instant").as_millisecond()
    }

    /// Buckets of `tier` from the one starting at `first` through the one starting at `last`.
    fn window(tier: Bucketed, first: &str, last: &str) -> Window {
        Window { tier, from: ms(first), to: ms(last) + tier.width_ms() }
    }

    fn chunk(tier: Bucketed, start: &str, end: &str) -> Chunk {
        Chunk { tier, start: ms(start), end: ms(end) }
    }

    #[test]
    fn no_buckets_plan_nothing() {
        assert_eq!(plan(&[]), Plan::default());
    }

    #[test]
    fn hours_covering_part_of_the_last_day_leave_it_a_gap() {
        // fixtures/oracle/archives/current-2.x: daily 28–29 April, two hours of the 30th.
        let planned = plan(&[
            window(Bucketed::Daily, "2026-04-28T00:00:00Z", "2026-04-29T00:00:00Z"),
            window(Bucketed::Hourly, "2026-04-30T10:00:00Z", "2026-04-30T11:00:00Z"),
        ]);
        assert_eq!(
            planned.chunks,
            [
                chunk(Bucketed::Daily, "2026-04-28T00:00:00Z", "2026-04-29T00:00:00Z"),
                chunk(Bucketed::Daily, "2026-04-29T00:00:00Z", "2026-04-30T00:00:00Z"),
            ]
        );
        assert_eq!(planned.gaps, [(ms("2026-04-30T00:00:00Z"), ms("2026-04-30T12:00:00Z"))]);
    }

    #[test]
    fn a_whole_utc_day_of_hours_answers_its_day_also_across_a_dst_change() {
        // Europe/Berlin springs forward on 29 March 2026; the UTC day still holds 24 hours.
        let planned = plan(&[
            window(Bucketed::Daily, "2026-03-28T00:00:00Z", "2026-03-28T00:00:00Z"),
            window(Bucketed::Hourly, "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z"),
            window(Bucketed::Minute, "2026-03-30T08:00:00Z", "2026-03-30T08:02:00Z"),
        ]);
        assert_eq!(
            planned.chunks,
            [
                chunk(Bucketed::Daily, "2026-03-28T00:00:00Z", "2026-03-29T00:00:00Z"),
                chunk(Bucketed::Hourly, "2026-03-29T00:00:00Z", "2026-03-30T00:00:00Z"),
            ]
        );
        assert_eq!(planned.gaps, [(ms("2026-03-30T00:00:00Z"), ms("2026-03-30T08:03:00Z"))]);
    }

    #[test]
    fn the_first_day_takes_the_finest_tier_reaching_its_end() {
        let planned = plan(&[
            window(Bucketed::Daily, "2026-07-12T00:00:00Z", "2026-07-13T00:00:00Z"),
            window(Bucketed::Minute, "2026-07-12T21:38:00Z", "2026-07-13T23:59:00Z"),
        ]);
        assert_eq!(
            planned.chunks,
            [
                chunk(Bucketed::Minute, "2026-07-12T21:38:00Z", "2026-07-13T00:00:00Z"),
                chunk(Bucketed::Minute, "2026-07-13T00:00:00Z", "2026-07-14T00:00:00Z"),
            ]
        );
        assert_eq!(planned.gaps, [(ms("2026-07-12T00:00:00Z"), ms("2026-07-12T21:38:00Z"))]);
    }

    #[test]
    fn an_edge_day_takes_a_finer_tier_ending_or_starting_exactly_on_its_boundary() {
        let first = plan(&[
            window(Bucketed::Daily, "2026-07-12T00:00:00Z", "2026-07-13T00:00:00Z"),
            window(Bucketed::Minute, "2026-07-12T21:38:00Z", "2026-07-12T23:59:00Z"),
        ]);
        assert_eq!(first.chunks[0], chunk(Bucketed::Minute, "2026-07-12T21:38:00Z", "2026-07-13T00:00:00Z"));
        let last = plan(&[
            window(Bucketed::Daily, "2026-07-12T00:00:00Z", "2026-07-12T00:00:00Z"),
            window(Bucketed::Minute, "2026-07-13T00:00:00Z", "2026-07-13T08:02:00Z"),
            window(Bucketed::Hourly, "2026-07-13T09:00:00Z", "2026-07-13T09:00:00Z"),
        ]);
        assert_eq!(last.chunks[1], chunk(Bucketed::Minute, "2026-07-13T00:00:00Z", "2026-07-13T08:03:00Z"));
        assert_eq!(last.gaps, [(ms("2026-07-13T08:03:00Z"), ms("2026-07-13T10:00:00Z"))]);
    }

    #[test]
    fn a_middle_day_a_tier_covers_only_in_part_falls_to_the_coarser_tier() {
        let planned = plan(&[
            window(Bucketed::Daily, "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z"),
            window(Bucketed::Hourly, "2026-01-02T06:00:00Z", "2026-01-03T23:00:00Z"),
        ]);
        let tiers: Vec<Bucketed> = planned.chunks.iter().map(|c| c.tier).collect();
        assert_eq!(tiers, [Bucketed::Daily, Bucketed::Daily, Bucketed::Hourly]);
        assert_eq!(planned.gaps, []);
    }

    #[test]
    fn a_row_lands_only_inside_a_chunk_its_tier_answers() {
        let planned = plan(&[
            window(Bucketed::Daily, "2026-04-28T00:00:00Z", "2026-04-29T00:00:00Z"),
            window(Bucketed::Hourly, "2026-04-30T10:00:00Z", "2026-04-30T11:00:00Z"),
        ]);
        assert!(planned.lands(Bucketed::Daily, ms("2026-04-28T00:00:00Z")));
        assert!(planned.lands(Bucketed::Daily, ms("2026-04-29T00:00:00Z")));
        assert!(!planned.lands(Bucketed::Hourly, ms("2026-04-29T00:00:00Z")));
        assert!(!planned.lands(Bucketed::Hourly, ms("2026-04-30T10:00:00Z")));
        assert!(!planned.lands(Bucketed::Daily, ms("2026-04-27T23:59:59.999Z")));
    }
}
