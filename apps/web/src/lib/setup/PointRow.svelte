<!-- One measurement point: its tile, name and device, and its live power with what it means. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import PowerNumber from "../components/power-number.svelte";
  import { STATES } from "../flow/node-words.ts";
  import { m } from "../paraglide/messages.js";
  import { accentOf, stateOf } from "./point-look.ts";
  import PointTile from "./PointTile.svelte";

  let {
    name,
    role,
    note,
    watts,
    onedit,
  }: {
    name: string;
    role: string;
    /** The devices it reads from. */
    note: string;
    /** Its power now; undefined while it is not read. */
    watts: number | undefined;
    /** Set while the tree is adjusted: the row opens the point's sheet. */
    onedit?: (() => void) | undefined;
  } = $props();

  const state = $derived(stateOf(role, watts));

  const active = $derived(state !== undefined && state !== "idle");
</script>

{#snippet body()}
  <PointTile {role} {active} />
  <span class="flex min-w-0 flex-1 flex-col text-left">
    <span class="truncate text-[15px] font-medium">{name}</span>
    <span class="truncate text-xs text-muted-foreground">{note}</span>
  </span>
  <span class="flex shrink-0 flex-col items-end leading-tight">
    <span class="text-[15px] font-semibold whitespace-nowrap">
      <PowerNumber
        watts={watts === undefined ? null : Math.abs(watts)}
        unitClass="text-xs font-normal text-muted-foreground"
      />
    </span>
    <span
      class="text-xs whitespace-nowrap"
      style:color={active ? accentOf(role) : "var(--muted-foreground)"}
      >{state === undefined ? " " : STATES[state]()}</span
    >
  </span>
{/snippet}

{#if onedit === undefined}
  <div class="flex min-h-14 items-center gap-3 px-4 py-2">{@render body()}</div>
{:else}
  <Pressable
    class="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 outline-none hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] active:bg-foreground/[0.06]"
    aria-label={m.topology_edit({ name })}
    onclick={onedit}
  >
    {@render body()}
    <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </Pressable>
{/if}
