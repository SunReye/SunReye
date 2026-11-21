<!-- The plant timezone and location: setup's second step, and Settings › Plant later. -->
<script lang="ts">
  import LocateFixed from "@lucide/svelte/icons/locate-fixed";
  import type { Core, Problem } from "../api/core.ts";
  import type { Location } from "../api/setup.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import ComboboxField from "../components/combobox-field.svelte";
  import FormField from "../components/form-field.svelte";
  import TextField from "../components/text-field.svelte";
  import { m } from "../paraglide/messages.js";
  import Refusal, { answered, refusedInline } from "./Refusal.svelte";

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

  // Only a secure page may ask; a core reached over plain HTTP on the LAN is not one.
  const locatable = isSecureContext && "geolocation" in navigator;

  // The browser's zone is most often the plant's. The field starts from it or the stored zone, and
  // the admin's pick owns it after.
  // svelte-ignore state_referenced_locally
  let zone = $state(current?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

  const id = $props.id();

  // The fields start from the stored plant as text, typed with the locale's decimal key; the
  // admin's edits own them after.
  // svelte-ignore state_referenced_locally
  let latitudeText = $state(String(current?.location?.latitude ?? ""));

  // As the latitude.
  // svelte-ignore state_referenced_locally
  let longitudeText = $state(String(current?.location?.longitude ?? ""));

  /** A typed coordinate, with a comma or a point; empty or not a number is none. */
  function coordinate(text: string): number | undefined {
    const value = Number(text.trim().replace(",", "."));

    return text.trim() === "" || Number.isNaN(value) ? undefined : value;
  }

  // The zone held or guessed is listed even where the browser's list leaves it out, such as UTC.
  // svelte-ignore state_referenced_locally
  const zones = [...new Set([zone, ...Intl.supportedValuesOf("timeZone")])];

  let refused = $state.raw<Problem>();

  let kept = $state.raw<string>();

  /** Four decimals: about ten metres, plenty for the sun. */
  const round = (degrees: number) => Math.round(degrees * 1e4) / 1e4;

  function locate(): void {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        kept = undefined;
        latitudeText = String(round(coords.latitude));
        longitudeText = String(round(coords.longitude));
      },
      () => {
        kept = m.plant_here_refused();
        refusedInline();
      },
    );
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const latitude = coordinate(latitudeText);
    const longitude = coordinate(longitudeText);

    if (latitude === undefined || longitude === undefined) return;

    const location = { latitude, longitude };
    const set = await core.setTimezone(zone);
    const placed = set ?? (await core.setLocation(location));

    refused = placed !== undefined && "problem" in placed ? answered(placed) : undefined;

    if (refused === undefined) ondone();
  }
</script>

<form onsubmit={submit} class="flex flex-col gap-4 p-4">
  {#if current === undefined}<p class="text-sm text-muted-foreground">{m.plant_hint()}</p>{/if}
  <FormField label={m.plant_timezone()}>
    {#snippet children({ id })}
      <ComboboxField
        {id}
        bind:value={zone}
        options={zones}
        search={m.plant_timezone_search()}
        none={m.plant_timezone_none()}
      />
    {/snippet}
  </FormField>
  <div class="grid grid-cols-2 gap-3">
    <TextField
      label={m.plant_latitude()}
      inputmode="decimal"
      autocomplete="off"
      required
      bind:value={latitudeText}
    />
    <TextField
      label={m.plant_longitude()}
      inputmode="decimal"
      autocomplete="off"
      required
      bind:value={longitudeText}
    />
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
