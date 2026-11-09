<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { CHOICE, LOW_POWER, type View } from "./dashboard.ts";

  let {
    shows,
    toggles,
    choice = $bindable(),
    lowPower = $bindable(),
  }: {
    shows: View;
    /** Whether the 3D scene can show at all. */
    toggles: boolean;
    choice: View | null;
    lowPower: boolean;
  } = $props();
</script>

{#if toggles}
  <button
    type="button"
    onclick={() => {
      choice = shows === "3d" ? "2d" : "3d";
      localStorage.setItem(CHOICE, choice);
    }}>{shows === "3d" ? m.live_show_2d() : m.live_show_3d()}</button
  >
{/if}
<label>
  <input
    type="checkbox"
    checked={lowPower}
    onchange={(event) => {
      lowPower = event.currentTarget.checked;
      localStorage.setItem(LOW_POWER, lowPower ? "on" : "off");
    }}
  />
  {m.live_low_power()}
</label>
