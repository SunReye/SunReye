# 29. Grid and market rules

Status: accepted (2026-11-23)

## Context

What a German plant may feed in and what it earns depends on law that changes with its commissioning date and with events after it: the export cap of February 2025, no pay at negative prices once a smart meter gateway is fitted, feed-in rates the Bundesnetzagentur republishes each half-year, the meter operator's yearly charges. EEG 2023 covers plants commissioned up to 31 Dec 2026; the bill meant to follow it (BT-Drs. 21/7867) had not been voted on by 23 Nov 2026. The forecast, the economics and a consumer's offer must read the same figures, and the EMS stage (ADR 1) will need the same cap and prices. A constant in a crate carries no source and no status, and goes stale without a sound.

## Decision

**A rule set, as data.** The rules are data files in `packages/rules`, read by a pure crate, `sunreye-rules` (no I/O, built for `wasm32-unknown-unknown` like `pv`), and published as `@sunreye/rules` (ADR 25), as the module catalogue is. A rule has:

- an id, stable and never reused;
- a status: in force, bill, or expired;
- a commissioning window, from a date up to another, and the plant facts it applies to: kWp, sale form, whether it is on a building, the size class;
- an end: a date, or an event: the smart meter gateway's control tested, the end of the year it was fitted, a number of months after commissioning;
- one effect, of a closed set of kinds;
- its source: the law or publication, its paragraph, the sentence quoted as published, the URL, the consolidated text's `Stand` line and the date it was read. A value that is no law, such as a marketer's fee, is an assumption: its source says so and names who set it.

A rule's source is a public text. VDE-AR-N 4105 and 4100, the connection rules for low voltage, are sold, but grid operators restate their values in their published connection conditions (TAB) and forms, and VDE FNN in its public notes: such a rule quotes at least two independent operators, each with its date, and reads "per TAB of <operator>, restating VDE-AR-N 4105:2026-03" (or the edition the operator actually cites). Operators that copy one model text, such as BDEW's, count as one source. The plant's own operator's TAB governs, so the rule says so.

**Effect kinds.** Each kind has a reader in the crates now:

- *Export cap*: a share of kWp that may be fed in at the grid point, and the ways it may be met, each with its window: at the grid point by a device that limits or monitors feed-in, or by a lasting limit set in the inverter.
- *Feed-in rate*: ct/kWh by size class, for partial or full feed-in, for a term in months; a plant spanning size classes is paid the blend the law sets. What follows the term is the next rule in the set, or market value.
- *Negative-price zero*: no pay for a quarter-hour whose spot price is negative, from an event, and how the law extends the term to make up for it.
- *Meter cost*: € a year by size class, for the meter and the control unit, and a one-off charge, each as the law caps it in total and as the share the plant's operator pays; economics counts the operator's share.
- *Connection limit*: a limit on the plant's AC side with its threshold: the largest imbalance between phases, the reactive power mode by size, the size above which a central grid protection is needed. The electrical checks on a layout (ADR 17) read it against the inverters' AC ratings (ADR 27).

Controllable loads (§ 14a EnWG) and storage that also charges from the grid become kinds when the EMS stage reads them. A kind is added by changing the crate; there are no formulas in the data. A consumer may keep rules of its own in the same format, with kinds of its own, outside this repository.

**Connection limits as first sourced (2026-11-23).** Read from public texts on 23 Nov 2026; the quotes, links and dates are in the rules' sources.

- *Phase imbalance:* single-phase generation, storage and charging at most 4.6 kVA per phase and direction; a unit above 4.6 kVA connects three-phase. BDEW's TAB 2026 model text (as adopted by DVV Dessau, 30 Jul 2026, and Mainzer Netze, Nov 2026) and Syna's TAB (1 Jan 2025); VDE FNN's note on symmetry (Dec 2019). The value is VDE-AR-N 4100's, which 4105 refers to; no text says 4105:2026-03 changed it.
- *Central grid protection:* above a sum of 30 kVA apparent power of all units at the connection, new and existing; a feed-in monitor does not lower the sum. Netze BW (24 Feb 2026), Netze ODR (May 2026), Stromnetz Berlin (Mar 2023); VDE FNN FAQ 6.1.
- *Export cap means:* at the grid point by an energy management system, or by a lasting limit at the inverter. Mitnetz (read 23 Nov 2026) and enercity Netz (undated form); Netze BW and Netze ODR (one template) state the cap at the grid point.
- *Reactive power:* operators' texts still restate 4105:2018: an inverter of a sum up to 4.6 kVA can run cos φ 0.95, above it 0.90, the method as the operator prescribes (Syna 1 Jan 2025, N-ERGIE May 2025, Netze ODR May 2026). The default method differs by operator (Q(U), cos φ(P) or fixed), so the rule records the capability by size and the check names the operator's method as theirs.

**Resolution.** Given a commissioning date and a plant's facts, the crate returns the rules that apply, each with its status, source and end. A figure computed from a bill rule carries the status to its caller, which labels it. A date that only a bill covers resolves to the bill, not to the law that ended before it. A date nothing covers resolves to nothing, and the figures that need it are absent: no rate is extrapolated. Comparing two commissioning dates is two resolutions.

**After the term.** Under the bill, the fixed pay lasts 36 months; then the plant sells in direct marketing. Its export then earns market value: each quarter-hour's export at that quarter-hour's spot price, none below zero, plus the bill's bonus while it lasts, less a marketer's fee. The fee is an assumption the caller may change; the set holds its default, and the caller prints it.

**Reference spot year.** Economics needs spot prices for every year it models, and none are known. It reads the last full calendar year of DE-LU day-ahead prices for each one, a dated file in the same package. The source is Energy-Charts, whose price endpoint states for DE-LU "CC BY 4.0 … from Bundesnetzagentur | SMARD.de" (read 23 Nov 2026); every figure computed from it credits "Bundesnetzagentur | SMARD.de". The day-ahead market moved to quarter-hours on 1 Oct 2025, so 2025 is hourly before that date, and an hour's price holds for its four quarter-hours.

**Upkeep.** The owner keeps the set by hand: when the Bundesnetzagentur publishes rates (1 February, 1 August), on each change in law, and the reference spot year each January. Nothing is fetched or scraped. The set has a version and a `Stand`: the last date its sources were checked. Every figure computed from it is printed with the `Stand`. A test refuses a rule without a source, two rules in force of one kind for the same facts and dates, and a window that ends before it starts.

**Stored with its figures.** Whatever stores a figure computed from the set stores the set's version beside it: a plant document (ADR 26), a consumer's frozen figures. A newer set never changes a stored figure.

**Overrides.** A caller may replace a rule's value for one plant. The override names the rule it replaces, and both are reported.

**Out of the set.** Values that differ by grid operator, such as § 14a fee relief and an operator's own additions to its TAB; tenant power, building supply (§ 42b EnWG) and energy sharing; installation standards.

## Open before build

- The marketer's fee's default.
- Market value as defined above, each quarter-hour at its own spot price, is our reading of the owner's "market value"; the owner confirms it or chooses the published monthly market value for solar instead.
- When the bill's 48-month bonus starts counting: the draft's § 50c is to be read for it.
- Connection values with one source so far: 4105:2026-03's uniform cos φ 0.90 with Q(U) preset (Netze BW and VDE FNN only, while 2018 certificates are accepted until 1 Mar 2027); a locked inverter limit lowering the 30 kVA sum, and the export cap's three certified means until 1 Mar 2028 (VDE FNN FAQ only). Each enters the set when a second operator states it; until then a check that would rely on it says so.
- What the connection limits need beyond an AC rating: an inverter type's phase count and its largest apparent power (ADR 27), and the phase a single-phase inverter feeds (ADR 17). Both are stored contracts, so they are added before the first check reads them.
- The bill's vote: the owner marks its rules in force, rewrites them or expires them. A change to the 50 % cap reported in mid-November 2026 is unverified.

## Considered options

- **Constants in the crates.** Rejected: rates change twice a year and law more often, a constant has no source or status, and a stale one passes every test.
- **The rules in a consumer's private repository.** Rejected: the app and its EMS need the same cap and prices, and two copies would disagree.
- **Fetching rates from the Bundesnetzagentur.** Rejected: it publishes a spreadsheet per half-year in no fixed format; a misread rate would reach a customer unseen.
- **EEG 2023 for every date until the bill passes.** Rejected: EEG 2023 itself ends with 2026 commissioning.
- **The bill treated as law.** Rejected: figures would be stated as certain while Parliament may change them.
- **Effects as formulas in the data.** Rejected: an engine cannot know what an arbitrary formula does to its quarter-hour loop; a closed set of kinds is tested once.
- **ENTSO-E for spot prices.** Not used: its terms could not be read (23 Nov 2026), and Energy-Charts states its licence on each answer.

## Consequences

The rule format is a published contract like the plant document: versioned and additive. Any figure that depends on law now has a status and a date, and a consumer must show both.
