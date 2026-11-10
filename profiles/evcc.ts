import { defineProfile } from "../packages/sdk/src/index.ts";

// EVCC's MQTT API, https://docs.evcc.io/en/integrations/mqtt-api: loadpoint ids begin at 1 and
// session energy is in Wh. A key is written through `<key>/set`, and EVCC republishes its retained
// state within about 2 s. Battery boost is refused unless the mode is `pv` or `minpv`, and a mode
// change clears it (https://docs.evcc.io/en/features/battery).
const MODES = { off: 0, now: 1, minpv: 2, pv: 3 };

// A vehicle's configured title, published as plain text, reads as its entry in the SPA's car
// catalogue (apps/web/src/lib/cars/catalogue.ts), which a test keeps in step.
const MODELS = {
  "Tesla Model 3 Highland": 1,
  "Tesla Model Y": 2,
  "Volkswagen ID.3": 3,
  "Volkswagen ID. Buzz": 4,
  "Ford F-150 Lightning": 5,
};

export default defineProfile({
  schema: 1,
  id: "evcc",
  name: "Loadpoint",
  manufacturer: "EVCC",
  version: "1.0.0",
  requires: ["mqtt", "u16", "publish", "precondition", "text-enum"],
  quantities: [
    { key: "chargePower", role: "ev.charge.power", topic: "loadpoints/{address}/chargePower" },
    { key: "vehicleSoc", role: "ev.vehicle.soc", topic: "loadpoints/{address}/vehicleSoc" },
    {
      key: "sessionEnergy",
      role: "ev.session.energy",
      topic: "loadpoints/{address}/sessionEnergy",
      scale: 0.001,
    },
    {
      key: "vehicleTitle",
      role: "ev.vehicle.model",
      topic: "loadpoints/{address}/vehicleTitle",
      enum: MODELS,
    },
    { key: "connected", role: "ev.connected", topic: "loadpoints/{address}/connected" },
    { key: "charging", role: "ev.charging", topic: "loadpoints/{address}/charging" },
    { key: "mode", role: "ev.mode", topic: "loadpoints/{address}/mode", enum: MODES },
    { key: "limitSoc", role: "ev.limit.soc", topic: "loadpoints/{address}/limitSoc" },
    {
      key: "batteryBoost",
      role: "ev.battery.boost",
      topic: "loadpoints/{address}/batteryBoost",
      enum: { false: 0, true: 1 },
    },
  ],
  // Mode first and boost last: boost holds only in a mode it allows.
  settings: [
    {
      key: "mode",
      type: "u16",
      values: Object.values(MODES),
      minInterval: 0,
      recipe: [{ publish: { topic: "loadpoints/{address}/mode/set" } }],
      readBack: { quantity: "mode" },
    },
    {
      key: "limitSoc",
      type: "u16",
      range: { min: 0, max: 100 },
      minInterval: 0,
      recipe: [{ publish: { topic: "loadpoints/{address}/limitSoc/set" } }],
      readBack: { quantity: "limitSoc" },
    },
    {
      key: "batteryBoost",
      type: "u16",
      values: [0, 1],
      minInterval: 0,
      recipe: [
        { precondition: { quantity: "mode", values: [MODES.minpv, MODES.pv] } },
        { publish: { topic: "loadpoints/{address}/batteryBoost/set" } },
      ],
      readBack: { quantity: "batteryBoost" },
    },
  ],
});
