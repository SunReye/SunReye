// A module type's datasheet as the admin enters it (ADR 17): its rows, bounds and first values.
import type { Datasheet } from "@sunreye/scene";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import type { Editable } from "../components/value-editor/editable.ts";
import { amount } from "./fields.ts";

/** A datasheet's numbers, dimensions in millimetres as datasheets print them. */
export type Entered = Omit<Datasheet, "name">;

/** One group of the form: its title and a row per number. */
export interface DatasheetGroup {
  readonly title: string;
  readonly rows: readonly (readonly [keyof Entered, Editable])[];
}

/** The values every datasheet prints, left at 0 in a new form until entered. */
export const REQUIRED: ReadonlySet<keyof Entered> = new Set([
  "pmax",
  "vmp",
  "imp",
  "voc",
  "isc",
  "height",
  "width",
]);

/** Whether `key` is required and not yet entered. */
export function missing(entered: Entered, key: keyof Entered): boolean {
  return REQUIRED.has(key) && entered[key] <= 0;
}

/** The groups in datasheet order. A lower bound of 0 is the blank form's value, never sent. */
export function rows(): readonly DatasheetGroup[] {
  return [
    {
      title: m.datasheet_stc(),
      rows: [
        ["pmax", amount(m.field_pmax(), 0, 1000)],
        ["vmp", amount(m.field_vmp(), 0, 150, 0.01)],
        ["imp", amount(m.field_imp(), 0, 30, 0.01)],
        ["voc", amount(m.field_voc(), 0, 150, 0.01)],
        ["isc", amount(m.field_isc(), 0, 30, 0.01)],
      ],
    },
    {
      title: m.datasheet_coefficients(),
      rows: [
        ["powerCoefficient", amount(m.field_power_coefficient(), -1, 0, 0.01)],
        ["voltageCoefficient", amount(m.field_voltage_coefficient(), -1, 0, 0.01)],
        ["currentCoefficient", amount(m.field_current_coefficient(), -0.2, 0.2, 0.001)],
      ],
    },
    {
      title: m.datasheet_size(),
      rows: [
        ["height", amount(m.field_module_length(), 0, 3000)],
        ["width", amount(m.field_module_width(), 0, 3000)],
        ["bypassDiodes", amount(m.field_bypass_diodes(), 0, 6)],
      ],
    },
  ];
}

/** A new form: the values every datasheet prints are left at 0; coefficients and bypass diodes
 * start at a crystalline module's. */
export const BLANK: Entered = {
  pmax: 0,
  vmp: 0,
  imp: 0,
  voc: 0,
  isc: 0,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  height: 0,
  width: 0,
  bypassDiodes: 3,
};

/** What the core takes: dimensions in metres. */
export function datasheet(name: string, entered: Entered): Datasheet {
  return {
    name: name.trim(),
    ...entered,
    height: entered.height / 1000,
    width: entered.width / 1000,
  };
}

/** Pmax and size as a datasheet heads them, millimetres long side first. */
export function summary({ pmax, height, width }: Readonly<Datasheet>): string {
  const whole = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  return m.builder_module_type_summary({
    pmax: whole.format(pmax),
    length: whole.format(height * 1000),
    width: whole.format(width * 1000),
  });
}
