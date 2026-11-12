<!--
  Behind every page: only the sun-tinted spotlight under the glass (ADR 21). Without the plant's
  location (unset, or a viewer, who cannot read it) it stays indigo.
-->
<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import type { PvModel } from "../api/model.ts";
  import { watchTint } from "./spotlight.ts";

  let { core }: { core: Pick<PvModel, "location"> } = $props();

  $effect(() => {
    const root = document.documentElement;
    let stop: (() => void) | undefined;
    let live = true;

    void (async () => {
      const location = await core.location();

      if ("problem" in location) return;

      const { loadPv } = await import("../builder/pv.ts");
      const pv = await loadPv(new Uint8Array(await (await fetch(wasm)).arrayBuffer()));

      if (!live) return;

      stop = watchTint({
        elevation: (unix) => 90 - pv.sun(unix, location).zenith,
        set: (tint) => {
          root.dataset["tod"] = tint;
        },
      });
    })();

    return () => {
      live = false;
      stop?.();
      delete root.dataset["tod"];
    };
  });
</script>

<div class="pointer-events-none fixed inset-0 -z-10 bg-background" aria-hidden="true">
  <div class="absolute inset-0 bg-spotlight"></div>
</div>
