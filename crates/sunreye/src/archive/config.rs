//! `config.json`'s plant graph, as far as 4.0 keeps it: the plant zone and location, Modbus connections,
//! devices and each device's PV description. Automation settings are read by the guard, never stored.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::plant_zone::lookup;
use crate::settings::Transport;
use crate::weather::{Battery, DevicePv, PlantSettings, PvArray};

pub const MEMBER: &str = "config.json";
const ROLES: [&str; 4] = ["inverter", "meter", "charger", "controller"];

const AUTOMATIONS: &str = "automations";
const AUTOMATION_STATE: &str = "automationState";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub plant: Plant,
    #[serde(default)]
    app_settings: Vec<AppSetting>,
}

#[derive(Debug, Deserialize)]
struct AppSetting {
    key: String,
    value: serde_json::Value,
}

/// A user value 3.x automation holds a register away from: what the register read before automation took it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Held {
    /// 3.x's `<device>:<automation>` key naming the register's holder.
    pub key: String,
    pub value: Saved,
    pub captured_at: String,
}

/// A register value, or an EVCC loadpoint mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum Saved {
    Number(f64),
    Text(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    previous_value: Saved,
    captured_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plant {
    pub time_zone: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub label: Option<String>,
    pub max_output_w: Option<f64>,
    pub house_load_w: Option<f64>,
    pub smart_meter_since: Option<String>,
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub devices: Vec<Device>,
}

#[derive(Debug, Deserialize)]
pub struct Connection {
    pub name: String,
    pub kind: String,
    pub params: Params,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub transport: Option<Transport>,
    pub logger_serial: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub slug: String,
    pub name: Option<String>,
    pub profile_id: String,
    pub role: String,
    pub unit_id: u8,
    pub connection: Option<String>,
    pub retired_at: Option<String>,
    pub battery: Option<Battery>,
    pub arrays: Option<Vec<PvArray>>,
    pub temp_coefficient: Option<f64>,
    pub system_loss: Option<f64>,
}

impl Config {
    pub fn parse(text: &str) -> Result<Self, String> {
        let config: Self = serde_json::from_str(text).map_err(|e| e.to_string())?;
        config.check()?;
        Ok(config)
    }

    fn check(&self) -> Result<(), String> {
        let plant = &self.plant;
        if let Some(zone) = &plant.time_zone
            && lookup(zone).is_none()
        {
            return Err(format!("time zone {zone} is not an IANA name"));
        }
        for c in &plant.connections {
            if c.kind != "modbus" {
                return Err(format!("connection {} is {}: 4.0 reads Modbus over IP only", c.name, c.kind));
            }
            if c.params.host.is_none() || c.params.port.is_none() {
                return Err(format!("connection {} names no host and port", c.name));
            }
        }
        let mut slugs = std::collections::BTreeSet::new();
        for d in &plant.devices {
            if !slugs.insert(&d.slug) {
                return Err(format!("device {} is listed twice", d.slug));
            }
            if !ROLES.contains(&d.role.as_str()) {
                return Err(format!("device {} has role {}", d.slug, d.role));
            }
            if self.connection(d).is_none() {
                return Err(format!("device {} names no connection of the plant", d.slug));
            }
            if retired(d).is_err() {
                return Err(format!("device {} has an unreadable retiredAt", d.slug));
            }
        }
        Ok(())
    }

    /// The saved user values when 3.x automation is on or still holds a register; `None` when neither.
    pub fn guard(&self) -> Result<Option<Vec<Held>>, String> {
        let setting = |key| self.app_settings.iter().find(|s| s.key == key).map(|s| &s.value);
        let enabled = setting(AUTOMATIONS).is_some_and(|v| v["enabled"] == true);
        let state: BTreeMap<String, Snapshot> = match setting(AUTOMATION_STATE) {
            Some(value) => {
                serde_json::from_value(value.clone()).map_err(|e| format!("{AUTOMATION_STATE}: {e}"))?
            }
            None => BTreeMap::new(),
        };
        if !enabled && state.is_empty() {
            return Ok(None);
        }
        let held = state.into_iter().map(|(key, s)| Held {
            key,
            value: s.previous_value,
            captured_at: s.captured_at,
        });
        Ok(Some(held.collect()))
    }

    /// The position of the connection `device` is reached through.
    pub fn connection(&self, device: &Device) -> Option<usize> {
        let name = device.connection.as_deref()?;
        self.plant.connections.iter().position(|c| c.name == name)
    }

    pub fn plant_settings(&self) -> PlantSettings {
        let p = &self.plant;
        PlantSettings {
            latitude: p.latitude,
            longitude: p.longitude,
            label: p.label.clone().unwrap_or_default(),
            max_output_w: p.max_output_w,
            house_load_w: p.house_load_w,
            smart_meter_since: p.smart_meter_since.clone(),
            ..PlantSettings::default()
        }
    }
}

/// `retiredAt` as the store keeps it: UTC with milliseconds.
pub fn retired(device: &Device) -> Result<Option<String>, jiff::Error> {
    device.retired_at.as_deref().map(|at| Ok(format!("{:.3}", at.parse::<jiff::Timestamp>()?))).transpose()
}

pub fn pv(device: &Device) -> DevicePv {
    DevicePv {
        arrays: device.arrays.clone().unwrap_or_default(),
        temp_coefficient: device.temp_coefficient,
        system_loss: device.system_loss,
        battery: device.battery.clone(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn with(plant: &serde_json::Value) -> Result<Config, String> {
        Config::parse(&json!({ "plant": plant }).to_string())
    }

    fn device(role: &str, connection: &str) -> serde_json::Value {
        json!({"slug": "inv", "profileId": "p", "role": role, "unitId": 1, "connection": connection})
    }

    fn modbus(transport: &str) -> serde_json::Value {
        json!({"name": "Gateway", "kind": "modbus", "params": {"host": "h", "port": 502, "transport": transport}})
    }

    #[test]
    fn a_plant_with_a_modbus_device_reads() {
        let config = with(&json!({"timeZone": "Europe/Berlin", "connections": [modbus("rtu-over-tcp")],
                                 "devices": [device("meter", "Gateway")]}))
        .expect("config");
        let connection = config.connection(&config.plant.devices[0]).expect("connection");
        assert_eq!(config.plant.connections[connection].params.transport, Some(Transport::RtuOverTcp));
    }

    fn fixture(case: &str) -> Config {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/oracle/archives")
            .join(case)
            .join(MEMBER);
        Config::parse(&std::fs::read_to_string(path).expect("config.json")).expect("config")
    }

    #[test]
    fn automation_enabled_holds_the_saved_value_of_each_register() {
        let held = fixture("current-2.x").guard().expect("readable");
        let saved = Held {
            key: "1:peak-shaving".into(),
            value: Saved::Number(60.0),
            captured_at: "2026-05-01T10:00:00.000Z".into(),
        };
        assert_eq!(held, Some(vec![saved]));
        assert_eq!(fixture("legacy-1.2.0").guard(), Ok(None));
    }

    fn automation(enabled: bool, state: &serde_json::Value) -> Result<Option<Vec<Held>>, String> {
        let settings = json!([{"key": "automations", "value": {"enabled": enabled}},
                              {"key": "automationState", "value": state}]);
        Config::parse(&json!({"plant": {}, "appSettings": settings}).to_string()).expect("config").guard()
    }

    #[test]
    fn a_value_still_held_stops_the_import_with_automation_off() {
        let state = json!({"inv:evccMode:1": {"previousValue": "pv", "capturedAt": "2026-05-01T10:00:00Z"}});
        let held = automation(false, &state).expect("readable").expect("guarded");
        assert_eq!(held[0].value, Saved::Text("pv".into()));
        assert_eq!(automation(true, &json!({})), Ok(Some(vec![])));
        assert_eq!(automation(false, &json!({})), Ok(None));
    }

    #[test]
    fn an_unreadable_saved_value_is_refused() {
        let state = json!({"1:peak-shaving": {"previousValue": null, "capturedAt": "x"}});
        assert!(automation(false, &state).expect_err("refused").starts_with("automationState: "));
    }

    #[test]
    fn what_4_0_cannot_keep_is_refused_by_name() {
        let refused = |plant: serde_json::Value| with(&plant).expect_err("refused");
        assert_eq!(
            refused(json!({"timeZone": "Mars/Olympus"})),
            "time zone Mars/Olympus is not an IANA name"
        );
        assert_eq!(
            refused(json!({"connections": [{"name": "Port", "kind": "serial", "params": {}}]})),
            "connection Port is serial: 4.0 reads Modbus over IP only"
        );
        assert_eq!(
            refused(json!({"connections": [modbus("tcp")], "devices": [device("battery", "Gateway")]})),
            "device inv has role battery"
        );
        assert_eq!(
            refused(json!({"connections": [modbus("tcp")], "devices": [device("inverter", "Other")]})),
            "device inv names no connection of the plant"
        );
        assert!(refused(json!({"connections": [modbus("serial-rtu")]})).contains("serial-rtu"));
    }
}
