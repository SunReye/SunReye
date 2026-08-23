/**
 * The Modbus {@link DeviceTransport}: everything about *how* a register-mapped
 * device is talked to, below the seam.
 *
 * Read planning lives here on purpose. Contiguous-block coalescing, the
 * {@link MAX_BLOCK} per-request cap, atomic compute groups and the exception-2
 * split-and-remember fallback are all artifacts of a half-duplex register bus:
 * none of it generalises. A single HTTP GET is atomic for free, and a push
 * transport has no read to plan at all. So none of it belongs above the
 * interface.
 */

import { getLogger } from "@logtape/logtape";
import ModbusRTU from "modbus-serial";

import { decode, encodeWord } from "./codec";
import type {
  DeviceTransport,
  InverterConnection,
  InverterProfile,
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

/**
 * Wire addresses a metric occupies (empty unless it is bound to readable
 * registers). Read from the {@link MetricDef.binding} — the deprecated
 * `type`/`addresses` mirror is not consulted anywhere below the seam.
 */
function addressesOf(m: MetricDef): number[] {
  const b = m.binding;
  if (b.via !== "modbus" || b.type === "RAW" || b.addr.length === 0) return [];
  // U_DWORD lists explicit [low, high]; single-word types occupy one register
  // from the base address.
  return b.type === "U_DWORD" ? [...b.addr] : [b.addr[0]!];
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

/** The address span one or more computed metrics need sampled together. */
interface AtomicRange {
  min: number;
  max: number;
  /** Computed metrics whose inputs this span covers (for the warning message). */
  keys: string[];
}

/**
 * The span of every computed metric with two or more raw inputs, ascending by
 * start address. A single input register is already atomic, so it is skipped.
 */
function atomicRanges(metrics: MetricDef[]): AtomicRange[] {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const ranges: AtomicRange[] = [];
  for (const def of metrics) {
    if (!def.computeInputs) continue;
    const addrs = new Set<number>();
    collectRawAddresses(def, byKey, addrs, new Set());
    if (addrs.size < 2) continue;
    ranges.push({ min: Math.min(...addrs), max: Math.max(...addrs), keys: [def.key] });
  }
  return ranges.sort((a, b) => a.min - b.min);
}

/**
 * Fold intersecting spans (given ascending) into one: a register read twice
 * would take the later transaction's value and silently un-sync the first
 * group. Returns fresh ranges; the input is not mutated.
 */
function mergeRanges(ranges: AtomicRange[]): AtomicRange[] {
  const merged: AtomicRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.min <= last.max) {
      last.max = Math.max(last.max, r.max);
      last.keys.push(...r.keys);
    } else {
      merged.push({ min: r.min, max: r.max, keys: [...r.keys] });
    }
  }
  return merged;
}

/**
 * One spanning block for a merged range, or `undefined` when it exceeds the
 * Modbus per-read cap and therefore cannot share a transaction at all: it is
 * dropped with a warning and its inputs are read split, ms apart — the computed
 * value can show transient skew on fast power swings (its declared `range`
 * clamp is the only guard).
 */
function groupedBlock(r: AtomicRange): ReadBlock | undefined {
  const span = r.max - r.min + 1;
  if (span > MAX_BLOCK) {
    log.warn(
      `atomic read group for ${r.keys.join(", ")} spans ${span} registers (cap ${MAX_BLOCK}); ` +
        `reading split — these computed values may show transient skew on fast power swings`,
    );
    return undefined;
  }
  return { start: r.min, count: span, grouped: true };
}

/**
 * Whether any atomic group is too wide to share a transaction, and so is read
 * split from the very first poll. Same skew as the exception-2 fallback, decided
 * at plan time instead of at read time — and unlike the fallback it raises no
 * exception to notice it by, which is exactly why it has to be asked about.
 */
export function hasUnplannableGroup(metrics: MetricDef[]): boolean {
  return mergeRanges(atomicRanges(metrics)).some((r) => r.max - r.min + 1 > MAX_BLOCK);
}

/**
 * One spanning {@link ReadBlock} per atomic compute group: the transitive raw
 * inputs of each computed metric, so they are all sampled in a single Modbus
 * transaction.
 */
function resolveAtomicGroups(metrics: MetricDef[]): ReadBlock[] {
  return mergeRanges(atomicRanges(metrics))
    .map(groupedBlock)
    .filter((b): b is ReadBlock => b !== undefined);
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

/**
 * The single-word register a `rw` metric is written through, or `undefined`
 * when the metric is not one (computed, composite control, RAW block, 32-bit
 * counter). Only `U_WORD`/`S_WORD` holding registers are writable.
 */
function writableRegister(def: MetricDef): number | undefined {
  const b = def.binding;
  if (b.via !== "modbus" || b.addr.length !== 1) return undefined;
  if (b.type !== "U_WORD" && b.type !== "S_WORD") return undefined;
  return b.addr[0];
}

/**
 * One physical bus: the socket, and the lock that serializes everything on it.
 *
 * Shared by every device reached through the same host, port and framing,
 * because that is what the wire is. Several inverters on one RS485→Ethernet
 * gateway differ only by unit id, and cheap gateways either accept a single TCP
 * connection or interleave two devices' RTU frames into mismatched responses —
 * the failure the lock has always existed to prevent, one device further out.
 */
interface Bus {
  client: ModbusRTU | null;
  connecting: Promise<ModbusRTU> | null;
  /** Serializes transactions: one request in flight per connection, ever. */
  lock: Promise<unknown>;
  /** How many transports hold this bus; the last one out closes the socket. */
  holders: number;
}

/**
 * Every open bus, by connection. Module-level because the thing it models is:
 * two transports pointed at one gateway are pointed at one piece of hardware,
 * whatever object graph built them.
 */
const buses = new Map<string, Bus>();

/**
 * Forget every bus without closing anything.
 *
 * For tests, which build transports against the same fake gateway over and over
 * and would otherwise inherit the previous test's socket. Production never needs
 * it: the last device to close a bus removes it, so the map empties itself.
 */
// fallow-ignore-next-line unused-export -- test-only reset for a process-wide registry, in the shape of `resetClampReports`; test files aren't traced as consumers
export function resetBuses(): void {
  buses.clear();
}

/** What makes two connections the same wire. The unit id deliberately does not. */
function busKey(conn: InverterConnection): string {
  return `${conn.transport ?? "tcp"}://${conn.host}:${conn.port}`;
}

function busFor(conn: InverterConnection): Bus {
  const key = busKey(conn);
  const existing = buses.get(key);
  if (existing) return existing;
  const bus: Bus = { client: null, connecting: null, lock: Promise.resolve(), holders: 0 };
  buses.set(key, bus);
  return bus;
}

/** Modbus-TCP transport for a register-mapped device described by a profile. */
export class ModbusTransport implements DeviceTransport {
  readonly kind = "modbus";
  /** Registers are polled and (for `rw` word metrics) written. */
  readonly caps = { canWrite: true, pushBased: false };

  private readonly profile: InverterProfile;
  private readonly conn: InverterConnection;
  private readonly blocks: ReadBlock[];
  /**
   * An atomic group is being read as separate transactions, so this device's
   * samples do not come from one snapshot. Set at construction for a group too
   * wide to ever share a transaction, and at read time when the device rejects
   * the spanning block. Sticky either way, because the split is: the plan is
   * rewritten permanently, and every later poll inherits the skew even though it
   * raises no exception of its own.
   */
  private degraded = false;
  /**
   * The wire this device is on, shared with every other device on the same
   * host/port/framing. Holds the socket and the lock that serializes every
   * transaction across all of them: modbus-serial allows one in-flight request
   * per connection, so a write must never overlap a poll — a device's own or
   * its neighbour's, since the interleaved responses would mismatch and time
   * out either way.
   */
  private joined: Bus | null = null;
  /** Whether this transport still counts against {@link Bus.holders}. */
  private holding = false;

  constructor(profile: InverterProfile, conn: InverterConnection) {
    this.profile = profile;
    this.conn = conn;
    this.blocks = planReads(profile.metrics);
    this.degraded = hasUnplannableGroup(profile.metrics);
    log.info(
      `modbus read plan for ${profile.id}: ` +
        this.blocks.map((b) => `${b.start}+${b.count}${b.grouped ? " (atomic)" : ""}`).join(", "),
    );
  }

  /**
   * Run a Modbus transaction with exclusive access to the wire, addressed to
   * this device.
   *
   * The unit id is set inside the lock, immediately before the request: the
   * client carries one at a time, so setting it at connect time would have the
   * second device on a shared gateway reading the first's registers.
   */
  private locked<T>(op: () => Promise<T>): Promise<T> {
    const bus = this.join();
    const run = async () => {
      bus.client?.setID(this.conn.unitId);
      return op();
    };
    const result = bus.lock.then(run, run);
    // Keep the chain alive on failure without leaking the rejection.
    bus.lock = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /**
   * The bus this transport is on, joining the current one for its connection if
   * it has not already.
   *
   * Resolved on first use rather than at construction, because a bus captured in
   * the constructor can be evicted before the transport ever reads — the source
   * rebuild builds the replacement and only then closes the previous one — and
   * the transport would then revive an orphan, ending up on a second socket to
   * the same gateway with a second, independent lock. Claiming the share here
   * also means a transport that is built and never read holds nothing open.
   */
  private join(): Bus {
    if (this.joined) return this.joined;
    const bus = busFor(this.conn);
    this.joined = bus;
    this.holding = true;
    bus.holders += 1;
    return bus;
  }

  private async getClient(): Promise<ModbusRTU> {
    const bus = this.join();
    if (bus.client?.isOpen) return bus.client;
    if (bus.connecting) return bus.connecting;
    bus.connecting = (async () => {
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
        bus.connecting = null;
        throw err;
      }
      next.setTimeout(timeout);
      bus.client = next;
      bus.connecting = null;
      return next;
    })();
    return bus.connecting;
  }

  /** Open the socket (idempotent); reads and writes do this for themselves. */
  async connect(): Promise<void> {
    await this.getClient();
  }

  /**
   * Read every register in the plan and decode the metrics bound to them.
   * Derived (compute) and composite (control) metrics are not this layer's
   * business — they own no register.
   */
  async read(): Promise<{ values: MetricValues; degraded?: boolean }> {
    const client = await this.getClient();
    const started = performance.now();
    const regs = await this.locked(() => this.readBlocks(client));
    log.debug("read {registers} registers in {blocks} blocks ({ms} ms)", {
      registers: regs.size,
      blocks: this.blocks.length,
      ms: Math.round(performance.now() - started),
    });

    const values: MetricValues = {};
    for (const def of this.profile.metrics) {
      if (def.binding.via !== "modbus") continue;
      const value = decode(def, regs);
      if (value !== undefined) values[def.key] = value;
    }
    // No `readAt`: one block read stamps a whole span of registers, so there is
    // no honest per-metric read time to report here. It exists on the interface
    // for push transports, where each key genuinely arrives on its own.
    // `degraded` is reported only once it is true, so a healthy sample keeps the
    // shape it had before the flag existed.
    return this.degraded ? { values, degraded: true } : { values };
  }

  /** Every planned block, in order, into one address → word map. */
  private async readBlocks(client: ModbusRTU): Promise<Map<number, number>> {
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
        // The warning above is no longer the only record: every sample from here
        // on is assembled from transactions milliseconds apart, and says so.
        this.degraded = true;
        for (const sub of subBlocks) {
          const { data } = await client.readHoldingRegisters(sub.start, sub.count);
          data.forEach((word, i) => acc.set(sub.start + i, word));
        }
      }
    }
    return acc;
  }

  async write(key: string, value: number): Promise<void> {
    const def = this.profile.metrics.find((m) => m.key === key);
    if (!def) throw new Error(`unknown metric: ${key}`);
    if (def.access !== "rw") throw new Error(`metric is read-only: ${key}`);
    const register = writableRegister(def);
    if (register === undefined) {
      throw new Error(`metric is not a single-word writable register: ${key}`);
    }
    const client = await this.getClient();
    // Use FC16 (Write Multiple Registers) even for this single word: Deye/Sunsynk
    // inverters silently ignore FC6 (Write Single Register) on their settings
    // registers — the request gets no reply and the transaction times out.
    const word = encodeWord(def, value);
    await this.locked(() => client.writeRegisters(register, [word]));
    // Info, not debug: writes are rare, user-initiated register changes, and
    // this is the one choke point every entry path (API, MQTT, composite
    // controls) funnels through.
    log.info("write {key}={value} (register {register} <- {word})", {
      key,
      value,
      register,
      word,
    });
  }

  /**
   * Release this device's share of the wire, and close the socket if it was the
   * last one holding it.
   *
   * Refcounted rather than unconditional: the socket belongs to the bus, not to
   * whichever device happened to open it, and closing it while a neighbour is
   * mid-poll would drop that device's readings. Idempotent — a second close
   * releases nothing, so it cannot take someone else's share with it.
   */
  async close(): Promise<void> {
    const bus = this.joined;
    if (!this.holding || !bus) return;
    this.holding = false;
    this.joined = null;
    bus.holders -= 1;
    if (bus.holders > 0) return;
    const { client } = bus;
    await new Promise<void>((resolve) => {
      if (client?.isOpen) client.close(() => resolve());
      else resolve();
    });
    bus.client = null;
    bus.connecting = null;
    // By identity, not by key: a late close from the holder of an already-
    // evicted bus would otherwise remove whichever live bus now sits at that
    // key, orphan it in turn, and fork the wire all over again.
    const key = busKey(this.conn);
    if (buses.get(key) === bus) buses.delete(key);
  }
}
