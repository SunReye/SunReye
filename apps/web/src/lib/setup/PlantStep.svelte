<!-- The plant timezone and location: setup's second step, and Settings › Plant later. -->
<script lang="ts">
  import LocateFixed from "@lucide/svelte/icons/locate-fixed";
  import type { Core, Problem } from "../api/core.ts";
  import type { Location } from "../api/setup.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { FIELD, SELECT } from "./fields.ts";
  import Refusal from "./Refusal.svelte";

  let {
    core,
    ondone,
    current,
    action = m.setup_next(),
  }: {
    core: Core;
    ondone: () => void;
    /** What the plant holds already, when it is changed later in the settings. */
    current?: { readonly zone: string; readonly location: Location | undefined };
    /** The submit button's label. */
    action?: string;
  } = $props();

  const zones = Intl.supportedValuesOf("timeZone");

  // Only a secure page may ask; a core reached over plain HTTP on the LAN is not one.
  const locatable = isSecureContext && "geolocation" in navigator;

  // The browser's zone is most often the plant's.
  // svelte-ignore state_referenced_locally
  let zone = $state(current?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

  // svelte-ignore state_referenced_locally
  let latitude = $state(current?.location?.latitude);

  // svelte-ignore state_referenced_locally
  let longitude = $state(current?.location?.longitude);

  let refused = $state.raw<Problem>();

  let kept = $state.raw<string>();

  /** Four decimals: about ten metres, plenty for the sun. */
  const round = (degrees: number) => Math.round(degrees * 1e4) / 1e4;

  function locate(): void {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        kept = undefined;
        latitude = round(coords.latitude);
        longitude = round(coords.longitude);
        haptics.selection();
      },
      () => {
        kept = m.plant_here_refused();
        haptics.error();
      },
    );
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (latitude === undefined || longitude === undefined) return;

    const location = { latitude, longitude };
    const set = await core.setTimezone(zone);
    const placed = set ?? (await core.setLocation(location));

    refused = placed !== undefined && "problem" in placed ? placed : undefined;

    if (refused === undefined) ondone();
  }
</script>

<form onsubmit={submit} class="flex flex-col gap-4 p-4">
  {#if current === undefined}<p class="text-sm text-muted-foreground">{m.plant_hint()}</p>{/if}
  <label class={FIELD}>
    {m.plant_timezone()}
    <select bind:value={zone} class={SELECT}>
      {#each zones as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </label>
  <div class="grid grid-cols-2 gap-3">
    <label class={FIELD}>
      {m.plant_latitude()}
      <Input type="number" inputmode="decimal" step="any" required bind:value={latitude} />
    </label>
    <label class={FIELD}>
      {m.plant_longitude()}
      <Input type="number" inputmode="decimal" step="any" required bind:value={longitude} />
    </label>
  </div>
  {#if locatable}
    <Button variant="outline" class="self-start" onclick={locate}>
      <LocateFixed data-icon="inline-start" />
      {m.plant_here()}
    </Button>
  {/if}
  <Refusal {refused} text={kept} />
  <Button type="submit" class="w-full sm:w-auto sm:self-end">{action}</Button>
</form>
