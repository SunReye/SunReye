<script lang="ts">
  import { useCore } from "../lib/shell/core.ts";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { drillRoute } from "../lib/components/drill-in/route.ts";
  import Dashboard from "../lib/dashboard/Dashboard.svelte";
  import { routeGo, routeParams } from "../lib/range/kit-route.ts";
  import { entry, type Entry } from "../lib/setup/entry";
  import { access } from "../lib/shell/access.svelte.ts";
  import Boot from "../lib/shell/Boot.svelte";
  import SignIn from "../lib/setup/SignIn.svelte";

  const core = useCore();

  const shell = access();

  /** The open detail sheet as `?detail=` on the hash route: back closes it, a link opens it (ADR 21). */
  const detail = drillRoute({ page, goto }, "detail", { overlay: true });

  /** The hash route's query: a sheet's range lives beside `detail`. */
  const params = $derived(routeParams());

  /** The entry, with the shell told whether to frame it and whether Controls is listed. */
  async function open(): Promise<Entry> {
    shell?.opening();

    const shown = await entry(core);

    if (shell && shown.screen === "dashboard") shell.admin = shown.admin;

    shell?.opened(shown.screen === "dashboard");

    return shown;
  }

  let opening = $state.raw(open());

  function reopen(): void {
    opening = open();
  }

  /** Lazy: the dashboard loads only what it shows, and setup reaches the builder (ADR 11). */
  async function setup() {
    return (await import("../lib/setup/Setup.svelte")).default;
  }
</script>

{#await opening}
  <Boot />
{:then shown}
  {#if shown.screen === "sign-in"}
    <SignIn {core} onsignedin={reopen} />
  {:else if shown.screen === "setup"}
    {#await setup() then Setup}
      <Setup {core} signedIn={shown.signedIn} onfinish={reopen} />
    {/await}
  {:else}
    <Dashboard
      {core}
      layout={shown.layout}
      admin={shown.admin}
      detail={detail.open}
      onopen={detail.navigate}
      {params}
      go={routeGo}
      onclose={() => {
        detail.navigate(null);
      }}
    />
  {/if}
{/await}
