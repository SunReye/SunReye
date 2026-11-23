<!-- The builder's frame on the same house, its writes kept in memory. -->
<script lang="ts">
  import {
    Builder,
    BUILDER_SIZE,
    emptyDraft,
    type Host,
    type Keeper,
  } from "@sunreye/builder/frame";
  import { fetchPv } from "@sunreye/builder/canvas";
  import { MODULE, scene } from "#lib/house.ts";

  const core: Keeper = {
    changeLayout: async ({ appliesFrom, scene: saved }) => ({
      appliesFrom,
      scene: saved,
      strings: [],
      warnings: [],
    }),
    addModuleType: async (datasheet) => ({ ...datasheet, id: MODULE.id + 1 }),
  };

  const host: Host = {
    refusal: (code) => code,
    confirmed: () => {},
    uploadCarBody: async () => ({ problem: "car.unsupported" }),
  };
</script>

<main class={BUILDER_SIZE}>
  {#await fetchPv() then pv}
    <Builder
      {pv}
      {core}
      {host}
      start={{ ...emptyDraft(), scene }}
      moduleTypes={[MODULE]}
      devices={[]}
    />
  {/await}
</main>
