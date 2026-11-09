<script lang="ts">
  import type { ModuleType, StringDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import ModuleTypeSelect from "./ModuleTypeSelect.svelte";
  import type { Painted } from "./modules.ts";
  import NumberField from "./NumberField.svelte";
  import { stringCss } from "./scene.ts";

  let {
    string,
    position,
    made,
    moduleTypes,
    onchange,
    onremove,
  }: {
    string: Readonly<StringDraft>;
    /** Its position in the layout, which picks its colour. */
    position: number;
    /** What the scene paints into it. */
    made: Painted;
    moduleTypes: readonly ModuleType[];
    onchange: (string: Readonly<StringDraft>) => void;
    onremove: () => void;
  } = $props();
</script>

<fieldset>
  <legend>
    <span class="swatch" style:background={stringCss(position)}></span>
    {string.name}
  </legend>
  <label>
    {m.field_name()}
    <input
      value={string.name}
      oninput={(event) => {
        onchange({ ...string, name: event.currentTarget.value });
      }}
    />
  </label>
  <ModuleTypeSelect
    value={string.moduleType}
    {moduleTypes}
    onchange={(moduleType) => {
      onchange({ ...string, moduleType });
    }}
  />
  <NumberField
    label={m.field_device()}
    value={string.device}
    min={1}
    onchange={(device) => {
      onchange({ ...string, device });
    }}
  />
  <NumberField
    label={m.field_input()}
    value={string.input}
    min={1}
    onchange={(input) => {
      onchange({ ...string, input });
    }}
  />
  <NumberField
    label={m.field_loss()}
    value={string.loss}
    min={0}
    onchange={(loss) => {
      onchange({ ...string, loss });
    }}
  />
  <p>{m.builder_string_modules(made)}</p>
  <button type="button" onclick={onremove}>{m.builder_remove()}</button>
</fieldset>

<style>
  fieldset {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    align-items: end;
    gap: 0.75rem;
  }

  .swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 2px;
  }
</style>
