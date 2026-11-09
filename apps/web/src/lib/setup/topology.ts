// The topology setup proposes from what each device measures (ADR 14).
import type { Device, PointDraft, Values } from "../api/core.ts";

/** Measured at the grid connection point and nowhere else. */
const ROOT = "grid.power";

/** The power roles a point below the root is measured by, in the order they are proposed. */
const ROLES = [
  "pv.power",
  "generator.power",
  "battery.power",
  "load.power",
  "backup.power",
  "ev.charge.power",
] as const;

/**
 * The root at the grid connection, claimed by every grid meter, and one point below it for each
 * other power role a device reads. A device not read yet proposes nothing.
 */
export function propose(
  devices: readonly Readonly<Device>[],
  values: Readonly<Values>,
  root: string,
  label: (role: string) => string,
): PointDraft[] {
  const reads = ({ id }: Readonly<Device>, role: string) =>
    values.devices[id]?.[role] !== undefined;

  const grid = devices.flatMap((device) =>
    reads(device, ROOT) ? [{ device: device.id, role: ROOT }] : [],
  );

  const below = devices.flatMap((device) =>
    ROLES.flatMap((role) =>
      reads(device, role)
        ? [
            {
              name: `${device.name} ${label(role)}`,
              parent: 0,
              claims: [{ device: device.id, role }],
            },
          ]
        : [],
    ),
  );

  return [{ name: root, parent: null, claims: grid }, ...below];
}

/** Without the point at `index`: its children move to its parent, and later indices shift. */
export function remove(points: readonly PointDraft[], index: number): PointDraft[] {
  const removed = points[index]?.parent ?? null;

  const shifted = (parent: number | null | undefined) => {
    if (parent === null || parent === undefined) return null;

    if (parent === index) return removed;

    return parent > index ? parent - 1 : parent;
  };

  return points.flatMap(({ name, parent, claims }, at) =>
    at === index ? [] : [{ name, parent: shifted(parent), claims }],
  );
}
