//! The plant's forecast settings on 3.x's `WeatherConfig` shape (`packages/db/src/weather.ts`): the
//! plant-level switches, location and limits stored once, the PV arrays, panel physics and battery stored
//! per inverter and composed in roster order.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::store::{DeviceRow, Store, StoreError};

pub const OPEN_METEO: &str = "open-meteo";
/// The plant fallbacks every array without its own value, or its inverter's, takes.
pub const DEFAULT_TEMP_COEFFICIENT: f64 = -0.4;
pub const DEFAULT_SYSTEM_LOSS: f64 = 14.0;
const DEFAULT_MIN_SOC: f64 = 10.0;
const MAX_ARRAYS: usize = 8;
const LABEL_MAX: usize = 120;
/// Edited on the inverter's device: a weather patch naming one is refused, never dropped.
const MOVED_TO_DEVICE: [&str; 4] = ["arrays", "tempCoefficient", "systemLoss", "battery"];

/// One PV array: panels sharing an orientation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PvArray {
    pub kwp: f64,
    /// Degrees from horizontal.
    pub tilt: f64,
    /// Degrees: 0 south, -90 east, 90 west.
    pub azimuth: f64,
    /// The inverter the array is wired into; set on the composed record only.
    #[serde(default, skip_serializing_if = "Option::is_none", skip_deserializing)]
    pub device_slug: Option<String>,
    /// %/°C; the inverter's, else the plant's, when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temp_coefficient: Option<f64>,
    /// %; the inverter's, else the plant's, when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_loss: Option<f64>,
    /// `index` of the inverter's `pv.string.*` metrics this array is wired into.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mppt: Option<u32>,
}

/// The battery the forecast's clipping sim models.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub usable_kwh: f64,
    /// W; unbounded when null.
    #[serde(default)]
    pub max_charge_w: Option<f64>,
    /// Reserve floor, %.
    #[serde(default = "default_min_soc")]
    pub min_soc: f64,
}

const fn default_min_soc() -> f64 {
    DEFAULT_MIN_SOC
}

/// One inverter's PV description and pack.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DevicePv {
    pub arrays: Vec<PvArray>,
    pub temp_coefficient: Option<f64>,
    pub system_loss: Option<f64>,
    pub battery: Option<Battery>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Correction {
    /// Apply the learned correction; it learns either way.
    pub enabled: bool,
}

/// The plant-level half, stored once.
#[derive(Debug, Clone, PartialEq)]
pub struct PlantSettings {
    pub enabled: bool,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub label: String,
    pub forecast_enabled: bool,
    pub provider: String,
    pub max_output_w: Option<f64>,
    pub house_load_w: Option<f64>,
    pub smart_meter_since: Option<String>,
    pub correction: Correction,
}

impl Default for PlantSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            latitude: None,
            longitude: None,
            label: String::new(),
            forecast_enabled: false,
            provider: OPEN_METEO.into(),
            max_output_w: None,
            house_load_w: None,
            smart_meter_since: None,
            correction: Correction::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SolarForecastConfig {
    pub enabled: bool,
    pub provider: String,
    /// Every in-service inverter's, in roster order.
    pub arrays: Vec<PvArray>,
    /// Plant fallback, %/°C.
    pub temp_coefficient: f64,
    /// Plant fallback, %.
    pub system_loss: f64,
    /// Feed-in cap, W.
    #[schema(required = true)]
    pub max_output_w: Option<f64>,
    /// The in-service inverters' packs as one.
    #[schema(required = true)]
    pub battery: Option<Battery>,
    /// W; inferred from history when null.
    #[schema(required = true)]
    pub house_load_w: Option<f64>,
    /// `YYYY-MM-DD` the smart meter gateway was installed.
    #[schema(required = true)]
    pub smart_meter_since: Option<String>,
    pub correction: Correction,
}

/// The composed record.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WeatherConfig {
    pub enabled: bool,
    #[schema(required = true)]
    pub latitude: Option<f64>,
    #[schema(required = true)]
    pub longitude: Option<f64>,
    pub label: String,
    pub forecast: SolarForecastConfig,
}

impl WeatherConfig {
    /// Enabled, located, the forecast on and at least one array.
    pub fn forecast_ready(&self) -> Option<crate::forecast::Location> {
        let (Some(latitude), Some(longitude)) = (self.latitude, self.longitude) else { return None };
        (self.enabled && self.forecast.enabled && !self.forecast.arrays.is_empty())
            .then_some(crate::forecast::Location { latitude, longitude })
    }

    /// The model's input; every array carries its resolved coefficient and loss.
    pub fn model(&self) -> crate::forecast::ForecastConfig {
        let f = &self.forecast;
        crate::forecast::ForecastConfig {
            arrays: f
                .arrays
                .iter()
                .map(|a| crate::forecast::PvArray {
                    kwp: a.kwp,
                    tilt: a.tilt,
                    azimuth: a.azimuth,
                    temp_coefficient: a.temp_coefficient,
                    system_loss: a.system_loss,
                })
                .collect(),
            temp_coefficient: f.temp_coefficient,
            system_loss: f.system_loss,
            max_output_w: f.max_output_w,
            battery: f.battery.as_ref().map(|b| crate::forecast::Battery {
                usable_kwh: b.usable_kwh,
                max_charge_w: b.max_charge_w,
                min_soc: b.min_soc,
            }),
        }
    }
}

/// A `PUT /api/settings/weather` body: absent keeps the stored value, `null` clears a nullable one.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::option_option, reason = "absent keeps the stored value, null clears it")]
pub struct WeatherPatch {
    #[serde(default, deserialize_with = "stated")]
    enabled: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<f64>, required = false)]
    latitude: Option<Option<f64>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<f64>, required = false)]
    longitude: Option<Option<f64>>,
    #[serde(default, deserialize_with = "stated")]
    label: Option<String>,
    #[serde(default, deserialize_with = "stated")]
    forecast: Option<ForecastPatch>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::option_option, reason = "absent keeps the stored value, null clears it")]
pub struct ForecastPatch {
    #[serde(default, deserialize_with = "stated")]
    enabled: Option<bool>,
    #[serde(default, deserialize_with = "stated")]
    provider: Option<String>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<f64>, required = false)]
    max_output_w: Option<Option<f64>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<f64>, required = false)]
    house_load_w: Option<Option<f64>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>, required = false)]
    smart_meter_since: Option<Option<String>>,
    #[serde(default, deserialize_with = "stated")]
    correction: Option<Correction>,
}

/// A stated key as `Some`; `null` is refused, as for a field that is not nullable.
fn stated<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

/// A stated key, `null` included, as `Some`.
#[allow(clippy::option_option, reason = "absent keeps the stored value, null clears it")]
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

fn within(value: f64, min: f64, max: f64) -> bool {
    (min..=max).contains(&value)
}

fn above(value: f64, min: f64, max: f64) -> bool {
    value > min && value <= max
}

impl PlantSettings {
    /// `body` applied over `self`, checked as 3.x's `setWeatherConfig` checks it.
    pub fn patched(&self, body: &Value) -> Result<Self, String> {
        let named = body.get("forecast").and_then(Value::as_object);
        if let Some(moved) = MOVED_TO_DEVICE.iter().find(|key| named.is_some_and(|f| f.contains_key(**key))) {
            return Err(format!("forecast.{moved} is edited on the inverter in Settings → Devices"));
        }
        let patch: WeatherPatch = serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
        let mut next = self.clone();
        #[allow(clippy::option_option, reason = "absent keeps the stored value, null clears it")]
        let set = |slot: &mut Option<f64>, value: Option<Option<f64>>| {
            if let Some(value) = value {
                *slot = value;
            }
        };
        next.enabled = patch.enabled.unwrap_or(next.enabled);
        set(&mut next.latitude, patch.latitude);
        set(&mut next.longitude, patch.longitude);
        next.label = patch.label.unwrap_or(next.label);
        if let Some(f) = patch.forecast {
            next.forecast_enabled = f.enabled.unwrap_or(next.forecast_enabled);
            next.provider = f.provider.unwrap_or(next.provider);
            set(&mut next.max_output_w, f.max_output_w);
            set(&mut next.house_load_w, f.house_load_w);
            next.smart_meter_since = f.smart_meter_since.unwrap_or(next.smart_meter_since);
            next.correction = f.correction.unwrap_or(next.correction);
        }
        next.validate()?;
        Ok(next)
    }

    fn validate(&self) -> Result<(), String> {
        let checks = [
            (self.latitude.is_some_and(|v| !within(v, -90.0, 90.0)), "latitude must be -90–90"),
            (self.longitude.is_some_and(|v| !within(v, -180.0, 180.0)), "longitude must be -180–180"),
            (self.label.encode_utf16().count() > LABEL_MAX, "label must be at most 120 characters"),
            (
                self.max_output_w.is_some_and(|v| !above(v, 0.0, 10_000_000.0)),
                "forecast.maxOutputW must be above 0 and at most 10000000",
            ),
            (
                self.house_load_w.is_some_and(|v| !within(v, 0.0, 10_000_000.0)),
                "forecast.houseLoadW must be 0–10000000",
            ),
        ];
        match checks.into_iter().find(|(failed, _)| *failed) {
            Some((_, message)) => Err(message.to_owned()),
            None => Ok(()),
        }
    }
}

impl DevicePv {
    /// Bounds as 3.x's device dialog checks them; `strings` are the inverter's `pv.string.*` indexes.
    pub fn validate(&self, strings: &[u32]) -> Result<(), (&'static str, String)> {
        let physics = |t: Option<f64>, l: Option<f64>| {
            if t.is_some_and(|t| !within(t, -2.0, 0.0)) {
                return Err("tempCoefficient must be -2–0".to_owned());
            }
            if l.is_some_and(|l| !within(l, 0.0, 90.0)) {
                return Err("systemLoss must be 0–90".to_owned());
            }
            Ok(())
        };
        physics(self.temp_coefficient, self.system_loss).map_err(|m| ("arrays", m))?;
        if self.arrays.len() > MAX_ARRAYS {
            return Err(("arrays", format!("at most {MAX_ARRAYS} arrays")));
        }
        for array in &self.arrays {
            let geometry = [
                (!above(array.kwp, 0.0, 100_000.0), "kwp must be above 0 and at most 100000"),
                (!within(array.tilt, 0.0, 90.0), "tilt must be 0–90"),
                (!within(array.azimuth, -180.0, 180.0), "azimuth must be -180–180"),
            ];
            if let Some((_, message)) = geometry.into_iter().find(|(failed, _)| *failed) {
                return Err(("arrays", message.to_owned()));
            }
            physics(array.temp_coefficient, array.system_loss).map_err(|m| ("arrays", m))?;
        }
        wiring(&self.arrays, strings).map_err(|m| ("arrays", m))?;
        if let Some(b) = &self.battery {
            let checks = [
                (!above(b.usable_kwh, 0.0, 10_000.0), "usableKwh must be above 0 and at most 10000"),
                (
                    b.max_charge_w.is_some_and(|w| !above(w, 0.0, 10_000_000.0)),
                    "maxChargeW must be above 0 and at most 10000000",
                ),
                (!within(b.min_soc, 0.0, 100.0), "minSoc must be 0–100"),
            ];
            if let Some((_, message)) = checks.into_iter().find(|(failed, _)| *failed) {
                return Err(("battery", message.to_owned()));
            }
        }
        Ok(())
    }
}

/// Each array on a string the inverter reports, no two on one.
fn wiring(arrays: &[PvArray], strings: &[u32]) -> Result<(), String> {
    let mut wired = Vec::new();
    for mppt in arrays.iter().filter_map(|a| a.mppt) {
        if !strings.contains(&mppt) {
            return Err(format!("mppt {mppt} is not a PV string this inverter reports"));
        }
        if wired.contains(&mppt) {
            return Err(format!("two arrays on PV string {mppt}"));
        }
        wired.push(mppt);
    }
    Ok(())
}

/// The packs as one: capacities add, the floor is capacity-weighted, any unbounded charger unbounds it.
fn plant_battery(packs: &[&Battery]) -> Option<Battery> {
    if packs.is_empty() {
        return None;
    }
    let usable_kwh: f64 = packs.iter().map(|p| p.usable_kwh).sum();
    let reserved_kwh: f64 = packs.iter().map(|p| p.usable_kwh * p.min_soc / 100.0).sum();
    let max_charge_w = packs.iter().map(|p| p.max_charge_w).sum::<Option<f64>>();
    Some(Battery { usable_kwh, max_charge_w, min_soc: reserved_kwh / usable_kwh * 100.0 })
}

/// The record composed from the plant row and every in-service inverter's PV description.
pub fn compose(plant: PlantSettings, devices: &[DeviceRow], pv: &BTreeMap<i64, DevicePv>) -> WeatherConfig {
    let inverters: Vec<(&DeviceRow, &DevicePv)> = devices
        .iter()
        .filter(|d| d.in_service() && d.role == "inverter")
        .filter_map(|d| pv.get(&d.id).map(|pv| (d, pv)))
        .collect();
    let arrays = inverters
        .iter()
        .flat_map(|(device, pv)| {
            pv.arrays.iter().map(|array| PvArray {
                device_slug: Some(device.id.to_string()),
                temp_coefficient: array.temp_coefficient.or(pv.temp_coefficient),
                system_loss: array.system_loss.or(pv.system_loss),
                ..array.clone()
            })
        })
        .collect();
    let packs: Vec<&Battery> = inverters.iter().filter_map(|(_, pv)| pv.battery.as_ref()).collect();
    WeatherConfig {
        enabled: plant.enabled,
        latitude: plant.latitude,
        longitude: plant.longitude,
        label: plant.label,
        forecast: SolarForecastConfig {
            enabled: plant.forecast_enabled,
            provider: plant.provider,
            arrays,
            temp_coefficient: DEFAULT_TEMP_COEFFICIENT,
            system_loss: DEFAULT_SYSTEM_LOSS,
            max_output_w: plant.max_output_w,
            battery: plant_battery(&packs),
            house_load_w: plant.house_load_w,
            smart_meter_since: plant.smart_meter_since,
            correction: plant.correction,
        },
    }
}

/// The record as stored now.
pub async fn read(store: &Store) -> Result<WeatherConfig, StoreError> {
    let plant = store.plant_settings().await?.unwrap_or_default();
    Ok(compose(plant, &store.devices().await?, &store.device_pv().await?))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::modbus::Transport;

    fn device(id: i64, role: &str, retired: bool) -> DeviceRow {
        DeviceRow {
            id,
            connection_id: 1,
            profile_id: "p".into(),
            unit_id: 1,
            name: None,
            role: role.into(),
            retired_at: retired.then(|| "2026-01-01T00:00:00.000Z".into()),
            transport: Transport::Tcp,
            host: "h".into(),
            port: 502,
            logger_serial: None,
        }
    }

    fn array(kwp: f64) -> PvArray {
        PvArray {
            kwp,
            tilt: 30.0,
            azimuth: 0.0,
            device_slug: None,
            temp_coefficient: None,
            system_loss: None,
            mppt: None,
        }
    }

    fn refusal(body: &Value) -> String {
        PlantSettings::default().patched(body).expect_err("refused")
    }

    #[test]
    fn a_patch_changes_only_what_it_names_and_null_clears() {
        let located = PlantSettings::default()
            .patched(&json!({"enabled": true, "latitude": 50.5, "longitude": 8.25, "label": "Home",
                "forecast": {"enabled": true, "maxOutputW": 6000, "smartMeterSince": "2026-03-01"}}))
            .expect("patched");
        let next = located
            .patched(&json!({"latitude": null, "forecast": {"correction": {"enabled": true}}}))
            .expect("patched");
        assert_eq!(
            next,
            PlantSettings {
                enabled: true,
                latitude: None,
                longitude: Some(8.25),
                label: "Home".into(),
                forecast_enabled: true,
                max_output_w: Some(6000.0),
                smart_meter_since: Some("2026-03-01".into()),
                correction: Correction { enabled: true },
                ..PlantSettings::default()
            }
        );
    }

    #[test]
    fn values_at_their_bounds_are_accepted() {
        let body = json!({"latitude": -90, "longitude": 180, "label": "é".repeat(120),
            "forecast": {"maxOutputW": 10_000_000, "houseLoadW": 0}});
        assert!(PlantSettings::default().patched(&body).is_ok());
        assert!(PlantSettings::default().patched(&json!({"forecast": {"houseLoadW": 10_000_000}})).is_ok());
    }

    #[test]
    fn values_out_of_bounds_are_refused_by_name() {
        assert_eq!(refusal(&json!({"latitude": 90.01})), "latitude must be -90–90");
        assert_eq!(refusal(&json!({"longitude": -181})), "longitude must be -180–180");
        assert_eq!(refusal(&json!({"label": "x".repeat(121)})), "label must be at most 120 characters");
        let cap = "forecast.maxOutputW must be above 0 and at most 10000000";
        assert_eq!(refusal(&json!({"forecast": {"maxOutputW": 0}})), cap);
        assert_eq!(refusal(&json!({"forecast": {"maxOutputW": 10_000_001}})), cap);
        assert_eq!(
            refusal(&json!({"forecast": {"houseLoadW": -1}})),
            "forecast.houseLoadW must be 0–10000000"
        );
    }

    #[test]
    fn a_wrong_type_is_refused() {
        assert!(refusal(&json!({"enabled": "yes"})).contains("invalid type"));
        assert!(refusal(&json!({"label": null})).contains("invalid type"));
    }

    #[test]
    fn device_owned_fields_are_refused_even_as_null() {
        for key in MOVED_TO_DEVICE {
            let body = json!({"forecast": {key: null}});
            assert_eq!(
                refusal(&body),
                format!("forecast.{key} is edited on the inverter in Settings → Devices")
            );
        }
    }

    #[test]
    fn arrays_compose_from_in_service_inverters_with_their_coefficients() {
        let devices = [
            device(1, "inverter", false),
            device(2, "inverter", true),
            device(3, "meter", false),
            device(4, "inverter", false),
        ];
        let own = PvArray { temp_coefficient: Some(-0.3), mppt: Some(2), ..array(5.0) };
        let pv = BTreeMap::from([
            (1, DevicePv { arrays: vec![own, array(3.0)], system_loss: Some(10.0), ..DevicePv::default() }),
            (2, DevicePv { arrays: vec![array(9.0)], ..DevicePv::default() }),
            (3, DevicePv { arrays: vec![array(8.0)], ..DevicePv::default() }),
            (4, DevicePv { arrays: vec![array(1.0)], temp_coefficient: Some(-0.5), ..DevicePv::default() }),
        ]);
        let config = compose(PlantSettings::default(), &devices, &pv);
        let seen: Vec<_> = config
            .forecast
            .arrays
            .iter()
            .map(|a| (a.kwp, a.device_slug.as_deref(), a.temp_coefficient, a.system_loss, a.mppt))
            .collect();
        assert_eq!(
            seen,
            [
                (5.0, Some("1"), Some(-0.3), Some(10.0), Some(2)),
                (3.0, Some("1"), None, Some(10.0), None),
                (1.0, Some("4"), Some(-0.5), None, None)
            ]
        );
        assert_eq!((config.forecast.temp_coefficient, config.forecast.system_loss), (-0.4, 14.0));
    }

    #[test]
    fn packs_combine_capacity_weighted_and_one_unbounded_charger_unbounds_them() {
        let pack = |usable_kwh, max_charge_w, min_soc| Battery { usable_kwh, max_charge_w, min_soc };
        let (a, b) = (pack(10.0, Some(3000.0), 20.0), pack(5.0, Some(2000.0), 50.0));
        assert_eq!(plant_battery(&[&a, &b]), Some(pack(15.0, Some(5000.0), 30.0)));
        assert_eq!(plant_battery(&[&a, &pack(5.0, None, 50.0)]), Some(pack(15.0, None, 30.0)));
        assert_eq!(plant_battery(&[]), None);
    }

    #[test]
    fn the_forecast_is_ready_only_enabled_located_and_with_an_array() {
        let devices = [device(1, "inverter", false)];
        let pv = BTreeMap::from([(1, DevicePv { arrays: vec![array(5.0)], ..DevicePv::default() })]);
        let ready = PlantSettings {
            enabled: true,
            latitude: Some(50.0),
            longitude: Some(8.0),
            forecast_enabled: true,
            ..PlantSettings::default()
        };
        assert!(compose(ready.clone(), &devices, &pv).forecast_ready().is_some());
        for unready in [
            PlantSettings { enabled: false, ..ready.clone() },
            PlantSettings { forecast_enabled: false, ..ready.clone() },
            PlantSettings { latitude: None, ..ready.clone() },
            PlantSettings { longitude: None, ..ready.clone() },
        ] {
            assert!(compose(unready, &devices, &pv).forecast_ready().is_none());
        }
        assert!(compose(ready, &devices, &BTreeMap::new()).forecast_ready().is_none());
    }

    fn pv_refusal(pv: &DevicePv) -> (&'static str, String) {
        pv.validate(&[1, 2]).expect_err("refused")
    }

    #[test]
    fn an_array_on_a_string_the_inverter_lacks_or_shares_is_refused() {
        let on = |mppt| PvArray { mppt: Some(mppt), ..array(1.0) };
        assert_eq!(
            DevicePv { arrays: vec![on(1), on(2), array(1.0)], ..DevicePv::default() }.validate(&[1, 2]),
            Ok(())
        );
        assert_eq!(
            pv_refusal(&DevicePv { arrays: vec![on(3)], ..DevicePv::default() }),
            ("arrays", "mppt 3 is not a PV string this inverter reports".into())
        );
        assert_eq!(
            pv_refusal(&DevicePv { arrays: vec![on(1), on(1)], ..DevicePv::default() }),
            ("arrays", "two arrays on PV string 1".into())
        );
    }

    #[test]
    fn array_and_pack_bounds_are_refused_by_name() {
        let arrays = |a: PvArray| pv_refusal(&DevicePv { arrays: vec![a], ..DevicePv::default() }).1;
        assert_eq!(arrays(array(0.0)), "kwp must be above 0 and at most 100000");
        assert_eq!(arrays(array(100_000.5)), "kwp must be above 0 and at most 100000");
        assert_eq!(arrays(PvArray { tilt: 90.5, ..array(1.0) }), "tilt must be 0–90");
        assert_eq!(arrays(PvArray { azimuth: -180.5, ..array(1.0) }), "azimuth must be -180–180");
        assert_eq!(
            arrays(PvArray { temp_coefficient: Some(0.1), ..array(1.0) }),
            "tempCoefficient must be -2–0"
        );
        assert_eq!(arrays(PvArray { system_loss: Some(91.0), ..array(1.0) }), "systemLoss must be 0–90");
    }

    #[test]
    fn array_geometry_at_its_bounds_is_accepted() {
        for (kwp, tilt, azimuth) in [(100_000.0, 0.0, -180.0), (0.001, 90.0, 180.0)] {
            let pv = DevicePv { arrays: vec![PvArray { tilt, azimuth, ..array(kwp) }], ..DevicePv::default() };
            assert_eq!(pv.validate(&[]), Ok(()), "kwp {kwp} tilt {tilt} azimuth {azimuth}");
        }
    }

    #[test]
    fn array_geometry_past_each_bound_or_nan_is_refused() {
        let arrays = |a: PvArray| pv_refusal(&DevicePv { arrays: vec![a], ..DevicePv::default() }).1;
        let (kwp, tilt, azimuth) = (
            "kwp must be above 0 and at most 100000",
            "tilt must be 0–90",
            "azimuth must be -180–180",
        );
        for value in [0.0, -1.0, f64::NAN] {
            assert_eq!(arrays(array(value)), kwp, "kwp {value}");
        }
        for value in [-0.5, 90.5, f64::NAN] {
            assert_eq!(arrays(PvArray { tilt: value, ..array(1.0) }), tilt, "tilt {value}");
        }
        for value in [-180.5, 180.5, f64::NAN] {
            assert_eq!(arrays(PvArray { azimuth: value, ..array(1.0) }), azimuth, "azimuth {value}");
        }
    }

    #[test]
    fn too_many_arrays_inverter_physics_and_pack_bounds_are_refused_by_name() {
        let nine = DevicePv { arrays: vec![array(1.0); 9], ..DevicePv::default() };
        assert_eq!(pv_refusal(&nine).1, "at most 8 arrays");
        assert_eq!(
            pv_refusal(&DevicePv { temp_coefficient: Some(-2.1), ..DevicePv::default() }).1,
            "tempCoefficient must be -2–0"
        );
        let pack = |b: Battery| pv_refusal(&DevicePv { battery: Some(b), ..DevicePv::default() });
        let ok = Battery { usable_kwh: 10_000.0, max_charge_w: Some(10_000_000.0), min_soc: 100.0 };
        assert_eq!(DevicePv { battery: Some(ok.clone()), ..DevicePv::default() }.validate(&[]), Ok(()));
        assert_eq!(pack(Battery { usable_kwh: 0.0, ..ok.clone() }).0, "battery");
        assert_eq!(
            pack(Battery { max_charge_w: Some(0.0), ..ok.clone() }).1,
            "maxChargeW must be above 0 and at most 10000000"
        );
        assert_eq!(pack(Battery { min_soc: -1.0, ..ok }).1, "minSoc must be 0–100");
    }
}
