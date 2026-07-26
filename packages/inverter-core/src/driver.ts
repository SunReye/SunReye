import { getLogger } from "@logtape/logtape";
import ModbusRTU from "modbus-serial";

import { applyComputed } from "./computed";

import { decode, encodeWord } from "./codec";
import type {
  InverterConnection,
  InverterProfile,
  InverterSample,
  InverterSource,
  MetricDef,
  MetricValues,
} from "./types";

/**
 * Library logger — a no-op until the host app configures LogTape (the server
 * routes this category into its console + log-viewer sinks).
 */
const log = getLogger(["inverter-core", "driver"]);

/** Modbus caps a single read at 125 registers; stay under it. */
const MAX_BLOCK = 120;

/** One planned Modbus read: `count` registers starting at `start`. */
export interface ReadBlock {
  start: number;
  count: number;
  /**
   * Spanning block emitted for an atomic compute group — one transaction so
   * every input register shares a single device-side snapshot. May cover
   * unmapped "gap" registers between the inputs.
   */
  grouped?: boolean;
}

/** Wire addresses a metric occupies (empty for RAW / computed / composite). */
function addressesOf(m: MetricDef): number[] {
  if (m.type === "RAW" || m.addresses.length === 0) return [];
  // U_DWORD lists explicit [low, high]; single-word types occupy one register
  // from the base address.
  return m.type === "U_DWORD" ? [...m.addresses] : [m.addresses[0]!];
}

/** Every readable wire address in the profile. */
function readableAddresses(metrics: MetricDef[]): Set<number> {
  const addresses = new Set<number>();
  for (const m of metrics) for (const a of addressesOf(m)) addresses.add(a);
  return addresses;
}

/** Ascending addresses → contiguous blocks, split on gaps and the per-request cap. */
function splitIntoBlocks(sorted: number[]): ReadBlock[] {
  const blocks: ReadBlock[] = [];
  for (const addr of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && addr <= last.start + last.count && addr - last.start < MAX_BLOCK) {
      last.count = Math.max(last.count, addr - last.start + 1);
    } else {
      blocks.push({ start: addr, count: 1 });
    }
  }
  return blocks;
}

/** Raw wire addresses a metric transitively depends on (through computed deps). */
function collectRawAddresses(
  def: MetricDef,
  byKey: Map<string, MetricDef>,
  out: Set<number>,
  seen: Set<string>,
): void {
  if (seen.has(def.key)) return;
  seen.add(def.key);
  if (def.computeInputs) {
    for (const key of def.computeInputs) {
      const dep = byKey.get(key);
      if (dep) collectRawAddresses(dep, byKey, out, seen);
    }
    return;
  }
  for (const a of addressesOf(def)) out.add(a);
}

/**
 * One spanning {@link ReadBlock} per atomic compute group: the transitive raw
 * inputs of each computed metric, so they are all sampled in a single Modbus
 * transaction. Groups whose address ranges intersect are merged — a register
 * read twice would take the later transaction's value and silently un-sync the
 * first group. A group spanning more than {@link MAX_BLOCK} registers cannot
 * fit one transaction (Modbus per-read cap); it is dropped with a warning and
 * its inputs are read split, ms apart — the computed value can show transient
 * skew on fast power swings (its declared `range` clamp is the only guard).
 */
function resolveAtomicGroups(metrics: MetricDef[]): ReadBlock[] {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  interface Range {
    min: number;
    max: number;
    keys: string[];
  }
  const ranges: Range[] = [];
  for (const def of metrics) {
    if (!def.computeInputs) continue;
    const addrs = new Set<number>();
    collectRawAddresses(def, byKey, addrs, new Set());
    if (addrs.size < 2) continue; // a single register is atomic by itself
    ranges.push({ min: Math.min(...addrs), max: Math.max(...addrs), keys: [def.key] });
  }

  ranges.sort((a, b) => a.min - b.min);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.min <= last.max) {
      last.max = Math.max(last.max, r.max);
      last.keys.push(...r.keys);
    } else {
      merged.push({ min: r.min, max: r.max, keys: [...r.keys] });
    }
  }

  const blocks: ReadBlock[] = [];
  for (const r of merged) {
    const span = r.max - r.min + 1;
    if (span > MAX_BLOCK) {
      log.warn(
        `atomic read group for ${r.keys.join(", ")} spans ${span} registers (cap ${MAX_BLOCK}); ` +
          `reading split — these computed values may show transient skew on fast power swings`,
      );
      continue;
    }
    blocks.push({ start: r.min, count: span, grouped: true });
  }
  return blocks;
}

/**
 * Plan the poll's Modbus reads. Raw registers feeding a computed metric are
 * grouped into one spanning transaction (see {@link resolveAtomicGroups}) so
 * derived values like efficiency never mix registers sampled ms apart; every
 * remaining address is collapsed into contiguous blocks, split on gaps and the
 * per-request register cap.
 *
 * Caveats: a spanning block also reads the unmapped registers between its
 * inputs — devices that reject that (Modbus exception 2) are detected at read
 * time and the block falls back to plain split reads. Inputs further apart
 * than {@link MAX_BLOCK} registers can never share a transaction, so those
 * computed metrics keep the transient-skew behavior.
 */
export function planReads(metrics: MetricDef[]): ReadBlock[] {
  const groups = resolveAtomicGroups(metrics);
  const covered = (a: number) => groups.some((g) => a >= g.start && a < g.start + g.count);
  const rest = [...readableAddresses(metrics)].filter((a) => !covered(a)).sort((a, b) => a - b);
  return [...groups, ...splitIntoBlocks(rest)].sort((a, b) => a.start - b.start);
}

/**
 * Re-plan a spanning group block into the plain gap-split blocks of the
 * profile addresses it covers — the fallback when a device rejects reading the
 * unmapped registers inside the span.
 *
 * @internal
 */
export function splitBlock(block: ReadBlock, metrics: MetricDef[]): ReadBlock[] {
  const addrs = [...readableAddresses(metrics)]
    .filter((a) => a >= block.start && a < block.start + block.count)
    .sort((a, b) => a - b);
  return splitIntoBlocks(addrs);
}

/** Modbus exception 2 — the device declined the address range itself. */
function isIllegalDataAddress(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "modbusCode" in err &&
    (err as { modbusCode?: unknown }).modbusCode === 2
  );
}

/** Generic Modbus-TCP source that reads/writes any {@link InverterProfile}. */
export class ModbusInverter implements InverterSource {
  readonly profile: InverterProfile;
  private readonly conn: InverterConnection;
  private readonly blocks: ReadBlock[];
  private client: ModbusRTU | null = null;
  private connecting: Promise<ModbusRTU> | null = null;
  /** Serializes transactions on the shared client — modbus-serial allows only
   * one in-flight request per connection, so a write must never overlap a
   * concurrent poll read (the interleaved responses would mismatch and time
   * out). */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(profile: InverterProfile, conn: InverterConnection) {
    this.profile = profile;
    this.conn = conn;
    this.blocks = planReads(profile.metrics);
    log.info(
      `modbus read plan for ${profile.id}: ` +
        this.blocks.map((b) => `${b.start}+${b.count}${b.grouped ? " (atomic)" : ""}`).join(", "),
    );
  }

  /** Run a Modbus transaction with exclusive access to the client. */
  private locked<T>(op: () => Promise<T>): Promise<T> {
    const result = this.lock.then(op, op);
    // Keep the chain alive on failure without leaking the rejection.
    this.lock = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async getClient(): Promise<ModbusRTU> {
    if (this.client?.isOpen) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const next = new ModbusRTU();
      const timeout = this.conn.timeoutMs ?? 2000;
      const opts = { port: this.conn.port };
      // Modbus TCP (MBAP framing) vs RTU frames tunneled over the socket, the
      // latter common with RS485→Ethernet gateways.
      const connect =
        this.conn.transport === "rtu-over-tcp"
          ? next.connectTcpRTUBuffered(this.conn.host, opts)
          : next.connectTCP(this.conn.host, opts);
      try {
        // The connect call itself has no timeout, so an unreachable host would
        // hang forever; race it so a bad address fails fast (test-connection,
        // polling).
        await Promise.race([
          connect,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`connect to ${this.conn.host}:${this.conn.port} timed out`)),
              timeout,
            ),
          ),
        ]);
      } catch (err) {
        next.close(() => {});
        this.connecting = null;
        throw err;
      }
      next.setID(this.conn.unitId);
      next.setTimeout(timeout);
      this.client = next;
      this.connecting = null;
      return next;
    })();
    return this.connecting;
  }

  async read(): Promise<InverterSample> {
    const client = await this.getClient();
    const started = performance.now();
    const regs = await this.locked(async () => {
      const acc = new Map<number, number>();
      // Snapshot: a grouped-block fallback splices this.blocks mid-iteration.
      for (const block of this.blocks.slice()) {
        try {
          const { data } = await client.readHoldingRegisters(block.start, block.count);
          data.forEach((word, i) => acc.set(block.start + i, word));
        } catch (err) {
          // A device may reject a spanning group read because it covers
          // unmapped gap registers (exception 2). Permanently fall back to the
          // plain split blocks for this group; anything else propagates.
          if (!block.grouped || !isIllegalDataAddress(err)) throw err;
          const subBlocks = splitBlock(block, this.profile.metrics);
          log.warn(
            `${this.profile.id}: device rejected atomic read ${block.start}+${block.count}; ` +
              `splitting into ${subBlocks.map((b) => `${b.start}+${b.count}`).join(", ")} — ` +
              `computed values may show transient skew on fast power swings`,
          );
          this.blocks.splice(this.blocks.indexOf(block), 1, ...subBlocks);
          for (const sub of subBlocks) {
            const { data } = await client.readHoldingRegisters(sub.start, sub.count);
            data.forEach((word, i) => acc.set(sub.start + i, word));
          }
        }
      }
      return acc;
    });
    log.debug("read {registers} registers in {blocks} blocks ({ms} ms)", {
      registers: regs.size,
      blocks: this.blocks.length,
      ms: Math.round(performance.now() - started),
    });

    const metrics: MetricValues = {};
    for (const def of this.profile.metrics) {
      // Derived (compute) and composite (controlExpr) metrics own no register.
      if (def.compute || def.controlExpr) continue;
      const value = decode(def, regs);
      if (value !== undefined) metrics[def.key] = value;
    }
    applyComputed(this.profile.metrics, metrics);

    return { time: new Date().toISOString(), inverterId: this.profile.id, metrics };
  }

  async write(key: string, value: number): Promise<void> {
    const def = this.profile.metrics.find((m) => m.key === key);
    if (!def) throw new Error(`unknown metric: ${key}`);
    if (def.access !== "rw") throw new Error(`metric is read-only: ${key}`);
    if (def.addresses.length !== 1 || (def.type !== "U_WORD" && def.type !== "S_WORD")) {
      throw new Error(`metric is not a single-word writable register: ${key}`);
    }
    const client = await this.getClient();
    // Use FC16 (Write Multiple Registers) even for this single word: Deye/Sunsynk
    // inverters silently ignore FC6 (Write Single Register) on their settings
    // registers — the request gets no reply and the transaction times out.
    const word = encodeWord(def, value);
    await this.locked(() => client.writeRegisters(def.addresses[0]!, [word]));
    // Info, not debug: writes are rare, user-initiated register changes, and
    // this is the one choke point every entry path (API, MQTT, composite
    // controls) funnels through.
    log.info("write {key}={value} (register {register} <- {word})", {
      key,
      value,
      register: def.addresses[0]!,
      word,
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.client?.isOpen) this.client.close(() => resolve());
      else resolve();
    });
    this.client = null;
  }
}
