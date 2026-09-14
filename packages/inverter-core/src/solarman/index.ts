/**
 * Solarman V5 — the framing a Solarman logging stick speaks on port 8899.
 *
 * Everything under here is Node-only (the port dials a TCP socket), and it sits
 * in its own folder because it is a self-contained wire format: a pure codec and
 * the modbus-serial port built on it. Nothing above the transport seam imports
 * from here.
 */

export { checksum, decodeFrame, encodeRequest, splitFrames, SolarmanFrameError } from "./v5-frame";
export type { EncodeRequestInput, SolarmanFrame, SolarmanFrameReason } from "./v5-frame";
export { SolarmanV5Port } from "./v5-port";
export type {
  SolarmanSocket,
  SolarmanSocketFactory,
  SolarmanSocketHandlers,
  SolarmanV5PortOptions,
} from "./v5-port";
