<!--
  Everything the scene can add, on a phone (ADR 20): the inspector groups' add buttons gathered in
  one bottom sheet, the More sheet's look. A tap adds the object and opens it in the inspector.
-->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import Plus from "@lucide/svelte/icons/plus";
  import ResponsiveSheet from "../components/responsive-sheet.svelte";
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";
  import { additions, type Addition } from "./additions.ts";
  import type { Section } from "./levels.ts";
  import { SECTIONS, type Plan } from "./outline.ts";

  let {
    open = $bindable(false),
    plan,
    moduleType,
    onadd,
  }: {
    open?: boolean;
    plan: Plan;
    /** A new string's, when no grid names one. */
    moduleType: number | undefined;
    onadd: (addition: Addition) => void;
  } = $props();

  /** Modules are laid on a face's own level, so they have no row here. */
  const GROUPS: readonly Section[] = ["buildings", "surroundings", "equipment", "strings"];

  const groups = $derived(
    GROUPS.flatMap((section) => {
      const adds = additions(section, plan, moduleType);

      return adds.length > 0 ? [{ section, adds }] : [];
    }),
  );
</script>

<!-- Over the 3D canvas: the sheet and its groups are canvas chips, without blur (ADR 21). -->
<ResponsiveSheet bind:open label={m.builder_add()} class="canvas-chip">
  <div
    class="flex min-h-0 touch-pan-y flex-col gap-3 overflow-y-auto px-4 pt-1 pb-2 scroll-fade-y no-scrollbar"
    data-vaul-no-drag
  >
    <h2 class="px-1 text-lg font-semibold">{m.builder_add()}</h2>
    {#each groups as { section, adds } (section)}
      <section aria-labelledby="add-{section}" class="flex flex-col gap-1.5">
        <h3 id="add-{section}" class="px-1 text-xs font-medium text-muted-foreground">
          {SECTIONS[section]()}
        </h3>
        <Item.Group
          class="canvas-chip gap-0 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60"
        >
          {#each adds as add (add.label)}
            <Item.Root class="rounded-none border-0">
              {#snippet child({ props })}
                <Pressable
                  {...props}
                  class={[props.class, "min-h-11 text-left"]}
                  onclick={() => {
                    onadd(add);
                  }}
                >
                  <Item.Media variant="icon"><Plus /></Item.Media>
                  <Item.Content
                    ><Item.Title class="text-[15px]">{add.label}</Item.Title></Item.Content
                  >
                </Pressable>
              {/snippet}
            </Item.Root>
          {/each}
        </Item.Group>
      </section>
    {/each}
  </div>
</ResponsiveSheet>
