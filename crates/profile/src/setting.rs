//! Settings (ADR 5, 7): what the core may write, the steps that write it and where it reads back.

use std::time::Duration;

use crate::document::{BlockDoc, BlockWord, Kind, Range, SettingDoc, StepDoc};

/// One writable device parameter.
#[derive(Debug, Clone)]
pub struct Setting {
    pub key: String,
    kind: Kind,
    scale: f64,
    range: Option<Range>,
    values: Option<Vec<f64>>,
    min_interval: Duration,
    recipe: Vec<Step>,
    read_back: Option<u16>,
}

/// One step of a recipe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Writes the value's words from `register` with function code 16: Deye ignores function code
    /// 6 on its settings registers (measured live).
    Write { register: u16 },
    /// Writes `head`, the value's words and `tail` from `register` in one request.
    WriteBlock {
        register: u16,
        head: Vec<u16>,
        tail: Vec<u16>,
    },
    /// Waits before the next step; the endpoint's polls wait with it.
    Delay(Duration),
}

/// The longest delay: polls of every device on the endpoint wait for it.
const MAX_DELAY_MS: u32 = 10_000;

/// The most registers function code 16 writes in one request.
const MAX_BLOCK: usize = 123;

impl Setting {
    /// The bounds a value must lie within; `None` when the setting declares its values instead.
    #[must_use]
    pub fn range(&self) -> Option<(f64, f64)> {
        self.range.map(|r| (r.min, r.max))
    }

    /// The only values it takes, when the profile enumerates them.
    #[must_use]
    pub fn values(&self) -> Option<&[f64]> {
        self.values.as_deref()
    }

    /// The step a value is a whole number of: the register's scale.
    #[must_use]
    pub const fn step(&self) -> f64 {
        self.scale
    }

    /// The steps that apply it, in order.
    #[must_use]
    pub fn recipe(&self) -> &[Step] {
        &self.recipe
    }

    /// The first register to read back after a write; `None` for a write-only setting.
    #[must_use]
    pub const fn read_back(&self) -> Option<u16> {
        self.read_back
    }

    /// The shortest time between two writes, to spare the device's memory.
    #[must_use]
    pub const fn min_interval(&self) -> Duration {
        self.min_interval
    }

    /// The registers a value takes.
    #[must_use]
    pub const fn width(&self) -> u16 {
        width(self.kind)
    }

    /// The words of `value`, low word first; `None` unless it is a whole number of steps of the
    /// scale, inside the range or among the values, and fits the type.
    #[must_use]
    pub fn encode(&self, value: f64) -> Option<Vec<u16>> {
        let raw = self.raw(value)?;
        let allowed = match (&self.values, self.range) {
            (Some(values), _) => values.iter().any(|v| self.raw(*v) == Some(raw)),
            (None, Some(range)) => (range.min..=range.max).contains(&value),
            (None, None) => false,
        };
        if !allowed {
            return None;
        }
        match self.kind {
            Kind::U16 => u16::try_from(raw).ok().map(|w| vec![w]),
            Kind::I16 => i16::try_from(raw)
                .ok()
                .map(|w| vec![u16::from_ne_bytes(w.to_ne_bytes())]),
            Kind::U32 => u32::try_from(raw)
                .ok()
                .map(|w| vec![(w & 0xFFFF) as u16, (w >> 16) as u16]),
        }
    }

    /// The value `words` hold, low word first; `None` when too few were read.
    #[must_use]
    pub fn decode(&self, words: &[u16]) -> Option<f64> {
        let low = *words.first()?;
        let raw = match self.kind {
            Kind::U16 => f64::from(low),
            Kind::I16 => f64::from(i16::from_ne_bytes(low.to_ne_bytes())),
            Kind::U32 => f64::from(u32::from(*words.get(1)?) << 16 | u32::from(low)),
        };
        Some(raw * self.scale)
    }

    /// `value` in whole steps of the scale.
    fn raw(&self, value: f64) -> Option<i64> {
        let steps = value / self.scale;
        let whole = steps.round();
        // A step count past 2^53 is not exact; no register holds one.
        let exact = steps.is_finite() && whole.abs() < 9e15 && (steps - whole).abs() <= 1e-9;
        #[expect(
            clippy::cast_possible_truncation,
            reason = "checked to be whole and small"
        )]
        exact.then_some(whole as i64)
    }
}

const fn width(kind: Kind) -> u16 {
    match kind {
        Kind::U16 | Kind::I16 => 1,
        Kind::U32 => 2,
    }
}

pub fn compile(docs: Vec<SettingDoc>) -> Result<Vec<Setting>, (String, &'static str)> {
    let mut settings: Vec<Setting> = Vec::with_capacity(docs.len());
    for doc in docs {
        if settings.iter().any(|s| s.key == doc.key) {
            return Err((doc.key, "the key is declared twice"));
        }
        settings.push(setting(doc.key.clone(), doc)?);
    }
    Ok(settings)
}

fn block(doc: &BlockDoc, kind: Kind) -> Result<Step, &'static str> {
    let words: Vec<Option<u16>> = doc
        .words
        .iter()
        .map(|w| match w {
            BlockWord::Word(w) => Some(*w),
            BlockWord::Value(_) => None,
        })
        .collect();
    let mut marks = words
        .iter()
        .enumerate()
        .filter_map(|(at, w)| w.is_none().then_some(at));
    let (Some(at), None) = (marks.next(), marks.next()) else {
        return Err("a block carries `value` exactly once");
    };
    if words.len() - 1 + usize::from(width(kind)) > MAX_BLOCK {
        return Err("a block is at most 123 registers");
    }
    Ok(Step::WriteBlock {
        register: doc.register,
        head: words.iter().take(at).flatten().copied().collect(),
        tail: words.iter().skip(at + 1).flatten().copied().collect(),
    })
}

fn setting(key: String, doc: SettingDoc) -> Result<Setting, (String, &'static str)> {
    let refuse = |problem| Err((key.clone(), problem));
    let scale = doc.scale.unwrap_or(1.0);
    if !scale.is_finite() || scale == 0.0 {
        return refuse("the scale must be a non-zero number");
    }
    if doc.range.is_none() && doc.values.is_none() {
        return refuse("declare its `range` or its `values`");
    }
    if doc.range.is_some_and(|r| r.min > r.max) {
        return refuse("the range is inverted");
    }
    if doc.recipe.is_empty() {
        return refuse("the recipe has no step");
    }
    if doc.read_back.is_some() == doc.write_only {
        return refuse("declare a `readBack`, or `writeOnly` when the device cannot be read");
    }
    let recipe = doc
        .recipe
        .into_iter()
        .map(|step| match step {
            StepDoc::Write(r) => Ok(Step::Write {
                register: r.register,
            }),
            StepDoc::WriteBlock(b) => block(&b, doc.kind),
            StepDoc::Delay(d) if d.ms > MAX_DELAY_MS => {
                Err("a delay is at most 10000 ms: the device's polls wait for it")
            }
            StepDoc::Delay(d) => Ok(Step::Delay(Duration::from_millis(d.ms.into()))),
        })
        .collect::<Result<_, _>>()
        .map_err(|problem| (key.clone(), problem))?;
    Ok(Setting {
        key,
        kind: doc.kind,
        scale,
        range: doc.range,
        values: doc.values,
        min_interval: Duration::from_secs(doc.min_interval),
        recipe,
        read_back: doc.read_back.map(|r| r.register),
    })
}
