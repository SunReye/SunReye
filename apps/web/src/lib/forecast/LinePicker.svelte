<!--
  The forecast line an inverter's chart shows, picked inverter first, then MPPT input, then string
  (ADR 17): the total, then each input's group with the whole input and its strings. Estimated
  strings carry "≈", explained once at the menu's foot.
-->
<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { buttonVariants } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { lineName, type Line } from "./forecast.ts";

  let {
    lines,
    value,
    onpick,
  }: { lines: readonly Line[]; value: string; onpick: (series: string) => void } = $props();

  const chosen = $derived(lines.find((l) => l.series === value) ?? lines[0]!);
  const total = $derived(lines.filter((l) => l.kind === "total"));

  const inputs = $derived(
    lines
      .filter((l) => l.kind === "input")
      .map((input) => ({
        input,
        strings: lines.filter((l) => l.kind === "string" && l.input === input.input),
      })),
  );

  const estimates = $derived(lines.some((l) => l.estimated));

  const id = $props.id();
</script>

{#snippet item(l: Line, label: string)}
  <DropdownMenu.RadioItem value={l.series} closeOnSelect class={[l.kind === "string" && "pl-5"]}>
    <span class="truncate">{label}</span>
  </DropdownMenu.RadioItem>
{/snippet}

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={buttonVariants({
      variant: "outline",
      size: "sm",
      class: "max-w-[60%] shrink-0 gap-1 px-2.5 text-xs",
    })}
  >
    <span class="truncate">{lineName(chosen)}</span>
    <ChevronDown class="size-3.5 shrink-0 opacity-70" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-60 max-w-[calc(100vw-2rem)]">
    <DropdownMenu.RadioGroup
      aria-label={m.forecast_line()}
      bind:value={
        () => value,
        (v: string) => {
          if (!v || v === value) return;
          haptics.selection();
          onpick(v);
        }
      }
    >
      {#each total as l (l.series)}
        {@render item(l, l.label)}
      {/each}
      {#each inputs as group (group.input.series)}
        <DropdownMenu.Separator />
        <!-- A GroupHeading would name the radio group around it, not this one. -->
        <DropdownMenu.Group aria-labelledby="{id}-{group.input.input}">
          <DropdownMenu.Label id="{id}-{group.input.input}">{group.input.label}</DropdownMenu.Label>
          {@render item(group.input, m.forecast_input_total())}
          {#each group.strings as l (l.series)}
            {@render item(l, l.estimated ? `${l.label} ≈` : l.label)}
          {/each}
        </DropdownMenu.Group>
      {/each}
    </DropdownMenu.RadioGroup>
    {#if estimates}
      <DropdownMenu.Separator />
      <p class="px-2 py-1.5 text-xs text-pretty text-muted-foreground">
        {m.forecast_estimated_note()}
      </p>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
