<!-- Test harness: a push over three levels, a → b → c, each a level below the one before; `nested` pushes inside b. -->
<script lang="ts">
  import "../../../app.css";
  import DrillPush from "./drill-push.svelte";

  let {
    at = "a",
    inner = "x",
    nested = false,
  }: { at?: string; inner?: string; nested?: boolean } = $props();

  const UP = new Map([
    ["b", "a"],
    ["c", "b"],
  ]);
</script>

<div style:width="390px">
  <DrillPush
    {at}
    depth={["a", "b", "c"].indexOf(at)}
    up={UP.get(at) ?? null}
    onback={() => {
      at = UP.get(at) ?? at;
    }}
  >
    {#snippet children(key)}
      <div data-level={key} class="h-40">
        <p>Ebene {key}</p>
        {#if nested && key === "b"}
          <DrillPush
            at={inner}
            depth={inner === "x" ? 0 : 1}
            up={inner === "x" ? null : "x"}
            onback={() => {
              inner = "x";
            }}
          >
            {#snippet children(sub)}<p data-level={sub}>Innen {sub}</p>{/snippet}
          </DrillPush>
        {/if}
      </div>
    {/snippet}
  </DrillPush>
</div>
