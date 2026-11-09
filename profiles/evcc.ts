import { defineProfile } from "../packages/sdk/src/index.ts";

// EVCC's MQTT API, https://docs.evcc.io/en/integrations/mqtt-api: loadpoint ids begin at 1 and
// session energy is in Wh.
export default defineProfile({
  schema: 1,
  id: "evcc",
  name: "Loadpoint",
  manufacturer: "EVCC",
  version: "1.0.0",
  requires: ["mqtt"],
  quantities: [
    { key: "chargePower", role: "ev.charge.power", topic: "loadpoints/{address}/chargePower" },
    { key: "vehicleSoc", role: "ev.vehicle.soc", topic: "loadpoints/{address}/vehicleSoc" },
    {
      key: "sessionEnergy",
      role: "ev.session.energy",
      topic: "loadpoints/{address}/sessionEnergy",
      scale: 0.001,
    },
    { key: "connected", role: "ev.connected", topic: "loadpoints/{address}/connected" },
    { key: "charging", role: "ev.charging", topic: "loadpoints/{address}/charging" },
  ],
});
