//! PV production forecast, the pure half: an irradiance series and the plant's arrays become per-slot AC
//! watts, a usable view clipped by the feed-in cap and battery, plant-local daily sums and the next
//! 15 minutes. Held to `fixtures/oracle/forecast.ndjson`.

mod clip;
mod correction;
mod geometry;
mod power;

use jiff::Timestamp;
use jiff::civil::DateTime;
use jiff::tz::TimeZone;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use correction::{CorrectionCell, CorrectionModel};
pub use geometry::{SunPosition, cos_aoi, sun_position};
pub use power::{PvSample, STC_CELL_TEMP_C, pv_power_w};

const HOUR_MS: i64 = 3_600_000;
const QUARTER_HOUR_MS: i64 = 900_000;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PvArray {
    pub kwp: f64,
    /// Degrees from horizontal.
    pub tilt: f64,
    /// Degrees: 0 south, -90 east, 90 west.
    pub azimuth: f64,
    /// %/°C; the plant's when absent. 0 is a statement, not absence.
    pub temp_coefficient: Option<f64>,
    /// %; the plant's when absent.
    pub system_loss: Option<f64>,
}

/// The battery the clipping sim models.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub usable_kwh: f64,
    /// W; unbounded when absent.
    pub max_charge_w: Option<f64>,
    /// Reserve floor, %.
    pub min_soc: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastConfig {
    pub arrays: Vec<PvArray>,
    /// Plant default, %/°C.
    pub temp_coefficient: f64,
    /// Plant default, %.
    pub system_loss: f64,
    /// Feed-in cap, W; none when absent.
    pub max_output_w: Option<f64>,
    pub battery: Option<Battery>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}

/// A provider's series: instantaneous samples on a grid of at most an hour, one `gti` row per array.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Irradiance {
    /// Plant-local `YYYY-MM-DDTHH:mm` at `utc_offset_seconds`.
    pub times: Vec<String>,
    pub utc_offset_seconds: i32,
    pub location: Location,
    /// °C.
    pub temperature: Vec<f64>,
    /// W/m², per array.
    pub gti: Vec<Vec<f64>>,
    /// W/m².
    pub dni: Option<Vec<f64>>,
    /// m/s.
    pub wind_speed: Option<Vec<f64>>,
}

/// Live readings the clipping sim starts from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimInputs {
    /// Battery SOC at `now`, %.
    pub start_soc_pct: Option<f64>,
    /// W; 0 when absent.
    pub house_load_w: Option<f64>,
    /// Measured SOC at the series' first slot, %: lets the sim reconstruct the slots already over.
    pub day_start_soc_pct: Option<f64>,
}

/// What a build runs against besides the plant and the series.
#[derive(Debug, Clone, Copy)]
pub struct Run<'a> {
    /// Plant zone the daily sums bucket by.
    pub time_zone: &'a TimeZone,
    pub now_ms: i64,
    pub sim: SimInputs,
    pub correction: Option<&'a CorrectionModel>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("irradiance time {0:?} is not YYYY-MM-DDTHH:mm")]
    Time(String),
    #[error("plant day out of range: {0}")]
    Calendar(#[from] jiff::Error),
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    /// Slot start, plant-local.
    pub time: String,
    /// Average over the slot, W.
    pub watts: f64,
    /// Peak within the slot, W.
    pub peak_watts: f64,
}

/// The 15 minutes after `now`; `avg_power_w × 0.25 h` equals `energy_kwh`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Next15 {
    pub max_power_w: f64,
    pub avg_power_w: f64,
    pub energy_kwh: f64,
}

/// One power projection over the series and its sums.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForecastView {
    pub series: Vec<Point>,
    pub today_kwh: f64,
    /// From `now` to plant-local midnight, the running slot prorated.
    pub remaining_today_kwh: f64,
    pub tomorrow_kwh: f64,
    pub next15: Next15,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Forecast {
    pub provider: String,
    pub step_minutes: i64,
    pub utc_offset_seconds: i32,
    /// After the feed-in cap and battery curtail it; equal to `raw` when nothing clips.
    pub usable: ForecastView,
    /// Uncurtailed PV potential.
    pub raw: ForecastView,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    Raw,
    Usable,
}

/// One slot of the Solcast-shaped curve Home Assistant PV blueprints read.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct DetailedPoint {
    pub period_start: String,
    pub watts: f64,
}

/// One view as published: metadata, the view, and the Solcast-shaped curve.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastExport<'a> {
    pub provider: &'a str,
    pub step_minutes: i64,
    pub utc_offset_seconds: i32,
    #[serde(flatten)]
    pub view: &'a ForecastView,
    pub detailed_forecast: Vec<DetailedPoint>,
}

impl Forecast {
    pub fn export(&self, variant: Variant) -> ForecastExport<'_> {
        let view = match variant {
            Variant::Raw => &self.raw,
            Variant::Usable => &self.usable,
        };
        let offset = iso_offset(self.utc_offset_seconds);
        ForecastExport {
            provider: &self.provider,
            step_minutes: self.step_minutes,
            utc_offset_seconds: self.utc_offset_seconds,
            view,
            detailed_forecast: view
                .series
                .iter()
                .map(|p| DetailedPoint { period_start: format!("{}:00{offset}", p.time), watts: p.watts })
                .collect(),
        }
    }
}

/// `+02:00`, `-03:30`, `Z`.
fn iso_offset(seconds: i32) -> String {
    if seconds == 0 {
        return "Z".into();
    }
    let sign = if seconds < 0 { '-' } else { '+' };
    let abs = seconds.unsigned_abs();
    format!("{sign}{:02}:{:02}", abs / 3600, (abs % 3600) / 60)
}

/// Each sample opens the slot to the next one, its width capped at an hour so a gap degrades to an
/// hour-wide point sample; the last inherits the width before it.
#[derive(Debug)]
struct Slots {
    labels: Vec<DateTime>,
    start_ms: Vec<i64>,
    width_ms: Vec<i64>,
    now_ms: i64,
}

impl Slots {
    fn of(data: &Irradiance, now_ms: i64) -> Result<Self, Error> {
        let n = data.times.len();
        let (mut labels, mut start_ms) = (Vec::with_capacity(n), Vec::with_capacity(n));
        for time in &data.times {
            let label: DateTime = time.parse().map_err(|_| Error::Time(time.clone()))?;
            let utc = label.to_zoned(TimeZone::UTC)?.timestamp().as_millisecond();
            labels.push(label);
            start_ms.push(utc - i64::from(data.utc_offset_seconds) * 1000);
        }
        let width_ms = (0..n)
            .map(|i| {
                let gap = match (start_ms.get(i + 1), i.checked_sub(1).and_then(|p| start_ms.get(p))) {
                    (Some(next), _) => next - start_ms[i],
                    (None, Some(previous)) => start_ms[i] - previous,
                    (None, None) => HOUR_MS,
                };
                gap.clamp(1, HOUR_MS)
            })
            .collect();
        Ok(Self { labels, start_ms, width_ms, now_ms })
    }

    /// Slot `i` and the next sample are adjacent: integrated together, not a point sample.
    fn paired(&self, i: usize) -> bool {
        self.start_ms.get(i + 1).is_some_and(|next| next - self.start_ms[i] <= HOUR_MS)
    }

    #[allow(clippy::cast_precision_loss, reason = "slot widths of at most an hour are exact in f64")]
    fn kwh(&self, series: &[Point], i: usize) -> f64 {
        ((series[i].watts * self.width_ms[i] as f64) / HOUR_MS as f64) / 1000.0
    }
}

/// Instantaneous plant AC power per sample, each array with its own coefficient and loss, scaled by the
/// learned correction when one is given.
fn instant_power_w(config: &ForecastConfig, data: &Irradiance, slots: &Slots, run: &Run) -> Vec<f64> {
    let at = |series: Option<&Vec<f64>>, i: usize| series.and_then(|s| s.get(i)).copied();
    (0..data.times.len())
        .map(|i| {
            let sun = sun_position(data.location.latitude, data.location.longitude, slots.start_ms[i]);
            let mut watts = 0.0;
            for (a, array) in config.arrays.iter().enumerate() {
                let sample = PvSample {
                    gti_wm2: at(data.gti.get(a), i).unwrap_or(0.0),
                    ambient_c: data.temperature.get(i).copied().unwrap_or(STC_CELL_TEMP_C),
                    dni_wm2: at(data.dni.as_ref(), i),
                    cos_aoi: Some(cos_aoi(sun, array.tilt, array.azimuth)),
                    wind_ms: at(data.wind_speed.as_ref(), i),
                };
                watts += pv_power_w(
                    &sample,
                    array.kwp,
                    array.temp_coefficient.unwrap_or(config.temp_coefficient),
                    array.system_loss.unwrap_or(config.system_loss),
                );
            }
            let label = slots.labels[i];
            run.correction.map_or(watts, |model| watts * model.factor(label.month(), label.hour()))
        })
        .collect()
}

/// Average power over each slot as the trapezoid of its endpoints, so a bar matches the energy of its
/// slot; the peak is the larger endpoint.
fn integrate(data: &Irradiance, instant_w: &[f64], slots: &Slots) -> Vec<Point> {
    let mut series = Vec::with_capacity(instant_w.len());
    for (i, (time, &w)) in data.times.iter().zip(instant_w).enumerate() {
        let next_w = if slots.paired(i) { instant_w.get(i + 1).copied().unwrap_or(w) } else { w };
        let watts = if slots.paired(i) { f64::midpoint(w, next_w) } else { w };
        series.push(Point { time: time.clone(), watts, peak_watts: w.max(next_w) });
    }
    series
}

/// Today and tomorrow in the plant zone, as instants: `[today, tomorrow)`, `[tomorrow, after)`.
fn local_days(now_ms: i64, time_zone: &TimeZone) -> Result<[i64; 3], Error> {
    let today = Timestamp::from_millisecond(now_ms)?.to_zoned(time_zone.clone()).date();
    let tomorrow = today.tomorrow()?;
    let start = |date: jiff::civil::Date| -> Result<i64, Error> {
        Ok(date.to_zoned(time_zone.clone())?.timestamp().as_millisecond())
    };
    Ok([start(today)?, start(tomorrow)?, start(tomorrow.tomorrow()?)?])
}

/// Sums of one series over the plant days around `now`.
#[allow(clippy::cast_precision_loss, reason = "slot overlaps of at most an hour are exact in f64")]
fn view(series: Vec<Point>, slots: &Slots, days: [i64; 3]) -> ForecastView {
    let [today, tomorrow, after] = days;
    let day_kwh = |from: i64, to: i64| {
        (0..series.len())
            .filter(|&i| (from..to).contains(&slots.start_ms[i]))
            .fold(0.0, |sum, i| sum + slots.kwh(&series, i))
    };
    let remaining =
        (0..series.len()).filter(|&i| (today..tomorrow).contains(&slots.start_ms[i])).fold(0.0, |sum, i| {
            let width = slots.width_ms[i];
            let left = (slots.start_ms[i] + width - slots.now_ms).min(width);
            if left <= 0 { sum } else { sum + slots.kwh(&series, i) * (left as f64 / width as f64) }
        });
    let next15 = next15(&series, slots);
    ForecastView {
        today_kwh: day_kwh(today, tomorrow),
        remaining_today_kwh: remaining,
        tomorrow_kwh: day_kwh(tomorrow, after),
        next15,
        series,
    }
}

/// Energy is the time-weighted sum of the slots the window overlaps, the peak their largest, the average
/// that energy over the whole window.
#[allow(clippy::cast_precision_loss, reason = "slot overlaps of at most an hour are exact in f64")]
fn next15(series: &[Point], slots: &Slots) -> Next15 {
    let end = slots.now_ms + QUARTER_HOUR_MS;
    let (mut energy_kwh, mut max_power_w) = (0.0, 0.0_f64);
    for (i, point) in series.iter().enumerate() {
        let start = slots.start_ms[i];
        let overlap = (start + slots.width_ms[i]).min(end) - start.max(slots.now_ms);
        if overlap > 0 {
            energy_kwh += ((point.watts * overlap as f64) / HOUR_MS as f64) / 1000.0;
            max_power_w = max_power_w.max(point.peak_watts);
        }
    }
    Next15 { max_power_w, avg_power_w: (energy_kwh / (15.0 / 60.0)) * 1000.0, energy_kwh }
}

/// The forecast for a plant over one irradiance series. Past slots join the clipping sim only when their
/// battery state is measured (`day_start_soc_pct`) or irrelevant (no battery); at the first slot not yet
/// over, the measured live SOC replaces the simulated one.
pub fn build(
    config: &ForecastConfig,
    data: &Irradiance,
    provider: &str,
    run: &Run,
) -> Result<Forecast, Error> {
    let slots = Slots::of(data, run.now_ms)?;
    let raw = integrate(data, &instant_power_w(config, data, &slots, run), &slots);
    let usable = clip::usable(config, &raw, &slots, &run.sim);
    let days = local_days(run.now_ms, run.time_zone)?;
    let narrowest = slots.width_ms.iter().copied().fold(HOUR_MS, i64::min);
    Ok(Forecast {
        provider: provider.to_owned(),
        step_minutes: (narrowest + 30_000) / 60_000,
        utc_offset_seconds: data.utc_offset_seconds,
        usable: view(usable.unwrap_or_else(|| raw.clone()), &slots, days),
        raw: view(raw, &slots, days),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(times: &[&str]) -> Irradiance {
        Irradiance {
            times: times.iter().map(|&t| t.to_owned()).collect(),
            utc_offset_seconds: 0,
            location: Location { latitude: 50.0, longitude: 8.0 },
            temperature: vec![],
            gti: vec![],
            dni: None,
            wind_speed: None,
        }
    }

    #[test]
    fn a_time_that_is_not_a_plant_local_minute_is_refused() {
        let config = ForecastConfig {
            arrays: vec![],
            temp_coefficient: -0.4,
            system_loss: 14.0,
            max_output_w: None,
            battery: None,
        };
        let run = Run { time_zone: &TimeZone::UTC, now_ms: 0, sim: SimInputs::default(), correction: None };
        let err = build(&config, &data(&["2026-07-24T10:00", "tomorrow"]), "p", &run).unwrap_err();
        assert_eq!(err.to_string(), "irradiance time \"tomorrow\" is not YYYY-MM-DDTHH:mm");
    }

    #[test]
    fn offsets_print_as_iso_designators() {
        for (seconds, want) in [(0, "Z"), (7200, "+02:00"), (-12_600, "-03:30"), (20_700, "+05:45")] {
            assert_eq!(iso_offset(seconds), want);
        }
    }

    #[test]
    fn a_correction_cell_outside_the_calendar_is_ignored_and_unlearned_cells_apply_one() {
        let mut model = CorrectionModel::default();
        let cell = CorrectionCell { ratio: 1.3, weight: 5.0 };
        for (month, hour) in [(0, 12), (13, 12), (i8::MIN, 12), (7, 24), (7, -1)] {
            model.set(month, hour, cell);
        }
        assert_eq!(model, CorrectionModel::default());
        assert!((model.factor(7, 12) - 1.0).abs() < f64::EPSILON);
        assert!((model.factor(0, 0) - 1.0).abs() < f64::EPSILON);
        assert!((model.factor(i8::MIN, 0) - 1.0).abs() < f64::EPSILON);
    }
}
