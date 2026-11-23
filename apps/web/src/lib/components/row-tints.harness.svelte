<!-- Test harness: a row of each kind the app presses, a button, a switch's label and a link, and the chosen rows. -->
<script lang="ts">
  import DrillRow from "../../../../../packages/builder/src/components/drill-in/drill-row.svelte";
  import { Pressable } from "@sunreye/ui/pressable";
  import ForecastSettings from "../settings/ForecastSettings.svelte";
  import ToggleRow from "../settings/ToggleRow.svelte";
</script>

<div class="flex w-80 flex-col">
  <Pressable feedback class="p-3">Knopf</Pressable>
  <ToggleRow label="Schalter" checked={false} onchange={() => {}} />
  <ForecastSettings />
  <Pressable feedback selected class="p-3">Gewählt</Pressable>
  <DrillRow group={{ id: "a", label: "Offen" }} current onclick={() => {}} />
</div>
