// fallow-ignore-file unused-export unused-type private-type-leak -- the corpus format is exported for the tests and the Rust port that read it; test files are not traced as consumers
/**
 * Oracle group 1 — transport framing.
 *
 * The 2.x `ModbusTransport` runs against a loopback server that plays the device, once per case
 * and per framing. The corpus records the bytes the 2.x client wrote (`tx`), the bytes the server
 * sent back (`rx`, one entry per TCP read) and what the client made of them. Reply bytes are
 * authored here, independently of the client's own codec, so a mistake in one cannot hide in the
 * other.
 */
import { createServer, type Socket } from "node:net";

import {
  decodeFrame,
  hydrateProfile,
  ModbusTransport,
  splitFrames,
  type InverterTransport,
  type ProfileData,
} from "@SunReye/inverter-core";

import { type CorpusFiles, hex, ndjson } from "./corpus";

/** The Solarman stick whose serial 2.x's tests were captured from. */
const STICK_SERIAL = 0xbce20a25;
/** The heartbeat that stick emits on an idle socket, verbatim from the capture. */
const HEARTBEAT = Buffer.from("a50100104704" + "6f250ae2bc00" + "9815", "hex");

type Registers = Record<number, number>;

interface Device {
  registers: Registers;
  /** Unit ids the device answers; every other id gets silence. */
  units: number[];
}

type Wire = (request: Uint8Array, nth: number) => Uint8Array[] | null;

/** Context a scenario's `tweak` needs to bend one reply. */
interface Reply {
  /** Index of this request among those that are not discovery probes. */
  real: number;
  /** Low byte of the request's sequence (Solarman only). */
  seq: number;
  serial: number;
}

type Tweak = (frame: Uint8Array, reply: Reply) => Uint8Array[];

type Operation =
  | { op: "read" }
  | { op: "write"; key: string; value: number }
  | { op: "probe-unit"; units: number[]; timeoutMs: number };

interface Scenario {
  name: string;
  doc: string;
  framing: InverterTransport;
  unitId: number;
  metrics: "plain" | "grouped";
  device: Device;
  operation: Operation;
  configuredSerial?: number;
  tweak?: Tweak;
}

type DecodedFrame =
  | { kind: "response"; serial: number; seq: number; status: number; pdu: string }
  | { kind: "status"; serial: number; seq: number; status: number; payload: string }
  | { kind: "other"; controlCode: number }
  | { error: string };

export type WireEvent =
  | { dir: "tx"; hex: string }
  | { dir: "rx"; chunks: string[]; decoded?: DecodedFrame[] };

export interface TransportCase {
  group: "transport";
  case: string;
  framing: InverterTransport;
  unitId: number;
  doc: string;
  metrics: MetricSpec[];
  device: Record<string, number>;
  deviceUnits: number[];
  operation: Operation;
  configuredSerial?: number;
  exchanges: WireEvent[];
  result: unknown;
  loggerSerial?: number;
}

interface MetricSpec {
  key: string;
  type: "U_WORD" | "S_WORD" | "U_DWORD";
  addr: number[];
  scale: number;
  access: "r" | "rw";
  computeSum?: string[];
}

// ---------------------------------------------------------------------------
// Profiles and devices

const PLAIN: MetricSpec[] = [
  { key: "x.voltage", type: "U_WORD", addr: [500], scale: 0.1, access: "r" },
  { key: "x.power", type: "S_WORD", addr: [501], scale: 1, access: "r" },
  { key: "x.energy", type: "U_DWORD", addr: [502, 503], scale: 0.1, access: "r" },
  { key: "x.limit", type: "U_WORD", addr: [504], scale: 0.1, access: "rw" },
];

/** Adds a computed metric over registers 500 and 520, which plans one atomic span across the gap. */
const GROUPED: MetricSpec[] = [
  ...PLAIN,
  { key: "x.far", type: "U_WORD", addr: [520], scale: 1, access: "r" },
  {
    key: "x.total",
    type: "U_WORD",
    addr: [],
    scale: 1,
    access: "r",
    computeSum: ["x.voltage", "x.far"],
  },
];

const PLAIN_REGISTERS: Registers = { 500: 2305, 501: 0xfc18, 502: 0x1234, 503: 1, 504: 149 };
const GROUPED_REGISTERS: Registers = { ...PLAIN_REGISTERS, 520: 7 };

const metricData = (m: MetricSpec): ProfileData["metrics"][number] =>
  ({
    key: m.key,
    topic: m.key.replace(".", "/"),
    label: m.key,
    unit: null,
    group: "x",
    type: m.type,
    addresses: m.addr,
    scale: m.scale,
    access: m.access,
    binding: m.computeSum
      ? { via: "compute", expr: { sum: m.computeSum } }
      : { via: "modbus", addr: m.addr, type: m.type },
    ...(m.computeSum ? { computeExpr: { sum: m.computeSum } } : {}),
  }) as ProfileData["metrics"][number];

const profileOf = (metrics: MetricSpec[]) =>
  hydrateProfile({
    schemaVersion: 3,
    id: "oracle-transport",
    name: "Oracle transport",
    manufacturer: "SunReye",
    version: "1.0.0",
    metrics: metrics.map(metricData),
  } as ProfileData);

// ---------------------------------------------------------------------------
// The device side of the wire (authored here, not borrowed from the client)

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u32le = (b: Uint8Array, at: number): number =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

const withCrc = (body: Uint8Array): Uint8Array =>
  Uint8Array.from([...body, crc16(body) & 0xff, crc16(body) >> 8]);

/** The PDU a device answers with, or null when it stays silent. */
function answer(device: Device, unit: number, pdu: Uint8Array): Uint8Array | null {
  if (!device.units.includes(unit)) return null;
  const fn = pdu[0]!;
  const start = u16(pdu, 1);
  const count = u16(pdu, 3);
  if (fn === 0x10) return pdu.slice(0, 5);
  if (fn !== 0x03) return Uint8Array.from([fn | 0x80, 1]);
  const addresses = Array.from({ length: count }, (_, i) => start + i);
  // A register the device does not map refuses the whole range with exception 2.
  if (addresses.some((a) => device.registers[a] === undefined)) return Uint8Array.from([0x83, 2]);
  const words = addresses.flatMap((a) => [device.registers[a]! >> 8, device.registers[a]! & 0xff]);
  return Uint8Array.from([0x03, count * 2, ...words]);
}

/** The Solarman V5 envelope as a stick sends it: a 14-byte business field, status byte 0x01. */
function v5Frame(serial: number, seq: number, payload: Uint8Array, control = 0x1510): Uint8Array {
  const length = 14 + payload.length;
  const frame = new Uint8Array(11 + length + 2);
  const view = new DataView(frame.buffer);
  frame[0] = 0xa5;
  view.setUint16(1, length, true);
  view.setUint16(3, control, true);
  view.setUint16(5, seq, true);
  view.setUint32(7, serial, true);
  frame[11] = 0x02;
  frame[12] = 0x01;
  frame.set(payload, 25);
  frame[frame.length - 1] = 0x15;
  frame[frame.length - 2] = frame.subarray(1, frame.length - 2).reduce((s, b) => (s + b) & 0xff, 0);
  return frame;
}

/** Sequence word as the stick sends it: its own counter in the high byte, the echo in the low. */
const echoSeq = (seq: number): number => (0x0d << 8) | seq;

const v5Reject = (serial: number, seq: number, status: number): Uint8Array =>
  v5Frame(serial, echoSeq(seq), Uint8Array.from([status, 0]));

interface Parsed {
  unit: number;
  pdu: Uint8Array;
  reply(pdu: Uint8Array): Uint8Array;
}

/** A Modbus TCP reply: the request's transaction id, protocol 0, length, unit, PDU. */
const parseMbap = (request: Uint8Array): Parsed => ({
  unit: request[6]!,
  pdu: request.subarray(7),
  reply: (pdu) =>
    Uint8Array.from([request[0]!, request[1]!, 0, 0, 0, pdu.length + 1, request[6]!, ...pdu]),
});

const PARSE: Record<InverterTransport, (request: Uint8Array) => Parsed> = {
  tcp: parseMbap,
  // 2.x's `rtu-over-tcp` is modbus-serial's TcpRTUBufferedPort, which strips the CRC and writes an
  // MBAP header: the same bytes as `tcp`. It differs only in how it reads replies.
  "rtu-over-tcp": parseMbap,
  "solarman-v5": (request) => {
    const inner = request.subarray(26, request.length - 2);
    return {
      unit: inner[0]!,
      pdu: inner.subarray(1, inner.length - 2),
      reply: (pdu) =>
        v5Frame(
          u32le(request, 7),
          echoSeq(request[5]!),
          withCrc(Uint8Array.from([inner[0]!, ...pdu])),
        ),
    };
  },
};

/** A gateway or stick: answers what the device answers; rejects a wrong logger serial. */
function wireFor(scenario: Scenario): Wire {
  let real = 0;
  return (request) => {
    if (scenario.framing === "solarman-v5" && u32le(request, 7) !== STICK_SERIAL) {
      return [v5Reject(STICK_SERIAL, request[5]!, 0x06)];
    }
    const parsed = PARSE[scenario.framing](request);
    const pdu = answer(scenario.device, parsed.unit, parsed.pdu);
    const context: Reply = { real: real++, seq: request[5]!, serial: STICK_SERIAL };
    // A silent device still counts as a request: a retry must see the next index.
    if (pdu === null) return null;
    const frame = parsed.reply(pdu);
    return scenario.tweak ? scenario.tweak(frame, context) : [frame];
  };
}

// ---------------------------------------------------------------------------
// The loopback server and the recording

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describeFrames(chunks: Uint8Array[]): DecodedFrame[] {
  return chunks.flatMap((chunk) => {
    const split = splitFramesOrNothing(chunk);
    return split.map((frame) => decodeOne(frame));
  });
}

function splitFramesOrNothing(chunk: Uint8Array): Uint8Array[] {
  try {
    return splitFrames(chunk).frames;
  } catch {
    return [chunk];
  }
}

function decodeOne(frame: Uint8Array): DecodedFrame {
  try {
    const decoded = decodeFrame(frame);
    if (decoded.kind === "response") {
      const { kind, serial, seq, status, pdu } = decoded;
      return { kind, serial, seq, status, pdu: hex(pdu) };
    }
    if (decoded.kind === "status") {
      const { kind, serial, seq, status, payload } = decoded;
      return { kind, serial, seq, status, payload: hex(payload) };
    }
    return decoded;
  } catch (error) {
    return { error: (error as { reason?: string }).reason ?? "invalid" };
  }
}

async function listen(wire: Wire, framing: InverterTransport) {
  const events: WireEvent[] = [];
  const sockets = new Set<Socket>();
  let nth = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (data: Buffer) => {
      void respond(socket, new Uint8Array(data));
    });
    socket.on("error", () => {});
  });
  const respond = async (socket: Socket, request: Uint8Array) => {
    events.push({ dir: "tx", hex: hex(request) });
    const chunks = wire(request, nth++);
    if (chunks === null) return;
    events.push({
      dir: "rx",
      chunks: chunks.map(hex),
      ...(framing === "solarman-v5" ? { decoded: describeFrames(chunks) } : {}),
    });
    for (const chunk of chunks) {
      socket.write(chunk);
      await sleep(30);
    }
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    port,
    events,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function describeError(error: unknown): Record<string, unknown> {
  const e = error as { name?: string; message?: string; modbusCode?: number; errno?: string };
  return {
    name: e.name,
    message: e.message,
    ...(e.modbusCode === undefined ? {} : { modbusCode: e.modbusCode }),
    ...(e.errno === undefined ? {} : { errno: e.errno }),
  };
}

async function perform(transport: ModbusTransport, operation: Operation): Promise<unknown> {
  if (operation.op === "read") return transport.read();
  if (operation.op === "write") {
    await transport.write(operation.key, operation.value);
    return { written: operation.key };
  }
  const probe: Record<string, boolean> = {};
  for (const unit of operation.units)
    probe[unit] = await transport.probeUnit(unit, operation.timeoutMs);
  return { probe };
}

async function run(scenario: Scenario): Promise<TransportCase> {
  const specs = scenario.metrics === "plain" ? PLAIN : GROUPED;
  const server = await listen(wireFor(scenario), scenario.framing);
  const transport = new ModbusTransport(profileOf(specs), {
    host: "127.0.0.1",
    port: server.port,
    unitId: scenario.unitId,
    timeoutMs: 300,
    transport: scenario.framing,
    ...(scenario.configuredSerial === undefined ? {} : { loggerSerial: scenario.configuredSerial }),
  });
  let result: unknown;
  try {
    result = await perform(transport, scenario.operation);
  } catch (error) {
    result = { error: describeError(error) };
  }
  await sleep(50);
  const loggerSerial = transport.loggerSerial;
  await transport.close();
  await server.close();
  return {
    group: "transport",
    case: `${scenario.framing}/${scenario.name}`,
    framing: scenario.framing,
    unitId: scenario.unitId,
    doc: scenario.doc,
    metrics: specs,
    device: scenario.device.registers,
    deviceUnits: scenario.device.units,
    operation: scenario.operation,
    ...(scenario.configuredSerial === undefined
      ? {}
      : { configuredSerial: scenario.configuredSerial }),
    exchanges: server.events,
    result,
    ...(loggerSerial === undefined ? {} : { loggerSerial }),
  };
}

// ---------------------------------------------------------------------------
// The scenarios

const FRAMINGS: InverterTransport[] = ["tcp", "rtu-over-tcp", "solarman-v5"];

const device = (units: number[], registers = PLAIN_REGISTERS): Device => ({ registers, units });

/** A scenario with the defaults most share: unit 1 answering, a plain read. */
const scenario = (
  framing: InverterTransport,
  name: string,
  doc: string,
  over: Partial<Scenario> = {},
): Scenario => ({
  framing,
  name,
  doc,
  metrics: "plain",
  unitId: 1,
  device: device([1]),
  operation: { op: "read" },
  ...over,
});

/** Cases every framing shares. */
function common(f: InverterTransport): Scenario[] {
  return [
    scenario(f, "read-unit-1", "FC03 500 x5 of unit 1; scale, sign, low-word-first double word"),
    scenario(f, "read-unit-0", "the same read addressed to unit 0 (a gateway that answers 0)", {
      unitId: 0,
      device: device([0]),
    }),
    scenario(f, "write-register", "FC16 of one word, never FC06: 14.9 at scale 0.1 is word 149", {
      operation: { op: "write", key: "x.limit", value: 14.9 },
    }),
    scenario(f, "probe-unit", "unit-id scan: unit 0 is silent (timeout), unit 1 answers", {
      operation: { op: "probe-unit", units: [0, 1], timeoutMs: 250 },
    }),
    scenario(f, "fragmented-reply", "the reply arrives in two TCP reads, split inside the header", {
      tweak: (frame) => [frame.slice(0, 5), frame.slice(5)],
    }),
    scenario(
      f,
      "leading-junk",
      "three stray bytes precede the reply in one TCP read; a buffered reader resynchronises",
      { tweak: (frame) => [concat([Uint8Array.from([0xde, 0xad, 0xbe]), frame])] },
    ),
    scenario(
      f,
      "exception-2-split",
      "an atomic group spans 500..520; the device refuses the gap with exception 2; the plan splits and stays split",
      { metrics: "grouped", device: { registers: GROUPED_REGISTERS, units: [1] } },
    ),
  ];
}

/** A copy of `frame` with another sequence word and a valid checksum. */
function restamp(frame: Uint8Array, seq: number): Uint8Array {
  const copy = frame.slice();
  new DataView(copy.buffer).setUint16(5, seq, true);
  copy[copy.length - 2] = copy.subarray(1, copy.length - 2).reduce((s, b) => (s + b) & 0xff, 0);
  return copy;
}

const concat = (parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => [...p]));

/** Cases only the Solarman stick has: its own status codes, heartbeats and serial discovery. */
function solarmanOnly(): Scenario[] {
  const f = "solarman-v5";
  const reject =
    (status: number): Tweak =>
    (_frame, r) => [v5Reject(r.serial, r.seq, status)];
  return [
    scenario(
      f,
      "logger-serial-discovery",
      "a wrong configured serial is replaced by the one the stick's reject names; requests carry the real one",
      { configuredSerial: 0x11223344 },
    ),
    scenario(
      f,
      "transient-05-retried",
      "status 05 on the first request is retried once, byte-identical RTU frame, fresh sequence; the retry is answered",
      { tweak: (frame, r) => (r.real === 0 ? reject(0x05)(frame, r) : [frame]) },
    ),
    scenario(
      f,
      "persistent-05-is-exception-2",
      "status 05 twice is the structural verdict: a synthesised Modbus exception 2, no third attempt",
      { tweak: reject(0x05) },
    ),
    scenario(
      f,
      "wrong-serial-06",
      "status 06 (wrong logger serial) is an addressing failure: Modbus exception 10, not 2",
      { tweak: reject(0x06) },
    ),
    scenario(
      f,
      "heartbeat-and-stray-frames",
      "one TCP read holds a heartbeat, a reply to another sequence, a reply with a bad checksum and the real reply; only the real one answers",
      {
        tweak: (frame, r) => {
          const corrupt = frame.slice();
          corrupt[corrupt.length - 2] = (corrupt[corrupt.length - 2]! + 1) & 0xff;
          return [concat([HEARTBEAT, restamp(frame, echoSeq((r.seq + 1) & 0xff)), corrupt, frame])];
        },
      },
    ),
  ];
}

export const SCENARIOS: Scenario[] = [...FRAMINGS.flatMap(common), ...solarmanOnly()];

/** Build `transport.ndjson`. */
export async function buildTransportCorpus(): Promise<CorpusFiles> {
  const cases: TransportCase[] = [];
  for (const scenario of SCENARIOS) cases.push(await run(scenario));
  return { "transport.ndjson": ndjson(cases) };
}
