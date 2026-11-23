<!-- A face's module types to lay its grid with, the module catalogue and "Neuer Modultyp" (ADR 17, 20). -->
<script lang="ts">
  import Library from "@lucide/svelte/icons/library";
  import Plus from "@lucide/svelte/icons/plus";
  import * as Item from "@sunreye/ui/item";
  import DrillRow from "../components/drill-in/drill-row.svelte";
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { summary } from "./datasheet.ts";

  let {
    moduleTypes,
    onpick,
    oncatalogue,
    onnew,
  }: {
    moduleTypes: readonly Readonly<ModuleType>[];
    onpick: (moduleType: number) => void;
    oncatalogue: () => void;
    onnew: () => void;
  } = $props();

  const uid = $props.id();
</script>

<h3 id="{uid}-types" class="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
  {m.builder_face_module_type()}
</h3>
{#if moduleTypes.length === 0}
  <p class="px-4 pb-2 text-sm text-muted-foreground">{m.builder_no_module_type_yet()}</p>
{/if}
<Item.Group aria-labelledby="{uid}-types" class="gap-0 divide-y divide-border/60">
  {#each moduleTypes as type (type.id)}
    <DrillRow
      group={{ id: String(type.id), label: type.name, summary: summary(type) }}
      onclick={() => {
        onpick(type.id);
      }}
    />
  {/each}
  <DrillRow
    group={{
      id: "catalogue",
      label: m.builder_module_catalogue(),
      summary: m.builder_module_catalogue_hint(),
      icon: Library,
    }}
    onclick={oncatalogue}
  />
  <DrillRow group={{ id: "new", label: m.builder_new_module_type(), icon: Plus }} onclick={onnew} />
</Item.Group>
