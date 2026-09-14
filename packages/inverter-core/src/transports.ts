/**
 * THE list of Modbus framings this build can open — and the one home for it.
 *
 * Its own module, and its own dependency-free package subpath
 * (`@SunReye/inverter-core/transports`), because four packages need it and two
 * of them cannot import each other: `@SunReye/db` depends on `@SunReye/env`, so
 * `@SunReye/env` deriving its `INVERTER_TRANSPORT` enum from
 * `@SunReye/db`'s `MODBUS_TRANSPORTS` would be a package cycle and turbo's
 * `^check-types` graph would refuse to build. Hoisting the list below both of
 * them costs one 10-line file and removes every hand-written copy.
 *
 * It had FOUR copies before this: here, the `connections` params schema, the
 * legacy `app_settings.inverter` document, the env schema and the poll loop's
 * narrowing — and they had already drifted, which is how a stored framing could
 * be accepted by one layer and silently rewritten to `tcp` by the next.
 *
 * Nothing here imports anything, so a browser bundle can reach it; the package
 * barrel cannot (it pulls in `modbus-serial`).
 */

/**
 * Modbus framing over a TCP socket. Three FRAMINGS of one protocol, not three
 * device kinds: the register map, the read plan, the atomic compute groups and
 * the exception-2 fallback above the transport seam are identical for all of
 * them.
 *
 * - `tcp`          standard Modbus TCP (MBAP header, no CRC).
 * - `rtu-over-tcp` RTU frames (with CRC) tunneled over TCP — what many
 *                  RS485→Ethernet gateways (USR, Waveshare, PUSR) and some
 *                  inverter loggers actually speak.
 * - `solarman-v5`  the proprietary envelope a Solarman logging stick (LSW-3 /
 *                  LSE-3, the WiFi dongle in the box with most Deye/Sunsynk
 *                  inverters) speaks on port 8899, with an RTU frame inside it.
 *                  The stick is NOT a Modbus-TCP gateway, which is why pointing
 *                  `tcp` at 8899 produces nothing but timeouts.
 *
 * ORDER IS LOAD-BEARING for exactly one thing: `tcp` is first, and every layer
 * that has to degrade an unknown stored value degrades to it.
 */
export const MODBUS_TRANSPORTS = ["tcp", "rtu-over-tcp", "solarman-v5"] as const;

/** One of {@link MODBUS_TRANSPORTS}. */
export type InverterTransport = (typeof MODBUS_TRANSPORTS)[number];

/**
 * Narrow an arbitrary stored value to a framing the client has a branch for.
 *
 * Shared rather than re-written per layer, because every hand-written copy of
 * this narrowing has been a silent DOWNGRADE: `=== "rtu-over-tcp" ? … : "tcp"`
 * quietly turned a Solarman endpoint into plain Modbus TCP, which on port 8899
 * answers nothing at all — a plant gone dark with no error to read.
 */
export function narrowTransport(value: unknown): InverterTransport {
  return MODBUS_TRANSPORTS.find((t) => t === value) ?? "tcp";
}
