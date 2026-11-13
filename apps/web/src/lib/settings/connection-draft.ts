// The transports a connection in Settings may use, their usual ports and their credentials (ADR 7).
import type { Connection } from "../api/core.ts";

/** Every transport the core reaches devices through, each with the port it usually listens on. */
export const TRANSPORTS: readonly (readonly [Connection["transport"], number])[] = [
  ["modbus-tcp", 502],
  ["rtu-over-tcp", 502],
  ["solarman-v5", 8899],
  ["mqtt", 1883],
  ["http", 80],
];

/** The port `transport` usually listens on. */
export function portOf(transport: Connection["transport"]): number {
  return TRANSPORTS.find(([t]) => t === transport)?.[1] ?? 0;
}

/** The credentials a transport signs in with; none for Modbus. */
export function secretsOf(
  transport: Connection["transport"],
): readonly ("username" | "password")[] {
  return transport === "mqtt" || transport === "http" ? ["username", "password"] : [];
}
