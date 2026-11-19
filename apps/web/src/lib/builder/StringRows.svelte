<!-- The Strings group's rows (ADR 20): each inverter, its MPPT inputs and the strings on each, every
  warning beside what it judges. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { Plan } from "./outline.ts";
  import InputGroup from "./InputGroup.svelte";
  import { stringTree } from "./string-tree.ts";

  let { plan, onpick }: { plan: Plan; onpick: (string: number) => void } = $props();

  const uid = $props.id();

  const draft = $derived(plan.draft);

  const tree = $derived(
    stringTree({
      strings: draft.strings,
      devices: plan.devices,
      inputs: plan.inputs,
      warnings: [...plan.cold, ...plan.sized],
    }),
  );
</script>

{#each tree as inverter (inverter.device)}
  <div role="group" aria-labelledby="{uid}-{inverter.device}" class="border-b border-border/60">
    <h3 id="{uid}-{inverter.device}" class="px-4 pt-3 pb-1 text-[15px] font-semibold">
      {inverter.name}
    </h3>
    {#each inverter.inputs as input (input.input)}
      <InputGroup {input} {draft} {onpick} />
    {/each}
  </div>
{/each}
