//! Read planning (ADR 5): contiguous registers coalesce into blocks of at most [`MAX_BLOCK`], the
//! inputs of a computed quantity share one grouped block, and blocks fold across small gaps when
//! the framing makes a round trip dear.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::document::Kind;
use crate::profile::{Quantity, Read};

/// Most registers one request may ask for; Modbus caps a read at 125.
const MAX_BLOCK: u16 = 120;

/// One read request: `count` registers from `start`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub start: u16,
    pub count: u16,
    /// Holds every input of a computed quantity, so they share one device snapshot.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub grouped: bool,
    /// Folded across unmapped registers: the only plain block a device may refuse with exception 2.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub merged: bool,
}

impl Block {
    const fn plain(start: u16) -> Self {
        Self {
            start,
            count: 1,
            grouped: false,
            merged: false,
        }
    }

    fn end(self) -> u32 {
        u32::from(self.start) + u32::from(self.count)
    }

    fn covers(self, address: u16) -> bool {
        address >= self.start && u32::from(address) < self.end()
    }
}

/// The gap-free plan: grouped blocks, then every other register in contiguous blocks.
pub fn compile(quantities: &[Quantity]) -> Vec<Block> {
    let groups = atomic_groups(quantities);
    let rest = readable(quantities)
        .into_iter()
        .filter(|a| !groups.iter().any(|g| g.covers(*a)));
    let mut plan: Vec<Block> = groups
        .iter()
        .copied()
        .chain(split_into_blocks(rest))
        .collect();
    plan.sort_by_key(|block| block.start);
    plan
}

pub fn split(quantities: &[Quantity], block: Block) -> Vec<Block> {
    split_into_blocks(
        readable(quantities)
            .into_iter()
            .filter(|a| block.covers(*a)),
    )
}

/// A merge swallows its neighbour whole, so a grouped block stays one transaction.
pub fn merge_across_gaps(plan: &[Block], tolerance: u16) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::with_capacity(plan.len());
    for block in plan {
        match out.last_mut() {
            Some(last) if mergeable(*last, *block, tolerance) => {
                last.count = block.start + block.count - last.start;
                last.merged = true;
                last.grouped |= block.grouped;
            }
            _ => out.push(*block),
        }
    }
    out
}

/// Tolerance 0 never merges, not even blocks that touch.
fn mergeable(last: Block, next: Block, tolerance: u16) -> bool {
    let gap = u32::from(next.start).saturating_sub(last.end());
    let span = next.end() - u32::from(last.start);
    tolerance > 0 && gap <= u32::from(tolerance) && span <= u32::from(MAX_BLOCK)
}

fn addresses(quantity: &Quantity) -> Vec<u16> {
    match quantity.read {
        Read::Register {
            address,
            kind: Kind::U32,
            ..
        } => vec![address, address + 1],
        Read::Register {
            address,
            kind: Kind::U16 | Kind::I16,
            ..
        } => vec![address],
        Read::Compute(_) => Vec::new(),
    }
}

fn readable(quantities: &[Quantity]) -> BTreeSet<u16> {
    quantities.iter().flat_map(addresses).collect()
}

/// Ascending addresses into contiguous blocks, split on gaps and at [`MAX_BLOCK`].
fn split_into_blocks(sorted: impl IntoIterator<Item = u16>) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    for address in sorted {
        match blocks.last_mut() {
            Some(last) if u32::from(address) <= last.end() && address - last.start < MAX_BLOCK => {
                last.count = last.count.max(address - last.start + 1);
            }
            _ => blocks.push(Block::plain(address)),
        }
    }
    blocks
}

/// One grouped block per cluster of computed quantities with overlapping register spans. A cluster
/// wider than one request is left to the plain blocks and its inputs are read apart.
fn atomic_groups(quantities: &[Quantity]) -> Vec<Block> {
    // Inputs are always declared earlier, so one pass resolves every computed quantity.
    let mut registers: Vec<BTreeSet<u16>> = Vec::with_capacity(quantities.len());
    let mut spans: Vec<(u16, u16)> = Vec::new();
    for quantity in quantities {
        let found: BTreeSet<u16> = match &quantity.read {
            Read::Compute(expr) => expr
                .inputs()
                .iter()
                .filter_map(|i| registers.get(*i))
                .flatten()
                .copied()
                .collect(),
            Read::Register { .. } => addresses(quantity).into_iter().collect(),
        };
        if let (Read::Compute(_), Some(min), Some(max), true) = (
            &quantity.read,
            found.first(),
            found.last(),
            found.len() >= 2,
        ) {
            spans.push((*min, *max));
        }
        registers.push(found);
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
        .map(|(min, max)| Block {
            start: min,
            count: max - min + 1,
            grouped: true,
            merged: false,
        })
        .collect()
}
