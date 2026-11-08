//! The broker and export settings: one flat record in the store's `setting` table under `mqtt`. The password
//! is kept there and leaves only towards the broker.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::store::{Store, StoreError};
use crate::weather::present;

pub const KEY: &str = "mqtt";
/// Bytes per text field: well inside MQTT's 65535-byte strings.
const FIELD_MAX: usize = 1024;

/// A flat record, not a tagged union: an unreadable one reads as the default, which is off.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MqttConfig {
    pub enabled: bool,
    /// `mqtt://host[:port]` or `mqtts://host[:port]`.
    pub broker_url: String,
    pub username: Option<String>,
    password: Option<String>,
    /// Suffixed with each device's slug: one connection per device, each with its own will.
    pub client_id: Option<String>,
    pub topic_prefix: String,
    pub ha_discovery_enabled: bool,
    pub ha_discovery_prefix: String,
    /// The plant segment of every topic and `unique_id`.
    pub plant_slug: String,
}

impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            broker_url: String::new(),
            username: None,
            password: None,
            client_id: None,
            topic_prefix: "sunreye".into(),
            ha_discovery_enabled: false,
            ha_discovery_prefix: "homeassistant".into(),
            plant_slug: "plant".into(),
        }
    }
}

impl std::fmt::Debug for MqttConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MqttConfig")
            .field("enabled", &self.enabled)
            .field("broker_url", &self.broker_url)
            .field("username", &self.username)
            .field("plant_slug", &self.plant_slug)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Debug for MqttPatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MqttPatch")
            .field("enabled", &self.enabled)
            .field("broker_url", &self.broker_url)
            .field("username", &self.username)
            .field("plant_slug", &self.plant_slug)
            .finish_non_exhaustive()
    }
}

/// The settings as read: the password only as whether one is set.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MqttView {
    pub enabled: bool,
    pub broker_url: String,
    #[schema(required = true)]
    pub username: Option<String>,
    pub password_set: bool,
    #[schema(required = true)]
    pub client_id: Option<String>,
    pub topic_prefix: String,
    pub ha_discovery_enabled: bool,
    pub ha_discovery_prefix: String,
    pub plant_slug: String,
}

/// A `PUT /api/settings/mqtt` body: absent keeps the stored value, `null` clears a nullable one.
#[derive(Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::option_option, reason = "absent keeps the stored value, null clears it")]
pub struct MqttPatch {
    enabled: Option<bool>,
    broker_url: Option<String>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>, required = false)]
    username: Option<Option<String>>,
    /// Write-only.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>, required = false)]
    password: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>, required = false)]
    client_id: Option<Option<String>>,
    topic_prefix: Option<String>,
    ha_discovery_enabled: Option<bool>,
    ha_discovery_prefix: Option<String>,
    plant_slug: Option<String>,
}

/// Where the export dials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Broker {
    pub tls: bool,
    pub host: String,
    pub port: u16,
}

impl Broker {
    pub fn parse(url: &str) -> Option<Self> {
        let (scheme, rest) = url.split_once("://")?;
        let tls = match scheme.to_ascii_lowercase().as_str() {
            "mqtt" => false,
            "mqtts" => true,
            _ => return None,
        };
        let authority = rest.strip_suffix('/').unwrap_or(rest);
        if authority.contains(['/', '@']) {
            return None;
        }
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) if !host.ends_with(':') => (host, Some(port.parse::<u16>().ok()?)),
            _ => (authority, None),
        };
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let port = port.unwrap_or(if tls { 8883 } else { 1883 });
        (!host.is_empty() && port != 0).then(|| Self { tls, host: host.into(), port })
    }
}

/// Topic text with no wildcards and no NUL: a publish topic or a literal filter prefix.
pub(crate) fn publishable(text: &str) -> bool {
    !text.is_empty() && !text.contains(['+', '#', '\0'])
}

impl MqttConfig {
    /// The stored record; anything unreadable reads as off.
    pub fn read(stored: Option<&str>) -> Self {
        let Some(stored) = stored else { return Self::default() };
        serde_json::from_str(stored).unwrap_or_else(|_| {
            tracing::warn!(setting = KEY, "unreadable, the MQTT export stays off");
            Self::default()
        })
    }

    pub async fn load(store: &Store) -> Result<Self, StoreError> {
        Ok(Self::read(store.setting(KEY).await?.as_deref()))
    }

    pub fn stored(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn password(&self) -> Option<&str> {
        self.password.as_deref()
    }

    /// The broker to dial: none while off.
    pub fn broker(&self) -> Option<Broker> {
        if self.enabled { Broker::parse(&self.broker_url) } else { None }
    }

    pub fn view(&self) -> MqttView {
        MqttView {
            enabled: self.enabled,
            broker_url: self.broker_url.clone(),
            username: self.username.clone(),
            password_set: self.password.is_some(),
            client_id: self.client_id.clone(),
            topic_prefix: self.topic_prefix.clone(),
            ha_discovery_enabled: self.ha_discovery_enabled,
            ha_discovery_prefix: self.ha_discovery_prefix.clone(),
            plant_slug: self.plant_slug.clone(),
        }
    }

    pub fn patched(&self, patch: &MqttPatch) -> Result<Self, String> {
        let mut next = self.clone();
        let p = patch;
        next.enabled = p.enabled.unwrap_or(next.enabled);
        next.ha_discovery_enabled = p.ha_discovery_enabled.unwrap_or(next.ha_discovery_enabled);
        for (slot, value) in [
            (&mut next.broker_url, &p.broker_url),
            (&mut next.topic_prefix, &p.topic_prefix),
            (&mut next.ha_discovery_prefix, &p.ha_discovery_prefix),
            (&mut next.plant_slug, &p.plant_slug),
        ] {
            if let Some(value) = value {
                slot.clone_from(value);
            }
        }
        for (slot, value) in [
            (&mut next.username, &p.username),
            (&mut next.password, &p.password),
            (&mut next.client_id, &p.client_id),
        ] {
            if let Some(value) = value {
                slot.clone_from(value);
            }
        }
        next.validate()?;
        Ok(next)
    }

    fn validate(&self) -> Result<(), String> {
        let texts = [&self.broker_url, &self.topic_prefix, &self.ha_discovery_prefix, &self.plant_slug];
        let optional = [&self.username, &self.password, &self.client_id];
        let too_long =
            texts.into_iter().chain(optional.into_iter().flatten()).any(|text| text.len() > FIELD_MAX);
        let unparsed = !self.broker_url.is_empty() && Broker::parse(&self.broker_url).is_none();
        let checks = [
            (too_long, "Each field must be at most 1024 bytes"),
            (unparsed, "Broker URL must be mqtt://host[:port] or mqtts://host[:port]"),
            (self.enabled && self.broker_url.is_empty(), "Broker URL is required"),
            (!publishable(&self.topic_prefix), "Topic prefix must be non-empty, without + or #"),
            (!publishable(&self.ha_discovery_prefix), "Discovery prefix must be non-empty, without + or #"),
            (
                self.plant_slug.trim().is_empty()
                    || !publishable(&self.plant_slug)
                    || self.plant_slug.contains('/'),
                "Plant slug must be non-blank, without /, + or #",
            ),
            (self.client_id.as_deref().is_some_and(|id| id.trim().is_empty()), "Client id must not be blank"),
            (self.password.is_some() && self.username.is_none(), "A password needs a username"),
        ];
        match checks.into_iter().find(|(failed, _)| *failed) {
            Some((_, message)) => Err(message.to_owned()),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn saved(body: serde_json::Value) -> Result<MqttConfig, String> {
        MqttConfig::default().patched(&serde_json::from_value(body).expect("body"))
    }

    #[test]
    fn the_default_is_off_with_the_3x_prefixes() {
        let config = MqttConfig::default();
        let view = serde_json::to_value(config.view()).expect("view");
        assert_eq!(
            view,
            json!({
                "enabled": false, "brokerUrl": "", "username": null, "passwordSet": false, "clientId": null,
                "topicPrefix": "sunreye", "haDiscoveryEnabled": false, "haDiscoveryPrefix": "homeassistant",
                "plantSlug": "plant"
            })
        );
    }

    #[test]
    fn a_broker_url_names_mqtt_or_mqtts_a_host_and_an_optional_port() {
        let cases = [
            ("mqtt://broker.lan", Some((false, "broker.lan", 1883))),
            ("mqtts://broker.lan", Some((true, "broker.lan", 8883))),
            ("mqtt://10.0.0.2:1884/", Some((false, "10.0.0.2", 1884))),
            ("MQTTS://[::1]:8884", Some((true, "::1", 8884))),
            ("mqtt://h:1", Some((false, "h", 1))),
            ("mqtt://h:65535", Some((false, "h", 65_535))),
            ("mqtt://h:0", None),
            ("mqtt://h:65536", None),
            ("mqtt://", None),
            ("mqtt://h/topic", None),
            ("ws://h", None),
            ("h:1883", None),
            ("mqtt://user@h", None),
        ];
        for (url, want) in cases {
            let got = Broker::parse(url);
            let got = got.as_ref().map(|b| (b.tls, b.host.as_str(), b.port));
            assert_eq!(got, want, "{url}");
        }
    }

    #[test]
    fn a_saved_record_is_checked_before_it_is_kept() {
        let good = json!({"enabled": true, "brokerUrl": "mqtt://h", "plantSlug": "haus-sud"});
        assert!(saved(good).is_ok());
        let refused = [
            json!({"enabled": true}),
            json!({"brokerUrl": "http://h"}),
            json!({"topicPrefix": ""}),
            json!({"topicPrefix": "a/+"}),
            json!({"haDiscoveryPrefix": "ha/#"}),
            json!({"plantSlug": " "}),
            json!({"plantSlug": "a/b"}),
            json!({"clientId": " "}),
            json!({"password": "pw"}),
            json!({"topicPrefix": "x".repeat(1025)}),
        ];
        for body in refused {
            assert!(saved(body.clone()).is_err(), "{body}");
        }
        assert!(saved(json!({"topicPrefix": "x".repeat(1024)})).is_ok());
        assert!(saved(json!({"topicPrefix": "home/solar"})).is_ok());
    }

    #[test]
    fn an_absent_password_keeps_the_stored_one_and_null_clears_it() {
        let first = saved(json!({"username": "u", "password": "s3cret"})).expect("first");
        assert!(first.view().password_set);
        let kept =
            first.patched(&serde_json::from_value(json!({"username": "u"})).expect("body")).expect("kept");
        assert_eq!(kept.password(), Some("s3cret"));
        let cleared =
            kept.patched(&serde_json::from_value(json!({"password": null})).expect("body")).expect("cleared");
        assert_eq!(cleared.password(), None);
        assert!(!cleared.view().password_set);
    }

    #[test]
    fn the_password_never_shows_in_the_view_or_a_log() {
        let config = saved(json!({"username": "u", "password": "s3cret"})).expect("saved");
        assert!(!serde_json::to_string(&config.view()).expect("view").contains("s3cret"));
        assert!(!format!("{config:?}").contains("s3cret"));
        let patch: MqttPatch = serde_json::from_value(json!({"password": "s3cret"})).expect("patch");
        assert!(!format!("{patch:?}").contains("s3cret"), "{patch:?}");
        assert!(config.stored().contains("s3cret"), "the store keeps it");
        assert_eq!(MqttConfig::read(Some(&config.stored())), config);
    }

    #[test]
    fn an_unreadable_stored_record_reads_as_off() {
        assert_eq!(MqttConfig::read(Some("{not json")), MqttConfig::default());
        assert_eq!(MqttConfig::read(None), MqttConfig::default());
    }
}
