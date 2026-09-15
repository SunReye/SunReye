/**
 * ONE table of framing names, for the three places that used to keep their own.
 *
 * The inverter panel, the connection dialog's Modbus fields and the roster's
 * group caption each carried a hardcoded English pair — so a third framing was
 * three edits, and a German operator read "Modbus RTU over TCP" on a page whose
 * every other word was translated. What the words are is a translation
 * question; which framings exist is not, and the two were tangled.
 */

import { describe, expect, test } from "bun:test";

import type { Transport } from "./inverter-types";
import { transportLabel, transportOptions } from "./transport-label";

describe("transportLabel", () => {
  test.each([
    ["tcp", "Modbus TCP"],
    ["rtu-over-tcp", "Modbus RTU over TCP"],
    ["solarman-v5", "Solarman V5 (logger stick, port 8899)"],
  ] satisfies [Transport, string][])("%p reads as %p in the base locale", (transport, label) => {
    expect(transportLabel(transport)).toBe(label);
  });

  // A connection row is a document the server wrote, and a build that has been
  // rolled back reads a framing it has no name for. Its own spelling is a
  // usable caption; an empty one loses the whole line it sits on.
  test("a framing this build does not know reads as its own raw value", () => {
    expect(transportLabel("rtu-over-udp")).toBe("rtu-over-udp");
    expect(transportLabel("")).toBe("");
  });
});

describe("transportOptions", () => {
  // Every framing this build can dial, and the order the select offers them in:
  // plain TCP leads, because it is what a generic gateway wants and the framing
  // a blank draft opens on.
  test("is one option per framing, labelled and in order", () => {
    expect(transportOptions()).toEqual([
      { value: "tcp", label: "Modbus TCP" },
      { value: "rtu-over-tcp", label: "Modbus RTU over TCP" },
      { value: "solarman-v5", label: "Solarman V5 (logger stick, port 8899)" },
    ]);
  });
});
