<!-- What a tariff version holds beside its prices: the standing charge and the date it applies from. -->
<script lang="ts">
  import ValueRow from "../builder/ValueRow.svelte";
  import DateField from "../components/date-field.svelte";
  import { m } from "../paraglide/messages.js";

  let {
    standingCharge = $bindable(),
    appliesFrom = $bindable(),
  }: {
    /** EUR a month. */
    standingCharge: number;
    /** A `datetime-local` value, empty for now. */
    appliesFrom: string;
  } = $props();

  // Owed each month whatever is bought, to the cent.
  const edit = {
    kind: "number" as const,
    name: m.tariff_standing_charge(),
    unit: "",
    min: 0,
    max: 1000,
    step: 0.01,
  };
</script>

<div class="mt-5 divide-y divide-border/60 border-y border-border/60">
  <ValueRow
    {edit}
    value={standingCharge}
    onchange={(charge) => {
      standingCharge = charge;
    }}
  />
  <!-- From now, or from the plant's midnight of a picked day. -->
  <DateField
    variant="row"
    label={m.tariff_applies_from()}
    value={appliesFrom.slice(0, 10)}
    shortcut={{ text: m.tariff_now(), value: "" }}
    onchange={(day) => {
      appliesFrom = day === "" ? "" : `${day}T00:00`;
    }}
  />
</div>
