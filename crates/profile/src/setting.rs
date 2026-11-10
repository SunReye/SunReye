//! Settings (ADR 5, 7): what the core may write, the steps that write it and where it reads back.

use std::collections::BTreeMap;
use std::time::Duration;

use crate::Unit;
use crate::document::{
    BlockDoc, BlockWord, Kind, PreconditionDoc, Range, ReadBackDoc, SettingDoc, StepDoc, ToggleDoc,
    UnlockDoc,
};
use crate::profile::{Quantity, Read};

/// One writable device parameter.
#[derive(Debug, Clone)]
pub struct Setting {
    pub key: String,
    name: Option<String>,
    unit: Option<Unit>,
    /// The text for each value, in the order of `values`.
    labels: Vec<(f64, String)>,
    kind: Kind,
    scale: f64,
    range: Option<Range>,
    values: Option<Vec<f64>>,
    min_interval: Duration,
    recipe: Vec<Step>,
    read_back: Option<Source>,
    /// The text each value publishes as, from its read-back quantity; empty to publish numbers.
    texts: Vec<(String, f64)>,
    verified: bool,
}

/// Where a value is read: a device's register, or a quantity read from a topic, by its position in
/// [`crate::Profile::quantities`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Register(Field),
    Quantity(usize),
}

/// The bits `mask` selects of `register`: where a write is read back, or what a precondition
/// reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Field {
    pub register: u16,
    /// `0xFFFF` for the whole register.
    pub mask: u16,
}

impl Field {
    /// The bits of `word` the mask selects, shifted down to bit 0.
    #[must_use]
    pub const fn extract(&self, word: u16) -> u16 {
        (word & self.mask) >> self.mask.trailing_zeros()
    }
}

/// One step of a recipe.
#[derive(Debug, Clone, PartialEq)]
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
    /// Reads `register` and writes it back with the value's word in the bits `mask` selects.
    Rmw { register: u16, mask: u16 },
    /// Refuses the write before anything is written unless `source` holds one of `values`.
    Precondition { source: Source, values: Vec<u16> },
    /// Publishes the value, unretained, to `topic` under the connection's root, with `{address}`
    /// unsubstituted.
    Publish { topic: String },
    /// Writes `value` to the enable field `register`, last, once the value is in place.
    Activate { register: u16, value: u16 },
    /// Writes a secret of the device's connection, by name; its relock runs even after a failure.
    Unlock(Unlock),
    /// Waits before the next step; the endpoint's polls wait with it.
    Delay(Duration),
    /// Locks another setting at a fixed value and restores it on release; the only step.
    SnapshotToggle(Toggle),
}

/// A switch over another setting: 1 stores the target's value and writes `locked`, 0 writes the
/// stored value back. Each write is the target's, through the funnel.
#[derive(Debug, Clone, PartialEq)]
pub struct Toggle {
    /// The key of the setting it locks.
    pub target: String,
    pub locked: f64,
}

/// Unlocks the device with a secret its connection holds by name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unlock {
    pub register: u16,
    kind: Kind,
    /// The secret's name on the connection.
    pub secret: String,
    finally: Vec<Relock>,
}

impl Unlock {
    /// The words of the secret `code`, low word first; `None` unless it is a whole number in
    /// decimal digits that fits the type.
    #[must_use]
    pub fn encode(&self, code: &str) -> Option<Vec<u16>> {
        if code.is_empty() || !code.bytes().all(|b| b.is_ascii_digit() || b == b'-') {
            return None;
        }
        match self.kind {
            Kind::U16 => code.parse::<u16>().ok().map(|w| vec![w]),
            Kind::I16 => code
                .parse::<i16>()
                .ok()
                .map(|w| vec![u16::from_ne_bytes(w.to_ne_bytes())]),
            Kind::U32 | Kind::Acc32 => code
                .parse::<u32>()
                .ok()
                .map(|w| vec![(w & 0xFFFF) as u16, (w >> 16) as u16]),
        }
    }
}

/// Fixed words written from `register` in one request, to relock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relock {
    pub register: u16,
    pub words: Vec<u16>,
}

impl Step {
    /// Whether it writes the setting's value, as opposed to a fixed word or nothing.
    const fn writes_value(&self) -> bool {
        match self {
            Self::Write { .. }
            | Self::WriteBlock { .. }
            | Self::Rmw { .. }
            | Self::Publish { .. } => true,
            Self::Activate { .. }
            | Self::Delay(_)
            | Self::Precondition { .. }
            | Self::Unlock(_)
            | Self::SnapshotToggle(_) => false,
        }
    }
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

    /// Its unlock step, if it has one.
    #[must_use]
    pub fn unlock(&self) -> Option<&Unlock> {
        self.recipe.iter().find_map(|step| {
            if let Step::Unlock(unlock) = step {
                Some(unlock)
            } else {
                None
            }
        })
    }

    /// The relock steps of its unlock, run even after a failure; empty without an unlock.
    #[must_use]
    pub fn finally(&self) -> &[Relock] {
        self.unlock().map_or(&[], |unlock| &unlock.finally)
    }

    /// The setting it locks, when it is a snapshot toggle.
    #[must_use]
    pub const fn toggle(&self) -> Option<&Toggle> {
        match self.recipe.as_slice() {
            [Step::SnapshotToggle(toggle)] => Some(toggle),
            _ => None,
        }
    }

    /// Where a write is read back; `None` for a write-only setting.
    #[must_use]
    pub const fn read_back(&self) -> Option<Source> {
        self.read_back
    }

    /// What publishing `value` sends: the text its read-back maps it to, or else the number.
    #[must_use]
    pub fn payload(&self, value: f64) -> Option<String> {
        if self.texts.is_empty() {
            return Some(value.to_string());
        }
        self.texts
            .iter()
            .find(|(_, v)| v.to_bits() == value.to_bits())
            .map(|(text, _)| text.clone())
    }

    /// What the settings screen calls it, when the profile names it.
    #[must_use]
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    /// The unit of its value, when it has one.
    #[must_use]
    pub const fn unit(&self) -> Option<Unit> {
        self.unit
    }

    /// The text for each value the profile labels, in the order of its values.
    #[must_use]
    pub fn labels(&self) -> &[(f64, String)] {
        &self.labels
    }

    /// Whether its write was checked on real hardware (ADR 5).
    #[must_use]
    pub const fn verified(&self) -> bool {
        self.verified
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
        let fits = self.recipe.iter().all(|step| {
            if let Step::Rmw { mask, .. } = *step {
                u16::try_from(raw)
                    .is_ok_and(|w| u32::from(w) << mask.trailing_zeros() & !u32::from(mask) == 0)
            } else {
                true
            }
        });
        if !allowed || !fits {
            return None;
        }
        match self.kind {
            Kind::U16 => u16::try_from(raw).ok().map(|w| vec![w]),
            Kind::I16 => i16::try_from(raw)
                .ok()
                .map(|w| vec![u16::from_ne_bytes(w.to_ne_bytes())]),
            Kind::U32 | Kind::Acc32 => u32::try_from(raw)
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
            Kind::U32 | Kind::Acc32 => f64::from(u32::from(*words.get(1)?) << 16 | u32::from(low)),
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
    kind.words()
}

pub fn compile(
    docs: Vec<SettingDoc>,
    quantities: &[Quantity],
) -> Result<Vec<Setting>, (String, &'static str)> {
    let mut settings: Vec<Setting> = Vec::with_capacity(docs.len());
    for doc in docs {
        if settings.iter().any(|s| s.key == doc.key) {
            return Err((doc.key, "the key is declared twice"));
        }
        settings.push(setting(doc.key.clone(), doc, quantities)?);
    }
    for setting in &settings {
        let Some(toggle) = setting.toggle() else {
            continue;
        };
        let problem = match settings.iter().find(|s| s.key == toggle.target) {
            None => "a snapshot toggle targets a setting of the profile",
            Some(target) if target.toggle().is_some() => {
                "a snapshot toggle's target is not a toggle"
            }
            Some(target) if target.read_back.is_none() => "a snapshot toggle's target reads back",
            Some(target) if target.encode(toggle.locked).is_none() => {
                "a snapshot toggle's locked value is one its target takes"
            }
            Some(_) => continue,
        };
        return Err((setting.key.clone(), problem));
    }
    Ok(settings)
}

/// A snapshot toggle's own rules: the only step, switched by 0 and 1, read back through its
/// target.
fn toggle(doc: &SettingDoc) -> Result<(), &'static str> {
    if !doc
        .recipe
        .iter()
        .any(|s| matches!(s, StepDoc::SnapshotToggle(_)))
    {
        return Ok(());
    }
    if doc.recipe.len() != 1 {
        return Err("a snapshot toggle is its setting's only step");
    }
    if doc.read_back.is_some() || doc.write_only {
        return Err("a snapshot toggle reads back through its target");
    }
    if doc.range.is_some() || doc.values.as_deref() != Some(&[0.0, 1.0]) {
        return Err("a snapshot toggle takes the values 0 and 1");
    }
    Ok(())
}

fn mask(mask: u16, kind: Kind) -> Result<u16, &'static str> {
    if kind != Kind::U16 {
        return Err("a masked register holds a `u16`");
    }
    nonzero(mask)
}

const fn nonzero(mask: u16) -> Result<u16, &'static str> {
    if mask == 0 {
        return Err("a mask selects at least one bit");
    }
    Ok(mask)
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

/// The scale, once the scale, the bounds and the recipe are each declared.
fn bounds(doc: &SettingDoc) -> Result<f64, &'static str> {
    let scale = doc.scale.unwrap_or(1.0);
    if !scale.is_finite() || scale == 0.0 {
        return Err("the scale must be a non-zero number");
    }
    if doc.range.is_none() && doc.values.is_none() {
        return Err("declare its `range` or its `values`");
    }
    if doc.range.is_some_and(|r| r.min > r.max) {
        return Err("the range is inverted");
    }
    if doc.recipe.is_empty() {
        return Err("the recipe has no step");
    }
    Ok(scale)
}

fn setting(
    key: String,
    doc: SettingDoc,
    quantities: &[Quantity],
) -> Result<Setting, (String, &'static str)> {
    let refuse = |problem| Err((key.clone(), problem));
    let scale = match bounds(&doc).and_then(|scale| toggle(&doc).map(|()| scale)) {
        Ok(scale) => scale,
        Err(problem) => return refuse(problem),
    };
    let toggles = matches!(doc.recipe.as_slice(), [StepDoc::SnapshotToggle(_)]);
    if !toggles && doc.read_back.is_some() == doc.write_only {
        return refuse("declare a `readBack`, or `writeOnly` when the device cannot be read");
    }
    if doc.kind == Kind::Acc32 {
        return refuse("an acc32 is read, never written");
    }
    let kind = doc.kind;
    let recipe = recipe(doc.recipe, kind, quantities).map_err(|problem| (key.clone(), problem))?;
    let read_back = doc
        .read_back
        .as_ref()
        .map(|r| read_back(r, kind, quantities))
        .transpose()
        .map_err(|problem| (key.clone(), problem))?;
    if !binding(&recipe, read_back, quantities) {
        return refuse("a setting writes through its profile's binding");
    }
    let texts = texts(
        read_back,
        quantities,
        doc.range.is_some(),
        doc.values.as_deref(),
    )
    .map_err(|problem| (key.clone(), problem))?;
    let labels =
        labels(doc.labels, doc.values.as_deref()).map_err(|problem| (key.clone(), problem))?;
    Ok(Setting {
        key,
        name: doc.name,
        unit: doc.unit,
        labels,
        kind: doc.kind,
        scale,
        range: doc.range,
        values: doc.values,
        min_interval: Duration::from_secs(doc.min_interval),
        recipe,
        read_back,
        texts,
        verified: doc.verified.unwrap_or(false),
    })
}

/// Each label's value, in the order of `values`; refused when a label names a value not among
/// them.
fn labels(
    labels: Option<BTreeMap<String, String>>,
    values: Option<&[f64]>,
) -> Result<Vec<(f64, String)>, &'static str> {
    let mut labels = labels.unwrap_or_default();
    let values = values.unwrap_or_default();
    let found = values
        .iter()
        .filter_map(|v| labels.remove(&v.to_string()).map(|text| (*v, text)))
        .collect();
    if labels.is_empty() {
        Ok(found)
    } else {
        Err("a label names a value the setting does not take")
    }
}

/// Whether every step and the read-back use the profile's binding: topics when it reads any,
/// registers otherwise. The `http` binding writes nothing.
fn binding(recipe: &[Step], read_back: Option<Source>, quantities: &[Quantity]) -> bool {
    if quantities
        .iter()
        .any(|q| matches!(q.read, Read::Json { .. }))
    {
        return false;
    }
    let topics = quantities
        .iter()
        .any(|q| matches!(q.read, Read::Topic { .. }));
    let source = |s: &Source| matches!(s, Source::Quantity(_)) == topics;
    let steps = recipe.iter().all(|step| match step {
        Step::Publish { .. } => topics,
        Step::Precondition { source: s, .. } => source(s),
        Step::Delay(_) | Step::SnapshotToggle(_) => true,
        Step::Write { .. }
        | Step::WriteBlock { .. }
        | Step::Rmw { .. }
        | Step::Activate { .. }
        | Step::Unlock(_) => !topics,
    });
    steps && read_back.as_ref().is_none_or(source)
}

/// The texts of the quantity `read_back` names; empty when it maps none. A setting reading back
/// through texts takes only the values they map.
fn texts(
    read_back: Option<Source>,
    quantities: &[Quantity],
    ranged: bool,
    values: Option<&[f64]>,
) -> Result<Vec<(String, f64)>, &'static str> {
    let Some(Source::Quantity(at)) = read_back else {
        return Ok(Vec::new());
    };
    let Some(Read::Topic { texts, .. }) = quantities.get(at).map(|q| &q.read) else {
        return Ok(Vec::new());
    };
    let mapped = |v: &f64| texts.iter().any(|(_, t)| t.to_bits() == v.to_bits());
    if !texts.is_empty() && (ranged || !values.unwrap_or_default().iter().all(mapped)) {
        return Err("each value is a text its read-back maps");
    }
    Ok(texts.clone())
}

/// A register, or else the position of a quantity read from a topic.
fn source(
    register: Option<u16>,
    quantity: Option<&str>,
    quantities: &[Quantity],
) -> Result<Result<u16, usize>, &'static str> {
    const NAMES: &str =
        "a read-back or precondition names a register or a quantity read from a topic";
    match (register, quantity) {
        (Some(register), None) => Ok(Ok(register)),
        (None, Some(key)) => quantities
            .iter()
            .position(|q| q.key == key && matches!(q.read, Read::Topic { .. }))
            .map(Err)
            .ok_or(NAMES),
        _ => Err(NAMES),
    }
}

/// A topic under the connection's root, as a quantity's.
fn topic(topic: String) -> Result<Step, &'static str> {
    if topic.is_empty() || topic.starts_with('/') || topic.contains(['+', '#']) {
        return Err("a topic is a path under the root, without wildcards");
    }
    Ok(Step::Publish { topic })
}

fn step(doc: StepDoc, kind: Kind, quantities: &[Quantity]) -> Result<Step, &'static str> {
    match doc {
        StepDoc::Write(r) => Ok(Step::Write {
            register: r.register,
        }),
        StepDoc::WriteBlock(b) => block(&b, kind),
        StepDoc::Rmw(m) => mask(m.mask, kind).map(|mask| Step::Rmw {
            register: m.register,
            mask,
        }),
        StepDoc::Delay(d) if d.ms > MAX_DELAY_MS => {
            Err("a delay is at most 10000 ms: the device's polls wait for it")
        }
        StepDoc::Delay(d) => Ok(Step::Delay(Duration::from_millis(d.ms.into()))),
        StepDoc::Precondition(p) if p.values.is_empty() => {
            Err("a precondition lists the values it allows")
        }
        StepDoc::Precondition(p) => precondition(p, quantities),
        StepDoc::Publish(p) => topic(p.topic),
        StepDoc::Activate(a) => Ok(Step::Activate {
            register: a.register,
            value: a.value,
        }),
        StepDoc::Unlock(u) => unlock(u),
        StepDoc::SnapshotToggle(ToggleDoc { target, locked }) => {
            Ok(Step::SnapshotToggle(Toggle { target, locked }))
        }
    }
}

fn precondition(doc: PreconditionDoc, quantities: &[Quantity]) -> Result<Step, &'static str> {
    let source = match source(doc.register, doc.quantity.as_deref(), quantities)? {
        Ok(register) => Source::Register(Field {
            register,
            mask: doc.mask.map_or(Ok(0xFFFF), nonzero)?,
        }),
        Err(_) if doc.mask.is_some() => return Err("a mask selects bits of a register"),
        Err(at) => Source::Quantity(at),
    };
    Ok(Step::Precondition {
        source,
        values: doc.values,
    })
}

fn recipe(
    docs: Vec<StepDoc>,
    kind: Kind,
    quantities: &[Quantity],
) -> Result<Vec<Step>, &'static str> {
    let steps: Vec<Step> = docs
        .into_iter()
        .map(|doc| step(doc, kind, quantities))
        .collect::<Result<_, _>>()?;
    let checks = steps
        .iter()
        .take_while(|s| matches!(s, Step::Precondition { .. }))
        .count();
    if steps
        .iter()
        .skip(checks)
        .any(|s| matches!(s, Step::Precondition { .. }))
    {
        return Err("a precondition comes before every other step");
    }
    if !unlocks_first(&steps, checks) {
        return Err("an unlock comes once, after the preconditions and before every write");
    }
    let last = steps.len() - 1;
    for (at, step) in steps.iter().enumerate() {
        let valued = steps.iter().take(at).any(Step::writes_value);
        if matches!(step, Step::Activate { .. }) && (at != last || !valued) {
            return Err("`activate` is the last step, after one that writes the value");
        }
    }
    Ok(steps)
}

fn read_back(
    doc: &ReadBackDoc,
    kind: Kind,
    quantities: &[Quantity],
) -> Result<Source, &'static str> {
    match source(doc.register, doc.quantity.as_deref(), quantities)? {
        Ok(register) => Ok(Source::Register(Field {
            register,
            mask: doc.mask.map_or(Ok(0xFFFF), |m| mask(m, kind))?,
        })),
        Err(_) if doc.mask.is_some() => Err("a mask selects bits of a register"),
        Err(at) => Ok(Source::Quantity(at)),
    }
}

/// Whether the one unlock, if any, is the first step after the preconditions.
fn unlocks_first(steps: &[Step], checks: usize) -> bool {
    let mut at = steps
        .iter()
        .enumerate()
        .filter(|(_, s)| matches!(s, Step::Unlock(_)))
        .map(|(at, _)| at);
    match (at.next(), at.next()) {
        (None, _) => true,
        (Some(at), None) => at == checks,
        (Some(_), Some(_)) => false,
    }
}

fn unlock(doc: UnlockDoc) -> Result<Step, &'static str> {
    if doc.secret.is_empty() {
        return Err("an unlock names its secret");
    }
    if doc
        .finally
        .iter()
        .any(|r| r.words.is_empty() || r.words.len() > MAX_BLOCK)
    {
        return Err("a relock writes 1 to 123 registers");
    }
    Ok(Step::Unlock(Unlock {
        register: doc.register,
        kind: doc.kind,
        secret: doc.secret,
        finally: doc
            .finally
            .into_iter()
            .map(|r| Relock {
                register: r.register,
                words: r.words,
            })
            .collect(),
    }))
}
