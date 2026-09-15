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
import { errorMessage } from "./error-message";
import { SolarmanV5Port } from "./solarman";
import type { InverterTransport } from "./transports";
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
  /**
   * Two or more otherwise-separate blocks that were folded into one across the
   * unmapped registers between them, because a round trip on this framing costs
   * far more than the wasted registers do (see {@link GAP_TOLERANCE}).
   *
   * Recorded rather than inferred because it decides recoverability: a merged
   * block is the only PLAIN block that can legitimately be refused with Modbus
   * exception 2, and {@link ModbusTransport} splits it back apart instead of
   * failing the poll. An unmerged plain block has no unmapped register to blame,
   * so exception 2 on one is a real fault and still propagates.
   */
  merged?: boolean;
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

/**
 * How many unmapped registers it is worth reading to save one round trip, per
 * framing. Zero means "split on every gap" — literally today's planner, so the
 * two socket framings are untouched by any of this.
 *
 * `solarman-v5` is the outlier the number exists for. The Solarman stick is not
 * a gateway; it takes the whole Modbus RTU frame, relays it to the inverter over
 * the internal serial link, waits, and relays the answer back inside its own
 * envelope. That fixed relay cost dwarfs the per-register cost, which is why a
 * plan reading MORE registers in FEWER transactions is faster.
 *
 * Measured end to end on the stick at 10.20.0.63 (Deye SG05LP3 behind it), each
 * plan twice under a busy stick and twice under an idle one:
 *
 * |  plan                       | reads | registers | busy        | idle      |
 * |-----------------------------|-------|-----------|-------------|-----------|
 * | split on every gap          |    15 |       153 | 3268/3119ms | 1456/1430 |
 * | gap-merged (98/500/586)     |     3 |       227 | 1010/1107ms |  691/950  |
 *
 * Fit `total = perRead * reads + perRegister * registers` to each pair:
 *
 * - busy: 199 ms per read, 1.82 ms per register
 * - idle:  78 ms per read, 2.04 ms per register
 *
 * A gap pays for itself while `gap * perRegister < perRead`, i.e. up to ~109
 * registers busy and ~38 registers idle. The idle figure is the one that binds,
 * because it is the cheapest a round trip is ever observed to be — choose a
 * tolerance below it and the merge is profitable in every condition measured.
 *
 * 32 is that number, and it is not rounded to a decade on purpose:
 *
 * - it is comfortably under the ~38-register idle break-even, so no merge it
 *   makes can ever be a net loss on this hardware;
 * - it is comfortably over 18, the widest gap the real `deye-sg05lp3` plan
 *   actually needs merged (110→128), so the whole win is taken;
 * - it stops at 33 — the gap from 553 to 586 — which is exactly where the
 *   profile's three natural register regions are, so the plan collapses to the
 *   three blocks measured above and not to one enormous read of 580 registers
 *   that would spend ~1.2 s of register time to save two round trips.
 *
 * It is a per-framing constant rather than a per-profile one because it is a
 * property of the LINK, not of the register map: the same profile behind a local
 * RS485 gateway wants zero.
 */
const GAP_TOLERANCE: Record<InverterTransport, number> = {
  tcp: 0,
  "rtu-over-tcp": 0,
  "solarman-v5": 32,
};

/** See {@link GAP_TOLERANCE}. Exported so the choice is testable on its own. */
export function gapToleranceFor(framing: InverterTransport): number {
  return GAP_TOLERANCE[framing];
}

/**
 * Whether `next` may be folded into `last`.
 *
 * `tolerance === 0` short-circuits to `false` for every pair, which is what
 * makes tolerance zero byte-identical to the planner before gap merging existed.
 */
function mergeable(last: ReadBlock, next: ReadBlock, tolerance: number): boolean {
  if (tolerance === 0) return false;
  const gap = next.start - (last.start + last.count);
  const span = next.start + next.count - last.start;
  return gap <= tolerance && span <= MAX_BLOCK;
}

/**
 * Fold neighbouring blocks (given ascending and disjoint) across gaps no wider
 * than `tolerance`, still respecting {@link MAX_BLOCK}.
 *
 * A merge always swallows its neighbour WHOLE, so an atomic group's spanning
 * block survives intact inside the result and its registers still share one
 * transaction. That is why merging into a `grouped` block is safe and the flag
 * is carried over rather than dropped.
 */
function mergeAcrossGaps(blocks: ReadBlock[], tolerance: number): ReadBlock[] {
  const out: ReadBlock[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (last && mergeable(last, block, tolerance)) {
      last.count = block.start + block.count - last.start;
      last.merged = true;
      if (block.grouped) last.grouped = true;
    } else {
      out.push({ ...block });
    }
  }
  return out;
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
 * `gapTolerance` then folds neighbouring blocks back together across gaps no
 * wider than it, because on some framings a round trip costs far more than the
 * unmapped registers it saves reading — see {@link GAP_TOLERANCE}. It defaults
 * to 0, which is "split on every gap" and leaves the plan exactly as it was
 * before gap merging existed.
 *
 * Caveats: a spanning block also reads the unmapped registers between its
 * inputs — devices that reject that (Modbus exception 2) are detected at read
 * time and the block falls back to plain split reads. The same fallback is what
 * makes a merge across a gap safe to attempt at all: a device that refuses the
 * wider range narrows it back, once, and remembers. Inputs further apart than
 * {@link MAX_BLOCK} registers can never share a transaction, so those computed
 * metrics keep the transient-skew behavior.
 */
export function planReads(metrics: MetricDef[], gapTolerance = 0): ReadBlock[] {
  const groups = resolveAtomicGroups(metrics);
  const covered = (a: number) => groups.some((g) => a >= g.start && a < g.start + g.count);
  const rest = [...readableAddresses(metrics)].filter((a) => !covered(a)).sort((a, b) => a - b);
  const plan = [...groups, ...splitIntoBlocks(rest)].sort((a, b) => a.start - b.start);
  return mergeAcrossGaps(plan, gapTolerance);
}

/**
 * Re-plan a spanning block into the plain gap-split blocks of the profile
 * addresses it covers — the fallback when a device rejects reading the unmapped
 * registers inside the span, whether the span came from an atomic compute group
 * or from gap merging.
 *
 * Always at tolerance 0: re-merging would hand the device back a range it has
 * just refused, and the poll would never recover.
 *
 * @internal
 */
export function splitBlock(block: ReadBlock, metrics: MetricDef[]): ReadBlock[] {
  const addrs = [...readableAddresses(metrics)]
    .filter((a) => a >= block.start && a < block.start + block.count)
    .sort((a, b) => a - b);
  return splitIntoBlocks(addrs);
}

/**
 * A client that has been told where to dial, and the promise that settles when
 * it is actually connected.
 */
interface Dialed {
  client: ModbusRTU;
  /** Carries NO deadline of its own — {@link ModbusTransport} races it. */
  connected: Promise<unknown>;
  /** Present only for the Solarman framing, which discovers a logger serial. */
  solarman?: SolarmanV5Port;
}

/**
 * Build a client for one framing.
 *
 * Extracted from `getClient` so the three framings sit in one exhaustive
 * `switch` with a `never` on the default arm: a fourth framing added to
 * {@link InverterTransport} then fails to compile here instead of silently
 * falling through to plain Modbus TCP and timing out on a customer's roof.
 */
/**
 * Make a client's `"error"` event survivable.
 *
 * `ModbusRTU` is an `EventEmitter` and re-emits any port error on itself
 * (`modbus-serial/index.js:629`). An `EventEmitter` with no `"error"` listener
 * THROWS, and the server installs no `uncaughtException` handler, so a link-level
 * error on any framing would end the process rather than a poll. The port-level
 * fix (`v5-port.ts` never emits a bare `"error"` once open) is the real one; this
 * is the belt to its braces, and it covers the two socket framings too, whose
 * behaviour here depends on a third party's internals.
 *
 * Nothing recovers here on purpose: `getClient()` already rebuilds a client once
 * `isOpen` goes false, so this only has to keep the error from being fatal and
 * keep it in the log.
 */
function absorbClientErrors(client: ModbusRTU, conn: InverterConnection): void {
  client.on("error", (err: unknown) => {
    log.warn("modbus link error on {host}:{port}: {message}", {
      host: conn.host,
      port: conn.port,
      message: errorMessage(err),
    });
  });
}

function dial(conn: InverterConnection, timeout: number): Dialed {
  const framing = conn.transport ?? "tcp";
  const opts = { port: conn.port };
  switch (framing) {
    case "tcp": {
      const client = new ModbusRTU();
      absorbClientErrors(client, conn);
      return { client, connected: client.connectTCP(conn.host, opts) };
    }
    case "rtu-over-tcp": {
      const client = new ModbusRTU();
      absorbClientErrors(client, conn);
      return { client, connected: client.connectTcpRTUBuffered(conn.host, opts) };
    }
    case "solarman-v5": {
      // A port rather than a shorthand: `ModbusRTU` then keeps owning CRC
      // checking, transaction timeouts and — load-bearing — the exception
      // mapping onto `err.modbusCode` that `isIllegalDataAddress` reads.
      const solarman = new SolarmanV5Port({
        host: conn.host,
        port: conn.port,
        timeoutMs: timeout,
        ...(conn.loggerSerial === undefined ? {} : { loggerSerial: conn.loggerSerial }),
      });
      const client = new ModbusRTU(solarman);
      absorbClientErrors(client, conn);
      return {
        client,
        solarman,
        connected: new Promise<void>((resolve, reject) => {
          client.open((err?: Error) => (err ? reject(err) : resolve()));
        }),
      };
    }
    default: {
      const unreachable: never = framing;
      throw new Error(`unsupported Modbus framing: ${String(unreachable)}`);
    }
  }
}

/**
 * The register a UNIT-ID SCAN asks for: the first one this profile plans to
 * read, or undefined when it plans none.
 *
 * NOT a fixed address, and not register 0. A Modbus device answers nothing at
 * all for a register it does not map, so a scan that asked for an arbitrary one
 * would report "no answer" for the unit id that actually works — measured
 * against a Deye behind a Solarman stick, where register 3 timed out on the same
 * unit id that read 107 metrics from register 98 in 171 ms.
 *
 * One register, not the whole block: the scan asks "is anything home", and a
 * 120-register read costs ~2 ms per register on a stick for an answer the first
 * word already gave.
 */
export function probeAddressOf(profile: InverterProfile): number | undefined {
  return planReads(profile.metrics, 0)[0]?.start;
}

/** Fold one block's response into the poll's address → word map. */
function store(acc: Map<number, number>, block: ReadBlock, res: { data: number[] }): void {
  res.data.forEach((word, i) => acc.set(block.start + i, word));
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

/** Modbus-TCP transport for a register-mapped device described by a profile. */
export class ModbusTransport implements DeviceTransport {
  readonly kind = "modbus";
  /** Registers are polled and (for `rw` word metrics) written. */
  readonly caps = { canWrite: true, pushBased: false };

  private readonly profile: InverterProfile;
  private readonly conn: InverterConnection;
  private readonly blocks: ReadBlock[];
  private client: ModbusRTU | null = null;
  private connecting: Promise<ModbusRTU> | null = null;
  /**
   * An atomic group is being read as separate transactions, so this device's
   * samples do not come from one snapshot. Set at construction for a group too
   * wide to ever share a transaction, and at read time when the device rejects
   * the spanning block. Sticky either way, because the split is: the plan is
   * rewritten permanently, and every later poll inherits the skew even though it
   * raises no exception of its own.
   */
  private degraded = false;
  /** Serializes transactions on the shared client — modbus-serial allows only
   * one in-flight request per connection, so a write must never overlap a
   * concurrent poll read (the interleaved responses would mismatch and time
   * out). */
  private lock: Promise<unknown> = Promise.resolve();
  /**
   * The Solarman logging stick's serial as the stick itself reported it during
   * the last connect — which is not necessarily the one that was configured, and
   * is the only way to learn it for an endpoint that never had one. Undefined for
   * every other framing, and until the first successful connect.
   */
  private discoveredLoggerSerial: number | undefined;

  constructor(profile: InverterProfile, conn: InverterConnection) {
    this.profile = profile;
    this.conn = conn;
    // The tolerance is a property of the link, not of the register map: a stick
    // pays ~78-199 ms per round trip and ~2 ms per register, a socket framing
    // pays neither, and gets 0 — the plan it has always had.
    this.blocks = planReads(profile.metrics, gapToleranceFor(conn.transport ?? "tcp"));
    this.degraded = hasUnplannableGroup(profile.metrics);
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
      const timeout = this.conn.timeoutMs ?? 2000;
      const { client: next, connected: connect, solarman } = dial(this.conn, timeout);
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
      // Only the Solarman framing learns anything during the connect; the other
      // two leave this as it was so a reader never sees a stale serial.
      if (solarman) this.discoveredLoggerSerial = solarman.loggerSerial;
      this.client = next;
      this.connecting = null;
      return next;
    })();
    return this.connecting;
  }

  /** See {@link discoveredLoggerSerial} — reported so the server can show it. */
  get loggerSerial(): number | undefined {
    return this.discoveredLoggerSerial;
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
    // Snapshot: the fallback below splices this.blocks mid-iteration.
    for (const block of this.blocks.slice()) {
      try {
        store(acc, block, await client.readHoldingRegisters(block.start, block.count));
      } catch (err) {
        // Rethrows unless the block is one this transport may narrow, so the
        // retry loop below only ever runs for a span that was refused.
        for (const sub of this.narrow(block, err)) {
          store(acc, sub, await client.readHoldingRegisters(sub.start, sub.count));
        }
      }
    }
    return acc;
  }

  /**
   * Permanently replace a refused spanning block with the plain split blocks of
   * the addresses the profile actually maps, and hand those back to be read.
   *
   * A device may reject a spanning read because it covers unmapped gap registers
   * (Modbus exception 2) — either an atomic compute group's span or a gap-merged
   * block. Anything else, including exception 2 on a block with no unmapped
   * register in it to blame, is a real fault and is rethrown untouched: callers
   * branch their retry/backoff on the original error.
   */
  private narrow(block: ReadBlock, err: unknown): ReadBlock[] {
    if (!(block.grouped || block.merged) || !isIllegalDataAddress(err)) throw err;
    const subBlocks = splitBlock(block, this.profile.metrics);
    // Only an ATOMIC span losing its single transaction is a degraded sample.
    // Un-merging a gap-merged block costs round trips, not coherence: every
    // value in it was already read on its own terms.
    const cost = block.grouped
      ? "computed values may show transient skew on fast power swings"
      : "more round trips per poll";
    if (block.grouped) this.degraded = true;
    log.warn(
      `${this.profile.id}: device rejected read ${block.start}+${block.count}; ` +
        `splitting into ${subBlocks.map((b) => `${b.start}+${b.count}`).join(", ")} — ${cost}`,
    );
    this.blocks.splice(this.blocks.indexOf(block), 1, ...subBlocks);
    return subBlocks;
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
   * Does ONE unit id answer on this endpoint? Used by the unit-id SCAN, never by
   * the poll loop.
   *
   * On the client this transport already holds, deliberately: a scan that dialled
   * per candidate would pay a fresh Solarman handshake each time, and a stick
   * that serialises clients on one RS485 bus would be asked to hold several at
   * once. Measured on a live stick, one client and `setID` per candidate: a hit
   * costs 1-384 ms and a miss costs the full timeout, on every framing — no
   * device and no gateway sends a fast refusal, which is why the caller bounds
   * the candidate list rather than sweeping 1..247.
   *
   * The unit id and timeout are RESTORED before returning, so the transport is
   * left addressing what it was built to address.
   */
  async probeUnit(unitId: number, timeoutMs: number): Promise<boolean> {
    const address = probeAddressOf(this.profile);
    if (address === undefined) {
      throw new Error(`${this.profile.id} maps no readable register to scan with`);
    }
    const client = await this.getClient();
    return this.locked(async () => {
      client.setID(unitId);
      client.setTimeout(timeoutMs);
      try {
        await client.readHoldingRegisters(address, 1);
        return true;
      } catch {
        // Every failure is the same answer here: nothing is home at this id. A
        // timeout, a reject and an exception all mean "ask the next one", and the
        // endpoint's own failures (a dead socket) surface on the next probe's
        // `getClient`, which does throw.
        return false;
      } finally {
        client.setID(this.conn.unitId);
        client.setTimeout(this.conn.timeoutMs ?? 2000);
      }
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
