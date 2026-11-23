<!-- One scene twice, from above and in 3D: a roof face selected in one is marked in both. -->
<script lang="ts">
  import { presetView, SceneCanvas, type Preset } from "@sunreye/builder";
  import { fetchPv } from "@sunreye/builder/canvas";
  import { roofFaceKey, type RoofFaceId } from "@sunreye/scene";
  import { scene } from "#lib/house.ts";

  const VIEWS: readonly { preset: Preset; label: string }[] = [
    { preset: "top", label: "Top view" },
    { preset: "isometric", label: "3D view" },
  ];

  let selected = $state<RoofFaceId | null>(null);
  let drawn = $state(0);
</script>

{#await fetchPv() then pv}
  {@const geometry = pv.geometry(scene)}
  {@const roofs = pv.modules(scene, {}).roofs}
  <main class="flex h-screen flex-col gap-4 p-4">
    <p role="status">
      {drawn === VIEWS.length ? "Both views drawn" : "Drawing"} · Selected:
      {selected === null ? "none" : `Block ${selected.block + 1}, face ${selected.face + 1}`}
    </p>
    <div class="grid min-h-0 flex-1 grid-cols-2 gap-4">
      {#each VIEWS as { preset, label } (preset)}
        <SceneCanvas
          {geometry}
          {roofs}
          {label}
          selected={selected === null ? undefined : roofFaceKey(selected)}
          view={presetView(preset, geometry)}
          onview={() => {}}
          onselect={(face) => {
            selected = face;
          }}
          onready={() => {
            drawn += 1;
          }}
        />
      {/each}
    </div>
  </main>
{/await}
