// The Strings group's rows (ADR 20): each inverter, under it its MPPT inputs, and under each input
// its strings, with the warnings that belong to each. Pure.
import type { Device, StringDraft } from "../api/core.ts";
import type { Inverters } from "./sizing.ts";

/** A warning of a string, by its position, or of an inverter's input. */
export interface Warned {
  readonly string?: number;
  readonly device?: number;
  readonly input?: number;
  readonly text: string;
}

export interface StringRow {
  /** Its position in the layout. */
  readonly index: number;
  readonly warnings: readonly string[];
}

export interface InputRows {
  /** From 1. */
  readonly input: number;
  readonly warnings: readonly string[];
  /** None: the input is free. */
  readonly strings: readonly StringRow[];
}

export interface InverterRows {
  readonly device: number;
  readonly name: string;
  readonly inputs: readonly InputRows[];
}

export interface Listed {
  readonly strings: readonly Readonly<StringDraft>[];
  /** Names the inverters. */
  readonly devices: readonly Readonly<Device>[];
  /** Each inverter's inputs, where its profile lists them. */
  readonly inputs: Inverters;
  readonly warnings: readonly Warned[];
}

/** The inputs of inverter `device` to list: those its profile has, else those its strings name. */
function inputsOf({ strings, inputs }: Listed, device: number): number[] {
  const listed = inputs[device]?.length ?? 0;
  const named = strings.flatMap((string) => (string.device === device ? [string.input] : []));

  return [...new Set([...Array.from({ length: listed }, (_, i) => i + 1), ...named])].toSorted(
    (a, b) => a - b,
  );
}

/** Each inverter that lists inputs or carries a string, by device id. */
export function stringTree(listed: Listed): InverterRows[] {
  const { strings, devices, inputs, warnings } = listed;

  const ids = [
    ...new Set([...Object.keys(inputs).map(Number), ...strings.map(({ device }) => device)]),
  ].toSorted((a, b) => a - b);

  return ids.map((device) => ({
    device,
    name: devices.find(({ id }) => id === device)?.name ?? String(device),
    inputs: inputsOf(listed, device).map((input) => ({
      input,
      warnings: warnings.flatMap((w) => (w.device === device && w.input === input ? [w.text] : [])),
      strings: strings.flatMap((string, index) =>
        string.device === device && string.input === input
          ? [{ index, warnings: warnings.flatMap((w) => (w.string === index ? [w.text] : [])) }]
          : [],
      ),
    })),
  }));
}
