<!--
  Loading surroundings (ADR 20): a radius, a more exact centre, where the location goes, and how
  the load is going. The core fetches; this asks and follows.
-->
<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { m } from "../paraglide/messages.js";
  import { choices } from "./fields.ts";
  import ImportCentre from "./ImportCentre.svelte";
  import type { centreOf } from "./importing.ts";
  import { importer } from "./upload.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    again = false,
    ondone,
  }: {
    /** Surroundings are loaded already: this loads them anew, and may be left. */
    again?: boolean;
    /** The load brought a document, or the admin left. */
    ondone: () => void;
  } = $props();

  const importing = importer();

  /** The radii a load may ask for, in metres. */
  const RADII = [100, 200, 300] as const;

  const radii = choices(
    m.builder_import_radius(),
    RADII.map((metres) => m.builder_import_metres({ metres })),
  );

  /** 200 m unless chosen. */
  let radius = $state(1);
  let centre = $state.raw<ReturnType<typeof centreOf>>();

  const fetching = $derived(importing.loading === "fetching");

  /** Why the last load brought nothing, in the app's words. */
  const failure = $derived.by(() => {
    const { loading } = importing;

    if (loading === undefined || loading === "fetching") return {};

    if (loading.problem !== undefined) return { problem: loading.problem };

    return {
      text:
        loading.reason === undefined || loading.reason === ""
          ? m.builder_import_failed()
          : m.builder_import_failed_reason({ reason: loading.reason }),
    };
  });

  async function load(): Promise<void> {
    if (centre === null) return;

    await importing.load({ radius: RADII[radius] ?? 200, centre });

    if (importing.loading === undefined) ondone();
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={radii}
    value={radius}
    onchange={(index) => {
      radius = index;
    }}
  />
</Item.Group>
<ImportCentre bind:centre />
<div class="flex flex-col gap-3 border-t border-border/60 p-4">
  <p class="text-sm text-muted-foreground">{m.builder_import_privacy()}</p>
  <ProblemAlert {...failure} />
  <Button class="w-full" disabled={fetching || centre === null} onclick={load}>
    {#if fetching}
      <Spinner data-icon="inline-start" />
      {m.builder_import_fetching()}
    {:else}
      {again ? m.builder_import_reload() : m.builder_import_load()}
    {/if}
  </Button>
  {#if again && !fetching}
    <Button variant="ghost" class="w-full" onclick={ondone}>{m.builder_import_cancel()}</Button>
  {/if}
</div>
