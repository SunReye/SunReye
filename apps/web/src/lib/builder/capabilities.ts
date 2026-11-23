// What the builder's checks read of the core's capabilities (ADR 9): each inverter's limits, by
// device id. The builder takes them as numbers; reading them from the core is the app's.
import type { Capabilities } from "../api/core.ts";
import type { InputLimits, Inverters } from "@sunreye/pv-wasm";
import type { Limits } from "@sunreye/builder";

/** The limits the core's capabilities list. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the API's generated type, read only.
export function limitsOf({ devices }: Pick<Capabilities, "devices">): Limits {
  return Object.fromEntries(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only, as above.
    Object.entries(devices).flatMap(([id, support]) => {
      const { maxInputVoltage } = support;

      return maxInputVoltage === undefined || maxInputVoltage === null
        ? []
        : [[Number(id), maxInputVoltage] as const];
    }),
  );
}

/** The inputs the core's capabilities list, where an inverter's profile gives them (ADR 9). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the API's generated type, read only.
export function inputsOf({ devices }: Pick<Capabilities, "devices">): Inverters {
  return Object.fromEntries(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only, as above.
    Object.entries(devices).flatMap(([id, { inputs }]): [number, readonly InputLimits[]][] =>
      inputs === undefined || inputs.length === 0 ? [] : [[Number(id), inputs]],
    ),
  );
}
