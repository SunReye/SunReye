<!-- The app's destructive confirm (ADR 21): a dialog beside the rail, a drawer under the bar. -->
<script lang="ts">
  import ConfirmSheet from "../../components/confirm-sheet.svelte";
  import { Button } from "@sunreye/ui/button";
  import Demo from "../Demo.svelte";

  let confirming = $state(false);
</script>

<Demo name="confirm-sheet">
  <Button variant="outline" class="text-destructive" onclick={() => (confirming = true)}>
    Remove device
  </Button>
  <ConfirmSheet
    bind:open={confirming}
    title="Remove Battery"
    note="Its history is kept."
    action="Remove"
    done="Removed."
    onconfirm={() => Promise.resolve(undefined)}
  />
</Demo>
