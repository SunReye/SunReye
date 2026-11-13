<script lang="ts">
  import { Checkbox } from "../../components/ui/checkbox/index.js";
  import { Label } from "../../components/ui/label/index.js";
  import * as NativeSelect from "../../components/ui/native-select/index.js";
  import * as RadioGroup from "../../components/ui/radio-group/index.js";
  import * as Select from "../../components/ui/select/index.js";
  import { Slider } from "../../components/ui/slider/index.js";
  import { Switch } from "../../components/ui/switch/index.js";
  import Demo from "../Demo.svelte";

  const ZONES = [
    { value: "berlin", label: "Europe/Berlin" },
    { value: "vienna", label: "Europe/Vienna" },
    { value: "zurich", label: "Europe/Zurich" },
  ];

  let zone = $state("berlin");
  let level = $state(40);
</script>

<Demo name="checkbox">
  <Checkbox aria-label="Unchecked" />
  <Checkbox checked aria-label="Checked" />
  <Checkbox indeterminate aria-label="Indeterminate" />
  <Checkbox disabled aria-label="Disabled" />
</Demo>

<Demo name="radio-group">
  <RadioGroup.Root value="load" aria-label="Kind">
    <div class="flex items-center gap-2">
      <RadioGroup.Item value="load" id="gallery-load" />
      <Label for="gallery-load">Load</Label>
    </div>
    <div class="flex items-center gap-2">
      <RadioGroup.Item value="source" id="gallery-source" />
      <Label for="gallery-source">Source</Label>
    </div>
  </RadioGroup.Root>
</Demo>

<Demo name="switch">
  <Switch aria-label="Off" />
  <Switch checked aria-label="On" />
  <Switch size="sm" checked aria-label="Small" />
  <Switch disabled aria-label="Disabled" />
</Demo>

<Demo name="slider">
  <Slider type="single" bind:value={level} max={100} class="w-64" aria-label="Level" />
</Demo>

<Demo name="select">
  <Select.Root type="single" bind:value={zone}>
    <Select.Trigger class="w-56" aria-label="Timezone">
      {ZONES.find((option) => option.value === zone)?.label ?? "Timezone"}
    </Select.Trigger>
    <Select.Content>
      <Select.Group>
        <Select.Label>Timezone</Select.Label>
        {#each ZONES as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Group>
    </Select.Content>
  </Select.Root>
</Demo>

<Demo name="native-select">
  <NativeSelect.Root aria-label="Timezone" value="vienna">
    {#each ZONES as option (option.value)}
      <NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
    {/each}
  </NativeSelect.Root>
</Demo>
