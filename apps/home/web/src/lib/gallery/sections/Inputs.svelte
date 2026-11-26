<script lang="ts">
  import SearchIcon from "@lucide/svelte/icons/search";
  import { Checkbox } from "@sunreye/ui/checkbox";
  import * as Field from "../../components/ui/field/index.js";
  import * as InputGroup from "../../components/ui/input-group/index.js";
  import * as InputOTP from "../../components/ui/input-otp/index.js";
  import { Input } from "@sunreye/ui/input";
  import { Label } from "../../components/ui/label/index.js";
  import { Switch } from "../../components/ui/switch/index.js";
  import { Textarea } from "../../components/ui/textarea/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="input">
  <Input class="w-56" placeholder="Host" aria-label="Host" />
  <Input class="w-32" type="number" value="502" aria-label="Port" />
  <Input class="w-56" value="not a host" aria-invalid aria-label="Invalid" />
  <Input class="w-56" disabled value="Disabled" aria-label="Disabled" />
</Demo>

<Demo name="textarea">
  <Textarea class="w-72" placeholder="Note" aria-label="Note" />
</Demo>

<Demo name="label">
  <div class="flex items-center gap-2">
    <Checkbox id="gallery-label" />
    <Label for="gallery-label">Remember this device</Label>
  </div>
</Demo>

<Demo name="field">
  <Field.Group class="w-80">
    <Field.Field>
      <Field.Label for="gallery-name">Plant name</Field.Label>
      <Input id="gallery-name" value="Home" />
      <Field.Description>Shown in the header.</Field.Description>
    </Field.Field>
    <Field.Field data-invalid>
      <Field.Label for="gallery-unit">Modbus unit</Field.Label>
      <Input id="gallery-unit" value="300" aria-invalid />
      <Field.Error>Between 0 and 247.</Field.Error>
    </Field.Field>
    <Field.Field orientation="horizontal">
      <Field.Content>
        <Field.Label for="gallery-writes">Writes</Field.Label>
        <Field.Description>Allow settings to be written.</Field.Description>
      </Field.Content>
      <Switch id="gallery-writes" checked />
    </Field.Field>
  </Field.Group>
</Demo>

<Demo name="input-group">
  <InputGroup.Root class="w-64">
    <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
    <InputGroup.Input placeholder="Search profiles" aria-label="Search profiles" />
    <InputGroup.Addon align="inline-end"><InputGroup.Text>12</InputGroup.Text></InputGroup.Addon>
  </InputGroup.Root>
</Demo>

<Demo name="input-otp">
  <InputOTP.Root maxlength={4} value="12" aria-label="Code">
    {#snippet children({ cells })}
      <InputOTP.Group>
        {#each cells as cell, index (index)}
          <InputOTP.Slot {cell} />
        {/each}
      </InputOTP.Group>
    {/snippet}
  </InputOTP.Root>
</Demo>
