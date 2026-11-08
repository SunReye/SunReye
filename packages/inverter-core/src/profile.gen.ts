export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @enum {string} */
        Access: "r" | "rw";
        /**
         * @description How a role folds across a plant's members.
         * @enum {string}
         */
        Aggregate: "sum" | "weighted-mean" | "per-device";
        /** @description Where a metric's value comes from. `Control` metrics are settings the core never writes in 4.0. */
        Binding: {
            addr: number[];
            type: components["schemas"]["RegisterType"];
            /** @enum {string} */
            via: "modbus";
        } | {
            expr: components["schemas"]["Expr"];
            /** @enum {string} */
            via: "compute";
        } | {
            /** @enum {string} */
            via: "control";
        };
        /** @description What the profile states about hardware no metric implies. */
        Declares: {
            backupOutput?: boolean;
        };
        /** @description A derived value; keys name other metrics, and a key without a value reads as 0. */
        Expr: {
            sum: string[];
        } | {
            diff: string[];
        } | {
            scale: components["schemas"]["KeyAndFactor"];
        } | {
            combine: {
                add: string[];
                sub?: string[];
            };
        } | {
            ratio: {
                den: string[];
                num: string[];
                /** Format: double */
                scale?: number;
            };
        } | {
            clamp: {
                key: string;
                /** Format: double */
                max?: number;
                /** Format: double */
                min?: number;
            };
        };
        /** @description What the sign of a signed metric means. */
        Flow: {
            negative: string;
            positive: string;
        };
        KeyAndFactor: [
            string,
            number
        ];
        Metric: {
            access?: components["schemas"]["Access"];
            binding: components["schemas"]["Binding"];
            enumLabels?: {
                [key: string]: string;
            };
            flow?: components["schemas"]["Flow"];
            group?: string;
            /** Format: int32 */
            index?: number;
            key: string;
            kind?: components["schemas"]["MetricKind"];
            label?: string;
            /** Format: double */
            offset?: number;
            range?: components["schemas"]["Range"];
            role?: string;
            /** Format: double */
            scale: number;
            storage?: components["schemas"]["Storage"];
            topic?: string;
            /** @description Published profiles write `null` for a unitless metric. */
            unit: string | null;
        };
        /**
         * @description How a widget treats the metric.
         * @enum {string}
         */
        MetricKind: "measurement" | "cumulative" | "status" | "setting";
        /** @description A device profile as the core reads it. Serialized, it is what the published profile says of these fields. */
        Profile: {
            declares?: components["schemas"]["Declares"];
            id: string;
            manufacturer: string;
            metrics: components["schemas"]["Metric"][];
            name: string;
            /**
             * Format: int32
             * @description Absent reads as the current schema.
             */
            schemaVersion?: number;
            /** @description Semver of the profile content. */
            version: string;
        };
        Range: {
            /** Format: double */
            max: number;
            /** Format: double */
            min: number;
        };
        /** @enum {string} */
        RegisterType: "U_WORD" | "S_WORD" | "U_DWORD" | "RAW";
        /**
         * @description A canonical role a metric maps to.
         * @enum {string}
         */
        Role: "pv.string.power" | "pv.string.voltage" | "pv.string.current" | "pv.total.power" | "pv.string.energy.today" | "pv.string.energy.total" | "production.today" | "production.total" | "battery.soc" | "battery.power" | "battery.voltage" | "battery.current" | "battery.temperature" | "battery.mode" | "battery.energy.charged.today" | "battery.energy.charged.total" | "battery.energy.discharged.today" | "battery.energy.discharged.total" | "grid.power" | "grid.frequency" | "grid.phase.voltage" | "grid.phase.current" | "grid.phase.power" | "grid.energy.imported.today" | "grid.energy.imported.total" | "grid.energy.exported.today" | "grid.energy.exported.total" | "load.power" | "load.phase.power" | "load.phase.voltage" | "load.phase.current" | "load.energy.today" | "load.energy.total" | "backup.power" | "backup.phase.power" | "backup.phase.voltage" | "backup.phase.current" | "backup.frequency" | "backup.energy.today" | "backup.energy.total" | "generator.power" | "generator.phase.power" | "generator.phase.voltage" | "generator.phase.current" | "generator.energy.today" | "generator.energy.total" | "ev.charge.power" | "ev.vehicle.soc" | "ev.session.energy" | "ev.connected" | "ev.charging" | "optimizer.target.current" | "optimizer.applied.current" | "optimizer.threshold.power" | "optimizer.excess.power" | "optimizer.local.sink.power" | "optimizer.headroom.energy" | "optimizer.surplus.energy" | "optimizer.soc.envelope" | "optimizer.soakable.energy" | "optimizer.unavoidable.energy" | "optimizer.ev.demand.energy" | "optimizer.sell.limit.power" | "optimizer.grid.charge.current" | "optimizer.state" | "optimizer.price.regime" | "optimizer.override" | "optimizer.ineffective" | "optimizer.enabled" | "optimizer.mode" | "optimizer.restore.pending" | "inverter.status" | "inverter.relay_status" | "inverter.temperature.dc" | "inverter.temperature.ac" | "inverter.power" | "inverter.efficiency" | "setting.battery.max_charge_current" | "setting.battery.max_discharge_current" | "setting.battery.max_grid_charge_current" | "setting.battery.max_charge_power" | "setting.battery.max_discharge_power" | "setting.battery.max_grid_charge_power" | "setting.battery.grid_charge" | "setting.work_mode" | "setting.solar_sell.max_power" | "setting.solar_sell.enabled";
        /**
         * @description The device class a role describes when it is not the inverter a register profile maps.
         * @enum {string}
         */
        RoleDevice: "charger" | "optimizer";
        /** @description What a role asks of the metric mapped to it. */
        RoleSpec: {
            aggregate: components["schemas"]["Aggregate"];
            /** @description The device class the role describes when it is not the inverter a register profile maps. */
            deviceClass?: components["schemas"]["RoleDevice"];
            /** @description Needs a 1-based `index` on the metric. */
            indexed?: boolean;
            /** @description The kind a metric takes when it states none. */
            kind: components["schemas"]["MetricKind"];
            /** @description The mapped metric must carry `enumLabels`. */
            needsEnumLabels?: boolean;
            /** @description Has a natural +/- direction and expects `flow`. */
            signed?: boolean;
            /** @description Conventional unit. */
            unitHint?: string;
            /** @description A control: the mapped metric must be writable. */
            writable?: boolean;
        };
        /**
         * @description Where a metric's values are kept.
         * @enum {string}
         */
        Storage: "series" | "config" | "none";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

export type CoreProfile = components["schemas"]["Profile"];
export type CoreMetric = components["schemas"]["Metric"];
export type CoreBinding = components["schemas"]["Binding"];
export type RoleSpec = components["schemas"]["RoleSpec"];
export type CanonicalRole = components["schemas"]["Role"];
/** The canonical roles and what each asks of its metric; the core's `ROLES`. */
export const ROLE_CATALOG = {
  "pv.string.power": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"W"},
  "pv.string.voltage": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"V"},
  "pv.string.current": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"A"},
  "pv.total.power": {"aggregate":"sum","kind":"measurement","unitHint":"W"},
  "pv.string.energy.today": {"aggregate":"per-device","indexed":true,"kind":"cumulative","unitHint":"kWh"},
  "pv.string.energy.total": {"aggregate":"per-device","indexed":true,"kind":"cumulative","unitHint":"kWh"},
  "production.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "production.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "battery.soc": {"aggregate":"weighted-mean","kind":"measurement","unitHint":"%"},
  "battery.power": {"aggregate":"sum","kind":"measurement","signed":true,"unitHint":"W"},
  "battery.voltage": {"aggregate":"per-device","kind":"measurement","unitHint":"V"},
  "battery.current": {"aggregate":"per-device","kind":"measurement","signed":true,"unitHint":"A"},
  "battery.temperature": {"aggregate":"weighted-mean","kind":"measurement","unitHint":"°C"},
  "battery.mode": {"aggregate":"per-device","kind":"status","needsEnumLabels":true},
  "battery.energy.charged.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "battery.energy.charged.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "battery.energy.discharged.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "battery.energy.discharged.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "grid.power": {"aggregate":"sum","kind":"measurement","signed":true,"unitHint":"W"},
  "grid.frequency": {"aggregate":"per-device","kind":"measurement","unitHint":"Hz"},
  "grid.phase.voltage": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"V"},
  "grid.phase.current": {"aggregate":"per-device","indexed":true,"kind":"measurement","signed":true,"unitHint":"A"},
  "grid.phase.power": {"aggregate":"per-device","indexed":true,"kind":"measurement","signed":true,"unitHint":"W"},
  "grid.energy.imported.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "grid.energy.imported.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "grid.energy.exported.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "grid.energy.exported.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "load.power": {"aggregate":"sum","kind":"measurement","unitHint":"W"},
  "load.phase.power": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"W"},
  "load.phase.voltage": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"V"},
  "load.phase.current": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"A"},
  "load.energy.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "load.energy.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "backup.power": {"aggregate":"sum","kind":"measurement","unitHint":"W"},
  "backup.phase.power": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"W"},
  "backup.phase.voltage": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"V"},
  "backup.phase.current": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"A"},
  "backup.frequency": {"aggregate":"per-device","kind":"measurement","unitHint":"Hz"},
  "backup.energy.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "backup.energy.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "generator.power": {"aggregate":"sum","kind":"measurement","unitHint":"W"},
  "generator.phase.power": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"W"},
  "generator.phase.voltage": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"V"},
  "generator.phase.current": {"aggregate":"per-device","indexed":true,"kind":"measurement","unitHint":"A"},
  "generator.energy.today": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "generator.energy.total": {"aggregate":"sum","kind":"cumulative","unitHint":"kWh"},
  "ev.charge.power": {"aggregate":"per-device","deviceClass":"charger","kind":"measurement","unitHint":"W"},
  "ev.vehicle.soc": {"aggregate":"per-device","deviceClass":"charger","kind":"measurement","unitHint":"%"},
  "ev.session.energy": {"aggregate":"per-device","deviceClass":"charger","kind":"cumulative","unitHint":"kWh"},
  "ev.connected": {"aggregate":"per-device","deviceClass":"charger","kind":"status"},
  "ev.charging": {"aggregate":"per-device","deviceClass":"charger","kind":"status"},
  "optimizer.target.current": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"A"},
  "optimizer.applied.current": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"A"},
  "optimizer.threshold.power": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"W"},
  "optimizer.excess.power": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"W"},
  "optimizer.local.sink.power": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"W"},
  "optimizer.headroom.energy": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"kWh"},
  "optimizer.surplus.energy": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"kWh"},
  "optimizer.soc.envelope": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"%"},
  "optimizer.soakable.energy": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"kWh"},
  "optimizer.unavoidable.energy": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"kWh"},
  "optimizer.ev.demand.energy": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"kWh"},
  "optimizer.sell.limit.power": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"W"},
  "optimizer.grid.charge.current": {"aggregate":"per-device","deviceClass":"optimizer","kind":"measurement","unitHint":"A"},
  "optimizer.state": {"aggregate":"per-device","deviceClass":"optimizer","kind":"status","needsEnumLabels":true},
  "optimizer.price.regime": {"aggregate":"per-device","deviceClass":"optimizer","kind":"status","needsEnumLabels":true},
  "optimizer.override": {"aggregate":"per-device","deviceClass":"optimizer","kind":"status"},
  "optimizer.ineffective": {"aggregate":"per-device","deviceClass":"optimizer","kind":"status"},
  "optimizer.enabled": {"aggregate":"per-device","deviceClass":"optimizer","kind":"setting"},
  "optimizer.mode": {"aggregate":"per-device","deviceClass":"optimizer","kind":"setting","needsEnumLabels":true},
  "optimizer.restore.pending": {"aggregate":"per-device","deviceClass":"optimizer","kind":"status"},
  "inverter.status": {"aggregate":"per-device","kind":"status","needsEnumLabels":true},
  "inverter.relay_status": {"aggregate":"per-device","kind":"status","needsEnumLabels":true},
  "inverter.temperature.dc": {"aggregate":"weighted-mean","kind":"measurement","unitHint":"°C"},
  "inverter.temperature.ac": {"aggregate":"weighted-mean","kind":"measurement","unitHint":"°C"},
  "inverter.power": {"aggregate":"sum","kind":"measurement","unitHint":"W"},
  "inverter.efficiency": {"aggregate":"weighted-mean","kind":"measurement","unitHint":"%"},
  "setting.battery.max_charge_current": {"aggregate":"per-device","kind":"setting","unitHint":"A","writable":true},
  "setting.battery.max_discharge_current": {"aggregate":"per-device","kind":"setting","unitHint":"A","writable":true},
  "setting.battery.max_grid_charge_current": {"aggregate":"per-device","kind":"setting","unitHint":"A","writable":true},
  "setting.battery.max_charge_power": {"aggregate":"per-device","kind":"setting","unitHint":"W","writable":true},
  "setting.battery.max_discharge_power": {"aggregate":"per-device","kind":"setting","unitHint":"W","writable":true},
  "setting.battery.max_grid_charge_power": {"aggregate":"per-device","kind":"setting","unitHint":"W","writable":true},
  "setting.battery.grid_charge": {"aggregate":"per-device","kind":"setting","needsEnumLabels":true,"writable":true},
  "setting.work_mode": {"aggregate":"per-device","kind":"setting","needsEnumLabels":true,"writable":true},
  "setting.solar_sell.max_power": {"aggregate":"per-device","kind":"setting","unitHint":"W","writable":true},
  "setting.solar_sell.enabled": {"aggregate":"per-device","kind":"setting","needsEnumLabels":true,"writable":true},
} as const satisfies Record<CanonicalRole, RoleSpec>;

export const ROLE_NAMES = Object.keys(ROLE_CATALOG) as [CanonicalRole, ...CanonicalRole[]];
