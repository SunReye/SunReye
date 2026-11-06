//! `config.json`'s plant graph, as far as 4.0 keeps it: the plant zone and location, Modbus connections,
//! devices and each device's PV description. Automation settings are read by the guard (#500), never stored.

use serde::Deserialize;

use crate::plant_zone::lookup;
use crate::settings::Transport;
use crate::weather::{Battery, DevicePv, PlantSettings, PvArray};

pub const MEMBER: &str = "config.json";
const ROLES: [&str; 4] = ["inverter", "meter", "charger", "controller"];

#[derive(Debug, Deserialize)]
pub struct Config {
    pub plant: Plant,
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
