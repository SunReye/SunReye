import { defineProfile } from "../packages/sdk/src/index.ts";
import type { Quantity } from "../packages/sdk/src/index.ts";

// The Shelly Pro 3EM, a three-phase meter, through its Gen2 RPC over HTTP:
// https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM. `EM.GetStatus` answers power
// in W, negative when returned to the grid, as ADR 4's `grid.power`; its EM component id is the
// device address. With a password set, it asks for Digest authentication with SHA-256 as user
// `admin` (https://shelly-api-docs.shelly.cloud/gen2/General/Authentication).
const GET = "/rpc/EM.GetStatus?id={address}";

const PHASES = [
  [1, "a"],
  [2, "b"],
  [3, "c"],
] as const;

function phase([index, name]: (typeof PHASES)[number]): Quantity[] {
  return [
    {
      key: `${name}.power`,
      role: "grid.phase.power",
      index,
      get: GET,
      json: `/${name}_act_power`,
      resolution: 0.1,
    },
    {
      key: `${name}.voltage`,
      role: "grid.phase.voltage",
      index,
      get: GET,
      json: `/${name}_voltage`,
      resolution: 0.1,
    },
    {
      key: `${name}.current`,
      role: "grid.phase.current",
      index,
      get: GET,
      json: `/${name}_current`,
      resolution: 0.001,
    },
  ];
}

export default defineProfile({
  schema: 1,
  id: "shelly-pro-3em",
  name: "Pro 3EM",
  manufacturer: "Shelly",
  version: "1.0.0",
  requires: ["http", "resolution"],
  quantities: [
    { key: "power", role: "grid.power", get: GET, json: "/total_act_power", resolution: 0.1 },
    { key: "frequency", role: "grid.frequency", get: GET, json: "/a_freq", resolution: 0.01 },
    ...PHASES.flatMap((p) => phase(p)),
  ],
});
