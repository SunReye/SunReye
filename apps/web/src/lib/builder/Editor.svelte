<script lang="ts">
  import type { Device, ModuleType } from "../api/core.ts";
  import type { Draft } from "./modules.ts";
  import ModulesForm from "./ModulesForm.svelte";
  import type { Modules } from "./pv.ts";
  import SceneForm from "./SceneForm.svelte";

  let {
    draft,
    laid,
    moduleTypes,
    devices,
    onchange,
  }: {
    draft: Draft;
    laid: Modules;
    moduleTypes: readonly ModuleType[];
    devices: readonly Device[];
    onchange: (draft: Draft) => void;
  } = $props();
</script>

<SceneForm
  {devices}
  bind:scene={
    () => draft.scene,
    (scene) => {
      onchange({ ...draft, scene });
    }
  }
/>
<ModulesForm {draft} {laid} {moduleTypes} {onchange} />
