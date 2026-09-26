/**
 * The two decisions behind removing a device, kept out of the components so a
 * test can reach them: what a DELETE answer means, and which rows fold away.
 */

import type { DeviceView } from "./device-types";

/** What the delete dialog does next. */
export type DeleteOutcome =
  | { kind: "deleted" }
  /** The device recorded readings; the server keeps them, so offer retiring. */
  | { kind: "history" }
  /** Any other refusal, with the server's reason when it gave one. */
  | { kind: "refused"; reason: string | null };

/** The fields of an Eden answer this reads. */
export type DeleteAnswer = { data: unknown; error: { status: unknown; value: unknown } | null };

const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/** Read a `DELETE /api/devices/:id` answer — `removeDevice` on the server. */
export function deleteOutcome(answer: DeleteAnswer): DeleteOutcome {
  if (answer.data) return { kind: "deleted" };
  const value = answer.error?.value;
  if (field(value, "field") === "history") return { kind: "history" };
  const reason = field(value, "error");
  return { kind: "refused", reason: typeof reason === "string" && reason !== "" ? reason : null };
}

/**
 * In-service rows first, retired ones apart. A retired row stays reachable —
 * it is the only place it can be restored or deleted — but it no longer sits
 * between the devices that are working.
 */
export function splitRetired<T extends Pick<DeviceView, "retiredAt">>(
  devices: readonly T[],
): { active: T[]; retired: T[] } {
  const active: T[] = [];
  const retired: T[] = [];
  for (const device of devices) (device.retiredAt === null ? active : retired).push(device);
  return { active, retired };
}
