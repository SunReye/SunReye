<!-- The app's own primitives (#751), built on the kit. -->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Eyebrow from "../../components/eyebrow.svelte";
  import PageTitle from "../../components/page-title.svelte";
  import ProblemAlert from "../../components/problem-alert.svelte";
  import Section from "../../components/section.svelte";
  import StatStrip from "../../components/stat-strip.svelte";
  import StatusLine from "../../components/status-line.svelte";
  import { Button } from "../../components/ui/button/index.js";
  import Demo from "../Demo.svelte";

  const STATS = [
    { label: "Coverage", value: "98 %" },
    { label: "Gaps", value: "3.5 h" },
    { label: "Recording since", value: "3 Mar 2024" },
  ];
</script>

<Demo name="page-title">
  <PageTitle title="Status" />
  <PageTitle wide title="Statistics" />
</Demo>

<Demo name="section">
  <div class="w-80">
    <Section title="Prices now">
      <p class="text-sm text-muted-foreground">A plain section stacks under its title.</p>
    </Section>
  </div>
  <div class="w-80">
    <Section card title="Log">
      {#snippet actions()}
        <Button variant="ghost" size="sm">Refresh</Button>
      {/snippet}
      <p class="px-4 py-3 text-sm text-muted-foreground">A card rules its header off.</p>
    </Section>
  </div>
</Demo>

<Demo name="eyebrow">
  <div class="w-64">
    <Eyebrow>Feed-in</Eyebrow>
    <p class="pt-2 text-sm">Over a group of rows or fields.</p>
  </div>
  <div class="w-64">
    <Section eyebrow title="Access">
      <p class="px-4 text-sm">A section under an eyebrow, as Settings lists them.</p>
    </Section>
  </div>
</Demo>

<Demo name="stat-strip">
  <div class="w-96"><StatStrip stats={STATS} /></div>
</Demo>

<Demo name="problem-alert">
  <div class="w-80"><ProblemAlert text="The inverter refused 120 A." /></div>
</Demo>

<Demo name="status-line">
  <StatusLine tone="warning" icon={TriangleAlert}>No values for 3 min</StatusLine>
  <StatusLine tone="destructive" icon={TriangleAlert}>Offline</StatusLine>
  <StatusLine tone="muted">PV now</StatusLine>
</Demo>
