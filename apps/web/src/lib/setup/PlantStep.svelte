<script lang="ts">
  import type { Core, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let { core, ondone }: { core: Core; ondone: () => void } = $props();

  const zones = Intl.supportedValuesOf("timeZone");

  // The browser's zone is most often the plant's.
  let zone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  let latitude = $state<number>();

  let longitude = $state<number>();

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
  <button type="submit">{m.setup_next()}</button>
</form>
<Refusal {refused} />
