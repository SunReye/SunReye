//! The canonical role catalogue: the closed vocabulary of concepts a profile maps its metrics to, and what
//! each one asks of the metric. The single source: `profile.gen.ts` in the profile SDK is generated from it
//! through the `OpenAPI` document. **Never rename a role**; capabilities and the dashboard match the strings.

use std::borrow::Cow;

use serde::Serialize;
use utoipa::openapi::extensions::ExtensionsBuilder;
use utoipa::openapi::{ObjectBuilder, RefOr, Schema, Type};
use utoipa::{PartialSchema, ToSchema};

use crate::profile::MetricKind;

/// How a role folds across a plant's members.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Aggregate {
    Sum,
    WeightedMean,
    /// One machine's own state: the plant has no value for it.
    PerDevice,
}

/// The device class a role describes when it is not the inverter a register profile maps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RoleDevice {
    Charger,
    Optimizer,
}

/// What a role asks of the metric mapped to it.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[allow(clippy::struct_excessive_bools, reason = "one flag per demand, serialised as a flat object")]
#[serde(rename_all = "camelCase")]
pub struct RoleSpec {
    #[serde(skip)]
    #[schema(ignore)]
    pub name: &'static str,
    /// The kind a metric takes when it states none.
    pub kind: MetricKind,
    /// Conventional unit.
    #[serde(rename = "unitHint", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub unit: Option<&'static str>,
    pub aggregate: Aggregate,
    /// Needs a 1-based `index` on the metric.
    #[serde(skip_serializing_if = "is_false")]
    pub indexed: bool,
    /// Has a natural +/- direction and expects `flow`.
    #[serde(skip_serializing_if = "is_false")]
    pub signed: bool,
    /// A control: the mapped metric must be writable.
    #[serde(skip_serializing_if = "is_false")]
    pub writable: bool,
    /// The mapped metric must carry `enumLabels`.
    #[serde(rename = "needsEnumLabels", skip_serializing_if = "is_false")]
    pub enum_labels: bool,
    /// The device class the role describes when it is not the inverter a register profile maps.
    #[serde(rename = "deviceClass", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub device: Option<RoleDevice>,
}

#[expect(clippy::trivially_copy_pass_by_ref, reason = "serde's skip_serializing_if passes a reference")]
const fn is_false(flag: &bool) -> bool {
    !*flag
}

impl RoleSpec {
    const fn new(
        name: &'static str,
        kind: MetricKind,
        unit: Option<&'static str>,
        aggregate: Aggregate,
    ) -> Self {
        Self {
            name,
            kind,
            unit,
            aggregate,
            indexed: false,
            signed: false,
            writable: false,
            enum_labels: false,
            device: None,
        }
    }

    const fn indexed(mut self) -> Self {
        self.indexed = true;
        self
    }

    const fn signed(mut self) -> Self {
        self.signed = true;
        self
    }

    const fn writable(mut self) -> Self {
        self.writable = true;
        self
    }

    const fn enum_labels(mut self) -> Self {
        self.enum_labels = true;
        self
    }

    const fn on(mut self, device: RoleDevice) -> Self {
        self.device = Some(device);
        self
    }
}

pub const ROLES: &[RoleSpec] = &[
    RoleSpec::new("pv.string.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("pv.string.voltage", MetricKind::Measurement, Some("V"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("pv.string.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("pv.total.power", MetricKind::Measurement, Some("W"), Aggregate::Sum),
    RoleSpec::new("pv.string.energy.today", MetricKind::Cumulative, Some("kWh"), Aggregate::PerDevice)
        .indexed(),
    RoleSpec::new("pv.string.energy.total", MetricKind::Cumulative, Some("kWh"), Aggregate::PerDevice)
        .indexed(),
    RoleSpec::new("production.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("production.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("battery.soc", MetricKind::Measurement, Some("%"), Aggregate::WeightedMean),
    RoleSpec::new("battery.power", MetricKind::Measurement, Some("W"), Aggregate::Sum).signed(),
    RoleSpec::new("battery.voltage", MetricKind::Measurement, Some("V"), Aggregate::PerDevice),
    RoleSpec::new("battery.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice).signed(),
    RoleSpec::new("battery.temperature", MetricKind::Measurement, Some("°C"), Aggregate::WeightedMean),
    RoleSpec::new("battery.mode", MetricKind::Status, None, Aggregate::PerDevice).enum_labels(),
    RoleSpec::new("battery.energy.charged.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("battery.energy.charged.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("battery.energy.discharged.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("battery.energy.discharged.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("grid.power", MetricKind::Measurement, Some("W"), Aggregate::Sum).signed(),
    RoleSpec::new("grid.frequency", MetricKind::Measurement, Some("Hz"), Aggregate::PerDevice),
    RoleSpec::new("grid.phase.voltage", MetricKind::Measurement, Some("V"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("grid.phase.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice)
        .indexed()
        .signed(),
    RoleSpec::new("grid.phase.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .indexed()
        .signed(),
    RoleSpec::new("grid.energy.imported.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("grid.energy.imported.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("grid.energy.exported.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("grid.energy.exported.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("load.power", MetricKind::Measurement, Some("W"), Aggregate::Sum),
    RoleSpec::new("load.phase.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("load.phase.voltage", MetricKind::Measurement, Some("V"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("load.phase.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("load.energy.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("load.energy.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("backup.power", MetricKind::Measurement, Some("W"), Aggregate::Sum),
    RoleSpec::new("backup.phase.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("backup.phase.voltage", MetricKind::Measurement, Some("V"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("backup.phase.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice).indexed(),
    RoleSpec::new("backup.frequency", MetricKind::Measurement, Some("Hz"), Aggregate::PerDevice),
    RoleSpec::new("backup.energy.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("backup.energy.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("generator.power", MetricKind::Measurement, Some("W"), Aggregate::Sum),
    RoleSpec::new("generator.phase.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .indexed(),
    RoleSpec::new("generator.phase.voltage", MetricKind::Measurement, Some("V"), Aggregate::PerDevice)
        .indexed(),
    RoleSpec::new("generator.phase.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice)
        .indexed(),
    RoleSpec::new("generator.energy.today", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("generator.energy.total", MetricKind::Cumulative, Some("kWh"), Aggregate::Sum),
    RoleSpec::new("ev.charge.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .on(RoleDevice::Charger),
    RoleSpec::new("ev.vehicle.soc", MetricKind::Measurement, Some("%"), Aggregate::PerDevice)
        .on(RoleDevice::Charger),
    RoleSpec::new("ev.session.energy", MetricKind::Cumulative, Some("kWh"), Aggregate::PerDevice)
        .on(RoleDevice::Charger),
    RoleSpec::new("ev.connected", MetricKind::Status, None, Aggregate::PerDevice).on(RoleDevice::Charger),
    RoleSpec::new("ev.charging", MetricKind::Status, None, Aggregate::PerDevice).on(RoleDevice::Charger),
    RoleSpec::new("optimizer.target.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.applied.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.threshold.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.excess.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.local.sink.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.headroom.energy", MetricKind::Measurement, Some("kWh"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.surplus.energy", MetricKind::Measurement, Some("kWh"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.soc.envelope", MetricKind::Measurement, Some("%"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.soakable.energy", MetricKind::Measurement, Some("kWh"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.unavoidable.energy", MetricKind::Measurement, Some("kWh"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.ev.demand.energy", MetricKind::Measurement, Some("kWh"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.sell.limit.power", MetricKind::Measurement, Some("W"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.grid.charge.current", MetricKind::Measurement, Some("A"), Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.state", MetricKind::Status, None, Aggregate::PerDevice)
        .enum_labels()
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.price.regime", MetricKind::Status, None, Aggregate::PerDevice)
        .enum_labels()
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.override", MetricKind::Status, None, Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.ineffective", MetricKind::Status, None, Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.enabled", MetricKind::Setting, None, Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.mode", MetricKind::Setting, None, Aggregate::PerDevice)
        .enum_labels()
        .on(RoleDevice::Optimizer),
    RoleSpec::new("optimizer.restore.pending", MetricKind::Status, None, Aggregate::PerDevice)
        .on(RoleDevice::Optimizer),
    RoleSpec::new("inverter.status", MetricKind::Status, None, Aggregate::PerDevice).enum_labels(),
    RoleSpec::new("inverter.relay_status", MetricKind::Status, None, Aggregate::PerDevice).enum_labels(),
    RoleSpec::new("inverter.temperature.dc", MetricKind::Measurement, Some("°C"), Aggregate::WeightedMean),
    RoleSpec::new("inverter.temperature.ac", MetricKind::Measurement, Some("°C"), Aggregate::WeightedMean),
    RoleSpec::new("inverter.power", MetricKind::Measurement, Some("W"), Aggregate::Sum),
    RoleSpec::new("inverter.efficiency", MetricKind::Measurement, Some("%"), Aggregate::WeightedMean),
    RoleSpec::new("setting.battery.max_charge_current", MetricKind::Setting, Some("A"), Aggregate::PerDevice)
        .writable(),
    RoleSpec::new(
        "setting.battery.max_discharge_current",
        MetricKind::Setting,
        Some("A"),
        Aggregate::PerDevice,
    )
    .writable(),
    RoleSpec::new(
        "setting.battery.max_grid_charge_current",
        MetricKind::Setting,
        Some("A"),
        Aggregate::PerDevice,
    )
    .writable(),
    RoleSpec::new("setting.battery.max_charge_power", MetricKind::Setting, Some("W"), Aggregate::PerDevice)
        .writable(),
    RoleSpec::new(
        "setting.battery.max_discharge_power",
        MetricKind::Setting,
        Some("W"),
        Aggregate::PerDevice,
    )
    .writable(),
    RoleSpec::new(
        "setting.battery.max_grid_charge_power",
        MetricKind::Setting,
        Some("W"),
        Aggregate::PerDevice,
    )
    .writable(),
    RoleSpec::new("setting.battery.grid_charge", MetricKind::Setting, None, Aggregate::PerDevice)
        .writable()
        .enum_labels(),
    RoleSpec::new("setting.work_mode", MetricKind::Setting, None, Aggregate::PerDevice)
        .writable()
        .enum_labels(),
    RoleSpec::new("setting.solar_sell.max_power", MetricKind::Setting, Some("W"), Aggregate::PerDevice)
        .writable(),
    RoleSpec::new("setting.solar_sell.enabled", MetricKind::Setting, None, Aggregate::PerDevice)
        .writable()
        .enum_labels(),
];

/// The role names as a string enum; the specs ride along as `x-roles` for the SDK generator.
#[derive(Debug)]
pub struct Role;

impl ToSchema for Role {
    fn name() -> Cow<'static, str> {
        Cow::Borrowed("Role")
    }
}

impl PartialSchema for Role {
    #[expect(clippy::expect_used, reason = "a plain struct of strings and flags always serialises")]
    fn schema() -> RefOr<Schema> {
        let specs: serde_json::Map<String, serde_json::Value> =
            ROLES.iter().map(|r| (r.name.to_owned(), serde_json::to_value(r).expect("spec"))).collect();
        let extensions = ExtensionsBuilder::new().add("x-roles", serde_json::Value::Object(specs)).build();
        ObjectBuilder::new()
            .schema_type(Type::String)
            .description(Some("A canonical role a metric maps to."))
            .enum_values(Some(ROLES.iter().map(|r| r.name)))
            .extensions(Some(extensions))
            .into()
    }
}

pub fn find(role: &str) -> Option<&'static RoleSpec> {
    ROLES.iter().find(|r| r.name == role)
}

pub fn kind_of_role(role: &str) -> Option<MetricKind> {
    find(role).map(|r| r.kind)
}

/// A role no profile maps, or no role at all, is one machine's own state.
pub fn aggregate_of(role: Option<&str>) -> Aggregate {
    role.and_then(find).map_or(Aggregate::PerDevice, |r| r.aggregate)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::oracle::oracle;
    use crate::profile::MetricKind;

    #[test]
    fn the_role_kinds_are_the_2x_role_catalog() {
        let [catalog] = oracle("role-kinds.ndjson").try_into().expect("one line");
        let ours: Value = ROLES.iter().map(|r| (r.name.to_owned(), json!(r.kind))).collect();
        assert_eq!(ours, catalog);
    }

    #[test]
    fn the_role_aggregates_are_the_2x_role_catalog() {
        let [catalog] = oracle("role-aggregates.ndjson").try_into().expect("one line");
        let ours: Value = ROLES
            .iter()
            .map(|r| {
                let name = match r.aggregate {
                    Aggregate::Sum => "sum",
                    Aggregate::WeightedMean => "weighted-mean",
                    Aggregate::PerDevice => "per-device",
                };
                (r.name.to_owned(), json!(name))
            })
            .collect();
        assert_eq!(ours, catalog);
    }

    #[test]
    fn a_role_states_what_a_profile_author_must_map() {
        let string_power = find("pv.string.power").expect("role");
        assert!(string_power.indexed && !string_power.writable && !string_power.signed);
        assert_eq!(string_power.unit, Some("W"));
        let battery_power = find("battery.power").expect("role");
        assert!(battery_power.signed && !battery_power.indexed);
        let mode = find("setting.work_mode").expect("role");
        assert!(mode.writable && mode.enum_labels && mode.kind == MetricKind::Setting);
        assert_eq!(find("ev.charge.power").expect("role").device, Some(RoleDevice::Charger));
        assert_eq!(find("optimizer.state").expect("role").device, Some(RoleDevice::Optimizer));
        assert_eq!(find("grid.power").expect("role").device, None);
    }

    #[test]
    fn an_unknown_role_is_none() {
        assert!(find("pv.nothing").is_none());
        assert_eq!(kind_of_role("pv.nothing"), None);
        assert_eq!(aggregate_of(None), Aggregate::PerDevice);
        assert_eq!(aggregate_of(Some("pv.nothing")), Aggregate::PerDevice);
        assert_eq!(aggregate_of(Some("grid.power")), Aggregate::Sum);
    }

    #[test]
    fn the_role_schema_lists_every_role_with_the_spec_a_generator_needs() {
        let schema = serde_json::to_value(Role::schema()).expect("schema");
        let names: Vec<&str> = ROLES.iter().map(|r| r.name).collect();
        assert_eq!(schema["enum"], json!(names));
        let specs = &schema["x-roles"];
        assert_eq!(
            specs["pv.string.power"],
            json!({"kind": "measurement", "unitHint": "W", "aggregate": "per-device", "indexed": true})
        );
        assert_eq!(
            specs["setting.work_mode"],
            json!({"kind": "setting", "aggregate": "per-device", "writable": true, "needsEnumLabels": true})
        );
        assert_eq!(specs["ev.vehicle.soc"]["deviceClass"], "charger");
        assert_eq!(specs.as_object().expect("specs").len(), ROLES.len());
    }

    #[test]
    fn role_names_are_unique() {
        let mut names: Vec<_> = ROLES.iter().map(|r| r.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), ROLES.len());
    }
}
