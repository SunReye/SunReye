//! The built-in SunSpec binding's discovery (ADR 5): find the base, check `SunS`, walk the model
//! chain to the end model.
//!
//! [`Discovery`] does no I/O: it names each read and takes its answer, so the core's client and
//! a register dump drive the same walk. Facts from the SunSpec Information Model Specification
//! (SunSpec Alliance, document 12041), as its reference client `pysunspec2` reads them.

use crate::Block;
use crate::plan;

/// The id of the one generic SunSpec profile, which a SunSpec identify probe proposes.
pub const PROFILE: &str = "sunspec";

/// Protocol addresses of the base registers 40001, 50001 and 1, in the order ADR 5 tries them.
const BASES: [u16; 3] = [40000, 50000, 0];
/// `SunS`, 0x53756e53, high word first.
const MARKER: [u16; 2] = [0x5375, 0x6e53];
/// The model ID that ends the chain.
const END: u16 = 0xFFFF;
/// The common model, first in a chain.
const COMMON: u16 = 1;
/// A model header: its ID, then its length.
const HEADER: u16 = 2;

/// One model of the chain: its ID and its `length` registers from `start`, after its header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Model {
    pub id: u16,
    pub start: u16,
    pub length: u16,
}

/// A device's SunSpec models in chain order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chain {
    models: Vec<Model>,
}

impl Chain {
    #[must_use]
    pub fn models(&self) -> &[Model] {
        &self.models
    }

    /// The device model, which follows the common model a chain starts with: the identify
    /// probe's variant (ADR 5), such as an inverter's 101, 102 or 103 by phases.
    #[must_use]
    pub const fn variant(&self) -> Option<u16> {
        match self.models.as_slice() {
            [Model { id: COMMON, .. }, device, ..] => Some(device.id),
            _ => None,
        }
    }

    /// The reads for one poll: every model's registers, its header aside, folded across gaps
    /// of at most `gap_tolerance` (see [`crate::Framing::gap_tolerance`]).
    #[must_use]
    pub fn read_plan(&self, gap_tolerance: u16) -> Vec<Block> {
        plan::merge_across_gaps(&plan::contiguous(self.registers()), gap_tolerance)
    }

    /// A merged block's model registers as plain blocks: the fallback when a device refuses it
    /// with Modbus exception 2.
    #[must_use]
    pub fn split(&self, block: Block) -> Vec<Block> {
        plan::contiguous(self.registers().filter(|a| block.covers(*a)))
    }

    /// Every model's registers but the headers, ascending.
    fn registers(&self) -> impl Iterator<Item = u16> + '_ {
        self.models
            .iter()
            .flat_map(|m| (0..m.length).map_while(move |offset| m.start.checked_add(offset)))
    }
}

/// What discovery needs next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Next {
    /// `count` holding registers from `start`; hand the words, or `None` for a refusal, to
    /// [`Discovery::answer`].
    Read {
        start: u16,
        count: u16,
    },
    Found(Chain),
    /// No base holds the marker, or the chain after it does not walk to the end model.
    Absent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Reading the marker at `BASES[at]`.
    Base(usize),
    /// Reading the header at `address`; `narrow` after a two-register read was refused there,
    /// as an end model with no length may be the device's last register.
    Header {
        address: u16,
        narrow: bool,
    },
    Done,
    Absent,
}

/// One SunSpec discovery over one device.
#[derive(Debug, Clone)]
pub struct Discovery {
    state: State,
    models: Vec<Model>,
}

impl Default for Discovery {
    fn default() -> Self {
        Self::new()
    }
}

impl Discovery {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            state: State::Base(0),
            models: Vec::new(),
        }
    }

    #[must_use]
    pub fn next(&self) -> Next {
        match self.state {
            State::Base(at) => BASES.get(at).map_or(Next::Absent, |&start| Next::Read {
                start,
                count: HEADER,
            }),
            State::Header { address, narrow } => Next::Read {
                start: address,
                count: if narrow { 1 } else { HEADER },
            },
            State::Done => Next::Found(Chain {
                models: self.models.clone(),
            }),
            State::Absent => Next::Absent,
        }
    }

    /// Takes the answer to the read [`Discovery::next`] named: its words, or `None` when the
    /// device refused it.
    pub fn answer(&mut self, words: Option<&[u16]>) {
        self.state = match (self.state, words) {
            (State::Base(at), Some(words)) if words == MARKER => BASES
                .get(at)
                .and_then(|base| base.checked_add(HEADER))
                .map_or(State::Absent, |address| State::Header {
                    address,
                    narrow: false,
                }),
            (State::Base(at), _) => State::Base(at + 1),
            (State::Header { address, narrow }, Some(words)) => self.header(address, narrow, words),
            (
                State::Header {
                    address,
                    narrow: false,
                },
                None,
            ) => State::Header {
                address,
                narrow: true,
            },
            (State::Header { narrow: true, .. }, None) => State::Absent,
            (state @ (State::Done | State::Absent), _) => state,
        };
    }

    /// The state after the header at `address` read as `words`.
    fn header(&mut self, address: u16, narrow: bool, words: &[u16]) -> State {
        match (words, narrow) {
            ([END, ..], _) => State::Done,
            ([id, length], false) => {
                let start = address.checked_add(HEADER);
                let next = start.and_then(|s| s.checked_add(*length));
                match (start, next) {
                    (Some(start), Some(address)) => {
                        self.models.push(Model {
                            id: *id,
                            start,
                            length: *length,
                        });
                        State::Header {
                            address,
                            narrow: false,
                        }
                    }
                    _ => State::Absent,
                }
            }
            _ => State::Absent,
        }
    }
}
