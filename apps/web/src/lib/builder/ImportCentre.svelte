<!--
  A more exact centre for a load of surroundings (ADR 20): the plant's location is kept to 0.01°
  only, so the admin may type the house's own, or take this device's. It goes to the core with
  the load and is kept nowhere.
-->
<script lang="ts">
  import LocateFixed from "@lucide/svelte/icons/locate-fixed";
  import ProblemAlert from "../components/problem-alert.svelte";
  import TextField from "../components/text-field.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import { centreOf } from "./importing.ts";

  let {
    centre = $bindable(),
  }: {
    /** The centre typed; undefined for none, so the plant's location is used; null while what is
     * typed is no place. */
    centre: ReturnType<typeof centreOf>;
  } = $props();

  let latitude = $state("");
  let longitude = $state("");
  let unlocated = $state(false);

  function typed(): void {
    centre = centreOf(latitude, longitude);
  }

  /** Fills the fields from this device's own position. */
  function locate(): void {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        unlocated = false;
        latitude = coords.latitude.toFixed(5);
        longitude = coords.longitude.toFixed(5);
        typed();
      },
      () => {
        unlocated = true;
      },
      { enableHighAccuracy: true },
    );
  }
</script>

<section aria-labelledby="import-centre" class="flex flex-col gap-3 border-t border-border/60 p-4">
  <div class="flex flex-col gap-1">
    <h3 id="import-centre" class="text-[15px] font-medium">{m.builder_import_centre()}</h3>
    <p class="text-sm text-muted-foreground">{m.builder_import_centre_hint()}</p>
  </div>
  <div class="grid grid-cols-2 gap-3">
    <TextField
      label={m.builder_import_latitude()}
      bind:value={latitude}
      oninput={typed}
      inputmode="decimal"
      autocomplete="off"
      placeholder="48.13700"
    />
    <TextField
      label={m.builder_import_longitude()}
      bind:value={longitude}
      oninput={typed}
      inputmode="decimal"
      autocomplete="off"
      placeholder="11.57500"
    />
  </div>
  {#if centre === null}
    <p role="alert" class="text-sm text-destructive">{m.builder_import_centre_invalid()}</p>
  {/if}
  <Button variant="outline" onclick={locate}>
    <LocateFixed data-icon="inline-start" />
    {m.builder_import_locate()}
  </Button>
  <ProblemAlert text={unlocated ? m.builder_import_locate_failed() : undefined} />
</section>
