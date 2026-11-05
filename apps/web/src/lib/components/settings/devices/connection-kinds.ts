import { CONNECTION_KINDS, type ConnectionKind } from "./device-types";

/** A broker carries integrations only; an engine without them offers nothing to add on one. */
export function offeredKinds(integrations: boolean): ConnectionKind[] {
  return CONNECTION_KINDS.filter((kind) => kind !== "mqtt" || integrations);
}

/** A saved connection's kind is frozen (the core refuses a re-kind with 409); one kind is no choice. */
export function picksKind(locked: boolean, kinds: readonly ConnectionKind[]): boolean {
  return !locked && kinds.length > 1;
}
