// The engine in the browser: the pv crate's build as @sunreye/pv-wasm ships it (ADR 25).
import { loadPv, type Pv } from "@sunreye/pv-wasm";
import wasm from "@sunreye/pv-wasm/pv.wasm?url";

/** Fetches the engine and instantiates it. */
export async function fetchPv(): Promise<Pv> {
  const response = await fetch(wasm);

  return loadPv(new Uint8Array(await response.arrayBuffer()));
}
