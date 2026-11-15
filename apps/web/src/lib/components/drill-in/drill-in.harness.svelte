<!-- Test harness: the drill-in on a stand-in hash route kept in the real browser history. -->
<script lang="ts">
  import "../../../app.css";
  import DrillIn from "./drill-in.svelte";

  let {
    initial = null,
    width = 400,
    back = "Steuerung",
    wide = false,
    tall = false,
  }: {
    initial?: string | null;
    width?: number;
    back?: string;
    /** Pages hold content wider than the box, such as a table. */
    wide?: boolean;
    /** Both levels are taller than the screen. */
    tall?: boolean;
  } = $props();

  // The harness starts on `initial`, then owns the route as the app's history would.
  // svelte-ignore state_referenced_locally
  let open = $state<string | null>(initial);

  // A root entry to go back to, also under a deep link.
  history.pushState({ drill: null }, "");

  // Only the starting route is pushed, as a reload onto it would.
  // svelte-ignore state_referenced_locally
  if (initial !== null) history.pushState({ drill: initial }, "");

  // svelte-ignore state_referenced_locally
  const groups = [
    { id: "battery", label: "Batterie", summary: "20–100 % · 120 A" },
    { id: "grid", label: "Netz & Einspeisung", summary: "10.000 W" },
    { id: "long", label: "Benachrichtigungen & Zugangsberechtigungen" },
    ...(tall ? Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, label: `Gruppe ${i}` })) : []),
  ];

  function navigate(id: string | null): void {
    if (id === null) history.back();
    else {
      history.pushState({ drill: id }, "");
      open = id;
    }
  }
</script>

<svelte:window onpopstate={(e) => (open = (e.state as { drill?: string } | null)?.drill ?? null)} />

<div style:width="{width}px">
  <DrillIn {groups} {open} onnavigate={navigate} {back}>
    {#snippet page(group)}
      <div class="drill-card">
        <p>Seite {group.label}</p>
        {#if wide}<div style="width: 900px">breit</div>{/if}
        {#if tall}<div style="height: 1600px">lang</div>{/if}
      </div>
    {/snippet}
  </DrillIn>
</div>
