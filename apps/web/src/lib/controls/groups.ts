import type { Setting } from "../api/core.ts";
import { clock, type EditableSetting } from "../components/value-editor/editable.ts";
import { valueText } from "../settings/bounds.ts";

/**
 * Controls' groups (ADR 21), in order: a role namespace each, the time-of-use schedule, and
 * Advanced for the rest.
 */
const GROUPS = ["battery", "schedule", "grid", "advanced"] as const;

/** A time-of-use slot's setting key: `<namespace>.time_of_use.<slot>.<field>`. */
const SLOT = /\.time_of_use\.(\d+)\.[^.]+$/u;

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
  /** Only the admin's enable keeps it read-only: its device's writes are on (ADR 8). */
  readonly awaiting: boolean;
}

export interface ControlGroup {
  readonly id: GroupId;
  readonly controls: readonly Control[];
}

/** The group a setting's key falls in by its role namespace; profiles carry no groups (ADR 21). */
function groupOf(key: string): GroupId {
  if (SLOT.test(key)) return "schedule";

  const namespace = key.split(".", 1)[0];

  return (
    GROUPS.find((id) => id !== "advanced" && id !== "schedule" && id === namespace) ?? "advanced"
  );
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
        awaiting: device.writes && (setting.enable === "off" || setting.enable === "community"),
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

  if (setting.time === true) return clock(value);

  const number = new Intl.NumberFormat(locale).format(value);

  return setting.unit === undefined || setting.unit === null || setting.unit === ""
    ? number
    : `${number} ${setting.unit}`;
}

/** A root row's summary: its first two known values (ADR 21); the schedule's, its slots' starts. */
export function summary(
  group: ControlGroup,
  value: (control: Control) => number | null,
  locale: string,
): string {
  const shown =
    group.id === "schedule"
      ? group.controls.filter((c) => c.setting.time === true)
      : group.controls;

  return shown
    .flatMap((control) => {
      const now = value(control);

      return now === null ? [] : [valueOf(control.setting, now, locale)];
    })
    .slice(0, 2)
    .join(" · ");
}

/** One time-of-use slot of a device: its settings in the profile's order, its start among them. */
export interface Slot {
  readonly device: number;
  readonly n: number;
  readonly controls: readonly Control[];
  readonly start: Control | undefined;
}

/** The schedule's slots, in the order the profile declares them. */
export function slots(group: ControlGroup): Slot[] {
  const found = new Map<string, Control[]>();

  for (const control of group.controls) {
    const n = SLOT.exec(control.setting.key)?.[1];

    if (n === undefined) continue;

    const id = `${control.device} ${n}`;
    found.set(id, [...(found.get(id) ?? []), control]);
  }

  return [...found.values()].map((controls: readonly Control[]) => {
    const first = controls[0]!;

    return {
      device: first.device,
      n: Number(SLOT.exec(first.setting.key)?.[1]),
      controls,
      start: controls.find((c) => c.setting.time === true),
    };
  });
}

/** Where `slot` ends: the next slot's start on its device, round the clock. */
export function slotEnd(slot: Slot, all: readonly Slot[]): Control | undefined {
  const own = all.filter((s) => s.device === slot.device);
  const next = own[(own.indexOf(slot) + 1) % own.length];

  return next?.start;
}
