// The topology setup proposes from what each device measures (ADR 14).
import type { Device, PointDraft, Values } from "../api/core.ts";

/** Measured at the grid connection point and nowhere else. */
export const ROOT = "grid.power";

/** The power roles a point below the root is measured by, in the order they are proposed. */
const ROLES = [
  "pv.power",
  "generator.power",
  "battery.power",
  "load.power",
  "backup.power",
  "ev.charge.power",
] as const;

/** Roles whose power flows out of their point into its parent (ADR 4, 14). */
const OUT = new Set(["pv.power", "generator.power"]);

type Claimed = Readonly<{ device: number; role: string }>;

/** The live values a proposal and a point's power read. */
export type Reads = Readonly<Pick<Values, "devices" | "stale">>;

/**
 * The root at the grid connection, claimed by every grid meter, and one point below it for each
 * other power role a device reads. A device not read yet proposes nothing; an unused port is left
 * out (see `unused`).
 */
export function propose(
  devices: readonly Readonly<Device>[],
  values: Reads,
  root: string,
  label: (role: string) => string,
): PointDraft[] {
  const grid = devices.flatMap((device) =>
    read(values, device.id, ROOT) === undefined ? [] : [{ device: device.id, role: ROOT }],
  );

  const below = measured(devices, values).filter((claim) => !unused(values, claim));

  return [{ name: root, parent: null, claims: grid }, ...drafts(below, devices, label)];
}

/** The points the devices could measure that `points` does not claim, each below the root. */
export function left(
  points: readonly PointDraft[],
  devices: readonly Readonly<Device>[],
  values: Reads,
  label: (role: string) => string,
): PointDraft[] {
  const claimed = new Set(points.flatMap(({ claims }) => claims.map((claim) => key(claim))));

  return drafts(
    measured(devices, values).filter((claim) => !claimed.has(key(claim))),
    devices,
    label,
  );
}

/** Every power role below the root that a device reads. */
function measured(devices: readonly Readonly<Device>[], values: Reads): Claimed[] {
  return devices.flatMap(({ id }) =>
    ROLES.flatMap((role) => (read(values, id, role) === undefined ? [] : [{ device: id, role }])),
  );
}

/**
 * A port of a device that measures other flows too, reading 0 W with nothing else of its kind
 * above zero: a Deye's GEN port with no generator. A battery reads its SOC, PV its lifetime total.
 */
function unused(values: Reads, { device, role }: Claimed): boolean {
  const readings = values.devices[device] ?? {};

  if (readings[role] !== 0) return false;

  const others = [ROOT, ...ROLES].some((other) => other !== role && readings[other] !== undefined);

  const kind = role.slice(0, role.indexOf("."));

  const wired = Object.keys(readings).some(
    (other) =>
      other !== role &&
      (readings[other] ?? 0) !== 0 &&
      (other.startsWith(`${kind}.`) || other.startsWith(`${kind}[`)),
  );

  return others && !wired;
}

/** Points in plain words; a word two devices share carries the device's name. */
function drafts(
  claims: readonly Claimed[],
  devices: readonly Readonly<Device>[],
  label: (role: string) => string,
): PointDraft[] {
  const shared = (role: string) => claims.filter((claim) => claim.role === role).length > 1;

  return claims.map((claim) => {
    const device = devices.find(({ id }) => id === claim.device)?.name ?? "";

    return {
      name: shared(claim.role) ? `${label(claim.role)} (${device})` : label(claim.role),
      parent: 0,
      claims: [claim],
    };
  });
}

function key({ device, role }: Claimed): string {
  return `${device} ${role}`;
}

function read(values: Reads, device: number, role: string): number | undefined {
  if (values.stale?.[device]?.[role] !== undefined) return undefined;

  return values.devices[device]?.[role];
}

/** A point's power in watts: its first claim with a fresh value. */
export function reading(point: PointDraft, values: Reads): number | undefined {
  for (const { device, role } of point.claims) {
    const value = read(values, device, role);

    if (value !== undefined) return value;
  }

  return undefined;
}

/** A point's power into it: what flows out of a PV or generator point counts against it. */
function inflow(points: readonly PointDraft[], values: Reads, index: number): number | undefined {
  const point = points[index];

  if (point === undefined) return undefined;

  const value = reading(point, values);

  if (value !== undefined) return OUT.has(point.claims[0]?.role ?? "") ? -value : value;

  // Unmeasured: its nearest measured descendants stand in (ADR 14).
  return children(points, index).reduce<number | undefined>((sum, child) => {
    const flow = inflow(points, values, child);

    return sum === undefined || flow === undefined ? undefined : sum + flow;
  }, 0);
}

/** A measured point's own consumption: its power minus its children's, the part none explains. */
export function remainder(
  points: readonly PointDraft[],
  values: Reads,
  index: number,
): number | undefined {
  const point = points[index];
  const own = point === undefined ? undefined : reading(point, values);

  if (point === undefined || own === undefined) return undefined;

  const into = OUT.has(point.claims[0]?.role ?? "") ? -own : own;

  return children(points, index).reduce<number | undefined>((sum, child) => {
    const flow = inflow(points, values, child);

    return sum === undefined || flow === undefined ? sum : sum - flow;
  }, into);
}

function children(points: readonly PointDraft[], index: number): number[] {
  return points.flatMap(({ parent }, at) => (parent === index ? [at] : []));
}

/** The points `index` may hang under: all but itself and what hangs below it. */
export function targets(points: readonly PointDraft[], index: number): number[] {
  const below = new Set([index]);

  for (const [at, { parent }] of points.entries())
    if (parent !== null && parent !== undefined && below.has(parent)) below.add(at);

  return points.flatMap((_, at) => (below.has(at) ? [] : [at]));
}

/** `index` hung under `parent`, the points put back in tree order so parents stay first. */
export function move(points: readonly PointDraft[], index: number, parent: number): PointDraft[] {
  const hung = points[index];

  if (hung === undefined) return [...points];

  const moved = points.with(index, { ...hung, parent });
  const order: number[] = [];

  const visit = (at: number) => {
    order.push(at);

    for (const child of children(moved, at)) visit(child);
  };

  for (const [at, point] of moved.entries())
    if (point.parent === null || point.parent === undefined) visit(at);

  return order.map((at) => {
    const { name, claims, parent: up } = moved[at] ?? { name: "", claims: [] };

    return { name, claims, parent: up === null || up === undefined ? null : order.indexOf(up) };
  });
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

/** How deep each point sits: parents come first, so one pass suffices. */
export function depths(points: readonly PointDraft[]): number[] {
  const out: number[] = [];

  for (const { parent } of points)
    out.push(parent === null || parent === undefined ? 0 : (out[parent] ?? 0) + 1);

  return out;
}

/** A point's key while the tree changes: its claims, or the root's place. */
export function identity(point: PointDraft | undefined): string {
  const claims = point?.claims.map((claim) => key(claim)).join(",") ?? "";

  return claims === "" ? "root" : claims;
}

/** A row of the tree as read: a point, or the remainder `of` a point with children. */
export type Line =
  | { readonly index: number; readonly depth: number }
  | { readonly of: number; readonly rest: number; readonly depth: number };

/** The tree in reading order: the root, each point's children under it, then its remainder. */
export function lines(points: readonly PointDraft[], values: Reads): Line[] {
  const out: Line[] = [];

  const visit = (index: number, depth: number) => {
    out.push({ index, depth });

    const below = children(points, index);

    for (const child of below) visit(child, depth + 1);

    const rest = below.length > 0 ? remainder(points, values, index) : undefined;

    if (rest !== undefined) out.push({ of: index, rest, depth: depth + 1 });
  };

  if (points.length > 0) visit(0, 0);

  return out;
}
