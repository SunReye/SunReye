const wasmPath = new URL(
  "../../../target/wasm32-unknown-unknown/release/sunreye_profile_wasm.wasm",
  import.meta.url,
);

export interface ProfileWasm {
  schema(): number;
}

/** crates/profile-wasm exports only `extern "C" fn() -> u32` functions. */
function isProfileFunction(value: WebAssembly.ExportValue | undefined): value is () => number {
  return (
    value !== undefined &&
    !(value instanceof WebAssembly.Global) &&
    !(value instanceof WebAssembly.Memory) &&
    !(value instanceof WebAssembly.Table)
  );
}

export async function loadProfileWasm(): Promise<ProfileWasm> {
  const bytes = await Bun.file(wasmPath).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes);
  const { schema } = instance.exports;

  if (!isProfileFunction(schema)) throw new TypeError("profile WASM lacks the schema function");

  return { schema };
}
