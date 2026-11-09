const wasmPath = new URL(
  "../../../target/wasm32-unknown-unknown/release/sunreye_profile_wasm.wasm",
  import.meta.url,
);

export interface ProfileWasm {
  schema(): number;
}

export async function loadProfileWasm(): Promise<ProfileWasm> {
  const bytes = await Bun.file(wasmPath).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes);
  const { schema } = instance.exports;
  if (!(schema instanceof Function)) {
    throw new TypeError("profile WASM lacks the schema export");
  }
  return { schema: () => Number(schema()) };
}
