<script lang="ts">
  import type { PointDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";

  let {
    point,
    number,
    earlier,
    onchange,
    onremove,
  }: {
    point: PointDraft;
    /** Counted from 1, the root first. */
    number: number;
    /** The points before it: only one of them may be its parent, so parents stay first. */
    earlier: readonly PointDraft[];
    onchange: (change: Readonly<Partial<PointDraft>>) => void;
    onremove: () => void;
  } = $props();
</script>

<li>
  <label>
    {m.topology_name({ number })}
    <input
      required
      value={point.name}
      oninput={(event) => {
        onchange({ name: event.currentTarget.value });
      }}
    />
  </label>
  {#if number > 1}
    <label>
      {m.topology_parent({ number })}
      <select
        value={point.parent}
        onchange={(event) => {
          onchange({ parent: Number(event.currentTarget.value) });
        }}
      >
        {#each earlier as parent, at (at)}
          <option value={at}>{parent.name}</option>
        {/each}
      </select>
    </label>
    <button type="button" onclick={onremove}>{m.topology_remove({ number })}</button>
  {/if}
</li>
