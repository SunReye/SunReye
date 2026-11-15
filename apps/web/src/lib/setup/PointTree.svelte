<!--
  The measurement-point tree (ADR 14) in reading order: each point under its parent, indented one
  tile's width with a guide line down from the parent's tile, and each parent's unmeasured remainder.
-->
<script lang="ts">
  import type { Device, PointDraft, Values } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { roleOf } from "./point-look.ts";
  import PointRow from "./PointRow.svelte";
  import { identity, lines, reading, type Line } from "./topology.ts";
  import Unmeasured from "./Unmeasured.svelte";

  let {
    points,
    values,
    devices,
    onedit,
  }: {
    points: readonly PointDraft[];
    values: Values;
    devices: readonly Device[];
    /** Set while the tree is adjusted: a tap on a point opens it. */
    onedit?: ((index: number) => void) | undefined;
  } = $props();

  /** One step in: a tile (36 px) and its gap. */
  const STEP = 35;

  /** The devices a point reads from, each once. */
  function note({ claims }: PointDraft): string {
    const names = claims.map(({ device }) => devices.find(({ id }) => id === device)?.name);

    return [...new Set(names)].filter((name) => name !== undefined).join(", ");
  }

  function keyOf(line: Line): string {
    return "of" in line ? `rest ${identity(points[line.of])}` : identity(points[line.index]);
  }
</script>

{#snippet guides(depth: number)}
  {#each { length: depth }, level (level)}
    <span
      class="absolute inset-y-0 border-s border-border/60"
      style:left="{34 + level * STEP}px"
      aria-hidden="true"
    ></span>
  {/each}
{/snippet}

<ul aria-label={m.topology_title()}>
  {#each lines(points, values) as line (keyOf(line))}
    {@const point = "of" in line ? undefined : points[line.index]}
    <li
      class="relative"
      style:padding-left="{line.depth * STEP}px"
      aria-label={point?.name ?? m.topology_unmeasured()}
    >
      {@render guides(line.depth)}
      {#if "of" in line}
        <Unmeasured watts={line.rest} />
      {:else if point !== undefined}
        <PointRow
          name={point.name}
          role={roleOf(point)}
          note={note(point)}
          watts={reading(point, values)}
          onedit={onedit === undefined ? undefined : () => onedit(line.index)}
        />
      {/if}
    </li>
  {/each}
</ul>
