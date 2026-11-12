<script lang="ts">
  import type { Core, Problem } from "../api/core.ts";
  import type { Location } from "../api/setup.ts";
  import { m } from "../paraglide/messages.js";
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

  // The browser's zone is most often the plant's.
  // svelte-ignore state_referenced_locally
  let zone = $state(current?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

  // svelte-ignore state_referenced_locally
  let latitude = $state(current?.location?.latitude);

  // svelte-ignore state_referenced_locally
  let longitude = $state(current?.location?.longitude);

  let refused = $state.raw<Problem>();

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

<form onsubmit={submit}>
  <label>
    {m.plant_timezone()}
    <select bind:value={zone}>
      {#each zones as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </label>
  <label>
    {m.plant_latitude()}
    <input type="number" step="any" required bind:value={latitude} />
  </label>
  <label>
    {m.plant_longitude()}
    <input type="number" step="any" required bind:value={longitude} />
  </label>
  <button type="submit">{action}</button>
</form>
<Refusal {refused} />
