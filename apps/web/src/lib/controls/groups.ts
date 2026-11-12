import type { Setting } from "../api/core.ts";
import type { EditableSetting } from "../components/value-editor/editable.ts";
import { valueText } from "../settings/bounds.ts";

/** Controls' groups (ADR 21), in order: a role namespace each, and Advanced for the rest. */
const GROUPS = ["battery", "grid", "advanced"] as const;

export type GroupId = (typeof GROUPS)[number];

/** A setting as the core's capabilities list it, with its enable (ADR 8). */
export type ControlSetting = EditableSetting & Readonly<{ enable: Setting["enable"] }>;

/** Each device's writes switch and settings, by device id, as the capabilities list them. */
export type Devices = Readonly<
  Record<string, Readonly<{ writes: boolean; settings: readonly ControlSetting[] }>>
>;

/** One device's setting as a row of Controls. */
export interface Control {
  readonly device: number;
  readonly setting: ControlSetting;
  /** The device's writes switch is on (ADR 7) and the setting verified or enabled (ADR 8). */
  readonly writable: boolean;
}

export interface ControlGroup {
  readonly id: GroupId;
  readonly controls: readonly Control[];
}

/** The group a setting's key falls in by its role namespace; profiles carry no groups (ADR 21). */
function groupOf(key: string): GroupId {
  const namespace = key.split(".", 1)[0];

  return GROUPS.find((id) => id !== "advanced" && id === namespace) ?? "advanced";
}

/** Every device's settings grouped by role namespace, in the profile's order; empty groups left out. */
export function controlGroups(devices: Devices): ControlGroup[] {
  const controls: Control[] = [];

  for (const [id, device] of Object.entries(devices))
    for (const setting of device.settings)
      controls.push({
        device: Number(id),
        setting,
        writable: device.writes && (setting.enable === "verified" || setting.enable === "on"),
      });

  const groups: ControlGroup[] = [];

  for (const id of GROUPS) {
    const members = controls.filter((control) => groupOf(control.setting.key) === id);

    if (members.length > 0) groups.push({ id, controls: members });
  }

  return groups;
}

/** A value as a row shows it: the profile's label, or the number with its unit. */
export function valueOf(setting: ControlSetting, value: number, locale: string): string {
  if (setting.values) return valueText(value, setting.labels);

  const number = new Intl.NumberFormat(locale).format(value);

  return setting.unit === undefined || setting.unit === null || setting.unit === ""
    ? number
    : `${number} ${setting.unit}`;
}

/** A root row's summary: its first two known values (ADR 21). */
export function summary(
  group: ControlGroup,
  value: (control: Control) => number | null,
  locale: string,
): string {
  return group.controls
    .flatMap((control) => {
      const now = value(control);

      return now === null ? [] : [valueOf(control.setting, now, locale)];
    })
    .slice(0, 2)
    .join(" · ");
}
