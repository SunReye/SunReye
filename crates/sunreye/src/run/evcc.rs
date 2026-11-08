//! The EVCC ingest: one subscription the core owns, restarted when its settings or its broker change, stopped
//! while it is off. It publishes on the bus `evcc` topic; `GET /api/evcc` and `/ws` only read that.

use std::sync::{Arc, Weak};

use rustls::pki_types::CertificateDer;
use tokio::sync::watch;

use super::Core;
use super::tasks::Running;
use crate::evcc::Ingest;
use crate::events::{Bus, Changed, Events};
use crate::mqtt::config::{Broker, MqttConfig};
use crate::mqtt::link::{Dial, Link, jitter, network, sleep};
use crate::mqtt::subscriber::{self, Heard};
use crate::settings::EvccConfig;

/// The core keeps one broker, the `mqtt` setting's; an EVCC record names it as this connection.
pub const MQTT_CONNECTION: i64 = 1;

/// What a running ingest was started from.
#[derive(Debug, PartialEq)]
struct Plan {
    config: EvccConfig,
    dial: Dial,
}

/// The ingest `evcc` asks for, on the broker its connection resolves to; none while it is not ready.
fn plan(evcc: &EvccConfig, mqtt: &MqttConfig, roots: &[CertificateDer<'static>]) -> Option<Plan> {
    let url = (evcc.connection_id == Some(MQTT_CONNECTION)).then_some(mqtt.broker_url.as_str());
    if !evcc.ready(url) {
        return None;
    }
    let client = mqtt.client_id.clone().unwrap_or_else(|| format!("sunreye-{}", mqtt.plant_slug));
    let dial = Dial {
        broker: Broker::parse(url?)?,
        client_id: format!("{client}-evcc"),
        username: mqtt.username.clone(),
        password: mqtt.password().map(str::to_owned),
        roots: roots.to_vec(),
    };
    Some(Plan { config: evcc.clone(), dial })
}

async fn read_plan(core: &Core) -> Result<Option<Plan>, crate::store::StoreError> {
    let (evcc, mqtt) = (EvccConfig::load(&core.store).await?, MqttConfig::load(&core.store).await?);
    Ok(plan(&evcc, &mqtt, &core.roots))
}

/// Follows the store's changes until stopped. Holds the core weakly, so it never keeps it from stopping.
pub(super) fn spawn(core: &Arc<Core>) -> Running {
    let (changes, bus, core) = (core.bus.changed.subscribe(), Arc::clone(&core.bus), Arc::downgrade(core));
    Running::one(move |stopped| follow(core, bus, changes, stopped))
}

async fn follow(
    core: Weak<Core>,
    bus: Arc<Bus>,
    mut changes: Events<Changed>,
    mut stopped: watch::Receiver<bool>,
) {
    let mut ingesting = Ingesting { bus, current: None };
    while let Some(strong) = core.upgrade() {
        match read_plan(&strong).await {
            Ok(next) => ingesting.follow(next).await,
            Err(error) => log_not_restarted(&error),
        }
        drop(strong);
        if next_change(&mut stopped, &mut changes).await.is_none() {
            break;
        }
    }
    ingesting.stop().await;
}

fn log_not_restarted(error: &crate::store::StoreError) {
    tracing::warn!(%error, "EVCC ingest not restarted");
}

/// `None` once stopped or the bus is gone.
async fn next_change(stopped: &mut watch::Receiver<bool>, changes: &mut Events<Changed>) -> Option<Changed> {
    tokio::select! {
        biased;
        _ = stopped.changed() => None,
        change = changes.newest() => change,
    }
}

/// The running ingest and what it was started from.
struct Ingesting {
    bus: Arc<Bus>,
    current: Option<(Plan, Running)>,
}

impl Ingesting {
    /// Restarts unless `next` is what runs; stays stopped while `next` is none.
    async fn follow(&mut self, next: Option<Plan>) {
        if next.as_ref() == self.current.as_ref().map(|(plan, _)| plan) {
            return;
        }
        self.stop().await;
        self.current = next.map(|plan| {
            let link = Link { dial: plan.dial.clone(), open: network(), pause: sleep(), jitter };
            let fold = Ingest::new(&plan.config.topic_root, plan.config.subtract_from_home);
            let bus = Arc::clone(&self.bus);
            (plan, Running::one(move |stopped| ingest(link, fold, bus, stopped)))
        });
    }

    async fn stop(&mut self) {
        if let Some((_, running)) = self.current.take() {
            running.stop().await;
            self.bus.evcc.clear();
        }
    }
}

/// Publishes the ingest's state at once and again each time what it hears changes it.
async fn ingest(link: Link, mut ingest: Ingest, bus: Arc<Bus>, stopped: watch::Receiver<bool>) {
    let mut last = ingest.state();
    bus.evcc.publish(last.clone());
    let filters = ingest.subscriptions();
    let hear = move |heard| {
        match heard {
            Heard::Connected => ingest.connected(),
            Heard::Message(message) => ingest.message(&message.topic, &message.payload),
            Heard::Lost => ingest.dropped(),
        }
        let state = ingest.state();
        if state != last {
            bus.evcc.publish(state.clone());
            last = state;
        }
    };
    subscriber::run(link, filters, hear, stopped).await;
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::mqtt::fixture::{FakeBroker, Seen};
    use crate::oracle::oracle;

    fn mqtt(body: Value) -> MqttConfig {
        MqttConfig::default().patched(&serde_json::from_value(body).expect("body")).expect("valid")
    }

    fn evcc(body: Value) -> EvccConfig {
        serde_json::from_value(body).expect("evcc")
    }

    #[test]
    fn connection_1_is_the_mqtt_settings_broker_with_its_credentials_whether_or_not_the_export_is_on() {
        let broker = mqtt(json!({
            "brokerUrl": "mqtts://hass.lan:8884", "username": "u", "password": "pw", "plantSlug": "haus"
        }));
        let on = evcc(json!({"enabled": true, "connectionId": 1, "topicRoot": "home/evcc"}));
        let plan = plan(&on, &broker, &[]).expect("ready");
        assert_eq!(
            (plan.dial.broker.tls, plan.dial.broker.host.as_str(), plan.dial.broker.port),
            (true, "hass.lan", 8884)
        );
        assert_eq!(plan.dial.client_id, "sunreye-haus-evcc");
        assert_eq!((plan.dial.username.as_deref(), plan.dial.password.as_deref()), (Some("u"), Some("pw")));
        assert_eq!(plan.config, on);

        let named = mqtt(json!({"brokerUrl": "mqtt://b", "clientId": "x"}));
        assert_eq!(plan_of(&on, &named).map(|p| p.dial.client_id), Some("x-evcc".to_owned()));
        let unready = [
            (evcc(json!({"enabled": false, "connectionId": 1})), broker.clone()),
            (evcc(json!({"enabled": true, "connectionId": null})), broker.clone()),
            (evcc(json!({"enabled": true, "connectionId": 2})), broker.clone()),
            (evcc(json!({"enabled": true, "connectionId": 0})), broker.clone()),
            (on.clone(), MqttConfig::default()),
        ];
        for (config, broker) in unready {
            assert!(plan_of(&config, &broker).is_none(), "{config:?} on {broker:?}");
        }
    }

    /// Reachable, loadpoint 1 at the oracle's 4140 W.
    fn charging(state: Option<&crate::evcc::EvccState>) -> bool {
        let first = state.filter(|s| s.reachable).and_then(|s| s.loadpoints.first());
        first.is_some_and(|loadpoint| (loadpoint.charge_power - 4140.0).abs() < 0.5)
    }

    fn plan_of(evcc: &EvccConfig, mqtt: &MqttConfig) -> Option<Plan> {
        plan(evcc, mqtt, &[])
    }

    #[tokio::test]
    async fn a_full_ingest_across_a_dropped_connection_publishes_nothing_and_subscribes_to_no_command_topic()
    {
        let case = oracle("evcc.ndjson")
            .into_iter()
            .find(|c| c["case"] == "commands/no-command-topic")
            .expect("case");
        let steps = case["input"]["steps"].as_array().expect("steps");
        let retained: Vec<(&str, &str)> = steps
            .iter()
            .filter(|step| step["do"] == "message")
            .map(|step| (step["topic"].as_str().expect("topic"), step["payload"].as_str().expect("payload")))
            .collect();
        let mut broker = FakeBroker::new(&retained);
        let bus = Arc::new(Bus::default());
        let dial = plan_of(
            &evcc(json!({"enabled": true, "connectionId": 1})),
            &mqtt(json!({"brokerUrl": "mqtt://b"})),
        )
        .expect("ready")
        .dial;
        let link =
            Link { dial, open: broker.open(), pause: Arc::new(|_| Box::pin(std::future::ready(()))), jitter };
        let mut states = bus.evcc.subscribe();
        let running =
            Running::one(|stopped| ingest(link, Ingest::new("evcc", false), Arc::clone(&bus), stopped));

        states.wait_for(|state| charging(state.as_ref())).await.expect("folded");
        broker.until(8).await;
        broker.kick();
        assert_eq!(broker.until(8).await.connection, 1, "subscribed again on the next connection");
        states.wait_for(|state| charging(state.as_ref())).await.expect("reconnected");
        running.stop().await;
        broker.until(14).await;

        assert!(broker.log.iter().all(|seen| seen.kind != 3), "a publish went out: {:?}", broker.log);
        let subscribed: Vec<Vec<String>> =
            broker.log.iter().filter(|s| s.kind == 8).map(Seen::filters).collect();
        let want: Vec<String> =
            serde_json::from_value(case["output"]["subscribed"].clone()).expect("subscribed");
        assert_eq!(subscribed, [want.clone(), want]);
        assert!(subscribed.iter().flatten().all(|filter| !filter.ends_with("/set")));
        assert_eq!(case["output"]["published"], json!([]));
    }
}
