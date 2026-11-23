<!--
  The module catalogue in the face's level (ADR 17): search, then each maker's series with the
  datasheets they were copied from and a row per power class. Picking one adds it as a module type;
  a refusal shows above the list and the search stays.
-->
<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import { modules } from "@sunreye/catalogue";
  import { Button } from "@sunreye/ui/button";
  import { Input } from "@sunreye/ui/input";
  import type { Core, Datasheet, ModuleType, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal, { answered } from "../setup/Refusal.svelte";
  import CatalogueList from "./CatalogueList.svelte";

  let {
    types,
    onadded,
    oncancel,
  }: {
    types: Pick<Core, "addModuleType">;
    onadded: (added: ModuleType) => void;
    oncancel: () => void;
  } = $props();

  let refused = $state.raw<Problem>();
  let query = $state("");
  let adding = $state(false);

  async function pick(datasheet: Readonly<Datasheet>): Promise<void> {
    adding = true;

    const answer = await types.addModuleType(datasheet);

    adding = false;

    if ("problem" in answer) refused = answered(answer);
    else onadded(answer);
  }
</script>

<div class="px-4 pt-3 pb-1">
  <div class="relative">
    <Search
      class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      type="search"
      autocomplete="off"
      enterkeyhint="search"
      aria-label={m.builder_module_search()}
      placeholder={m.builder_module_search()}
      class="pl-8"
      bind:value={query}
    />
  </div>
</div>

{#if refused !== undefined}
  <div class="px-4 pt-2"><Refusal {refused} /></div>
{/if}

<CatalogueList
  sheets={modules}
  {query}
  {adding}
  onpick={(datasheet) => {
    void pick(datasheet);
  }}
/>

<div class="flex flex-col gap-2 border-t border-border/60 p-3">
  <Button type="button" variant="ghost" onclick={oncancel}>{m.builder_cancel()}</Button>
</div>
