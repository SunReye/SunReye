<!-- The app's field primitives (#750, #751): a labelled field and the pickers built on the kit. -->
<script lang="ts">
  import ComboboxField from "../../components/combobox-field.svelte";
  import DateField from "../../components/date-field.svelte";
  import FormField from "../../components/form-field.svelte";
  import SelectField from "../../components/select-field.svelte";
  import TextField from "../../components/text-field.svelte";
  import { Input } from "@sunreye/ui/input";
  import Demo from "../Demo.svelte";

  let hour = $state("8");
  let day = $state("2026-11-13");
  let zone = $state("Europe/Berlin");
</script>

<Demo name="form-field">
  <div class="flex w-64 flex-col gap-4">
    <FormField label="Address" hint="An address on your network.">
      {#snippet children({ id })}
        <Input {id} value="192.168.1.40" />
      {/snippet}
    </FormField>
    <FormField label="Modbus unit" error="Between 0 and 247.">
      {#snippet children({ id, invalid })}
        <Input {id} value="300" aria-invalid={invalid} />
      {/snippet}
    </FormField>
  </div>
</Demo>

<Demo name="text-field">
  <div class="flex w-64 flex-col gap-4">
    <TextField label="Plant name" value="Home" hint="Shown in the header." />
    <TextField label="Port" type="number" value="70000" error="Up to 65535." />
  </div>
</Demo>

<Demo name="select-field">
  <SelectField
    label="Hour"
    bind:value={hour}
    options={["0", "8", "16"].map((value) => ({ value, label: `${value}:00` }))}
  />
</Demo>

<Demo name="date-field">
  <DateField
    label="Day"
    value={day}
    min="2026-11-01"
    max="2026-11-30"
    onchange={(next) => {
      day = next;
    }}
  />
</Demo>

<Demo name="combobox-field">
  <div class="w-64">
    <ComboboxField
      id="gallery-zone"
      bind:value={zone}
      options={["Europe/Berlin", "Europe/Vienna", "Europe/Zurich"]}
      search="Search a timezone"
      none="No timezone found."
    />
  </div>
</Demo>
