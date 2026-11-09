const wasmPath = new URL(
  "../../../target/wasm32-unknown-unknown/release/sunreye_profile_wasm.wasm",
  import.meta.url,
);

/** One read request: `count` registers from `start` (crates/profile `Block`). */
export interface Block {
  readonly start: number;
  readonly count: number;
  readonly grouped?: boolean;
  readonly merged?: boolean;
}

export interface ProfileWasm {
  schema(): number;
  /** The read plan of a profile file at a gap tolerance; throws the loader's reason. */
  readPlan(profile: string, gapTolerance: number): Block[];
  /** A spanning block of a profile file as plain blocks; throws the loader's reason. */
  split(profile: string, block: Block): Block[];
}

/** The ABI of crates/profile-wasm: replies are `ptr << 32 | len` of JSON in linear memory. */
interface Exports {
  readonly memory: WebAssembly.Memory;
  readonly schema: () => number;
  readonly reserve: (len: number) => number;
  readonly release: (ptr: number, len: number) => void;
  readonly read_plan: (profile: number, profileLen: number, gapTolerance: number) => bigint;
  readonly split: (profile: number, profileLen: number, block: number, blockLen: number) => bigint;
}

type Reply = { readonly ok: Block[] } | { readonly error: string };

const functions = ["schema", "reserve", "release", "read_plan", "split"] as const;

function isFunctionExport(value: WebAssembly.ExportValue | undefined): boolean {
  return (
    value !== undefined &&
    !(value instanceof WebAssembly.Global) &&
    !(value instanceof WebAssembly.Memory) &&
    !(value instanceof WebAssembly.Table)
  );
}

/** crates/profile-wasm exports its memory and functions with the signatures `Exports` names. */
function isExports(
  exports: Readonly<WebAssembly.Exports>,
): exports is Readonly<WebAssembly.Exports> & Exports {
  return (
    exports["memory"] instanceof WebAssembly.Memory &&
    functions.every((name) => isFunctionExport(exports[name]))
  );
}

function isBlock(value: unknown): value is Block {
  return (
    value instanceof Object &&
    "start" in value &&
    Number.isInteger(value.start) &&
    "count" in value &&
    Number.isInteger(value.count)
  );
}

function isReply(value: unknown): value is Reply {
  if (!(value instanceof Object)) return false;

  if ("error" in value) return String(value.error) === value.error;

  return "ok" in value && Array.isArray(value.ok) && value.ok.every((block) => isBlock(block));
}

function exportsOf(exports: Readonly<WebAssembly.Exports>): Exports {
  if (!isExports(exports)) throw new TypeError("profile WASM lacks an export");

  return exports;
}

/** Copies `text` into a buffer the caller must release. */
function write(wasm: Exports, text: string): readonly [number, number] {
  const encoded = new TextEncoder().encode(text);
  const ptr = wasm.reserve(encoded.length);

  new Uint8Array(wasm.memory.buffer, ptr, encoded.length).set(encoded);

  return [ptr, encoded.length];
}

/** Reads and releases a reply. */
function take(wasm: Exports, packed: bigint): Block[] {
  const ptr = Number(packed >> 32n);
  const len = Number(packed & 0xffff_ffffn);
  const text = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, len));

  wasm.release(ptr, len);

  const reply: unknown = JSON.parse(text);

  if (!isReply(reply)) throw new TypeError(`profile WASM replied ${text}`);

  if ("error" in reply) throw new Error(reply.error);

  return reply.ok;
}

/** Runs one export over `inputs` written to WASM memory, releasing them afterwards. */
function call(
  wasm: Exports,
  inputs: readonly string[],
  run: (buffers: readonly number[]) => bigint,
): Block[] {
  const buffers = inputs.map((input) => write(wasm, input));

  try {
    return take(wasm, run(buffers.flat()));
  } finally {
    for (const [ptr, len] of buffers) wasm.release(ptr, len);
  }
}

export async function loadProfileWasm(): Promise<ProfileWasm> {
  const bytes = await Bun.file(wasmPath).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = exportsOf(instance.exports);

  return {
    schema: () => wasm.schema(),
    readPlan: (profile, gapTolerance) =>
      call(wasm, [profile], ([ptr = 0, len = 0]) => wasm.read_plan(ptr, len, gapTolerance)),
    split: (profile, block) =>
      call(wasm, [profile, JSON.stringify(block)], ([ptr = 0, len = 0, at = 0, size = 0]) =>
        wasm.split(ptr, len, at, size),
      ),
  };
}
