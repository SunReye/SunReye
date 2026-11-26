<!-- Who signs in (ADR 9): the admin by password alone, or a viewer by name and password. -->
<script lang="ts">
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";

  let { account = $bindable() }: { account: "admin" | "viewer" } = $props();
</script>

<Segmented
  options={[
    ["admin", m.signin_admin()],
    ["viewer", m.signin_viewer()],
  ]}
  value={account}
  label={m.signin_account()}
  fill
  onchange={(next) => {
    account = next;
  }}
/>
