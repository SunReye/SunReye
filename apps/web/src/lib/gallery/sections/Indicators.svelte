<script lang="ts">
  import LoadFailed from "../../components/load-failed.svelte";
  import { Badge } from "../../components/ui/badge/index.js";
  import { Button } from "../../components/ui/button/index.js";
  import { Kbd } from "../../components/ui/kbd/index.js";
  import { Progress } from "../../components/ui/progress/index.js";
  import { Separator } from "../../components/ui/separator/index.js";
  import { Skeleton } from "../../components/ui/skeleton/index.js";
  import { Spinner } from "../../components/ui/spinner/index.js";
  import Demo from "../Demo.svelte";

  const TONES = ["solar", "battery", "import", "export", "house", "ev", "under", "over"] as const;
</script>

<Demo name="badge">
  <Badge>Default</Badge>
  <Badge variant="secondary">Secondary</Badge>
  <Badge variant="outline">Outline</Badge>
  <Badge variant="destructive">Destructive</Badge>
  {#each TONES as tone (tone)}
    <Badge variant={tone}>{tone}</Badge>
  {/each}
</Demo>

<Demo name="progress">
  <div class="flex w-64 flex-col gap-3">
    <Progress value={62} aria-label="Default" />
    <Progress value={40} size="square" tone="solar" aria-label="Solar" />
    <Progress value={81} size="hairline" tone="battery" aria-label="Battery" />
    <Progress value={25} tone="under" aria-label="Under" />
    <Progress value={70} tone="over" aria-label="Over" />
  </div>
</Demo>

<Demo name="kbd">
  <Kbd>⌘</Kbd>
  <Kbd>K</Kbd>
</Demo>

<Demo name="spinner">
  <Spinner />
  <Button disabled><Spinner data-icon="inline-start" />Saving</Button>
</Demo>

<Demo name="skeleton">
  <div class="flex w-64 flex-col gap-2">
    <Skeleton class="h-4 w-40" />
    <Skeleton class="h-4 w-56" />
    <Skeleton class="h-16 w-full" />
  </div>
</Demo>

<Demo name="separator">
  <div class="flex h-5 items-center gap-3 text-sm">
    <span>Solar</span>
    <Separator orientation="vertical" />
    <span>Battery</span>
    <Separator orientation="vertical" />
    <span>Grid</span>
  </div>
</Demo>

<Demo name="load-failed">
  <div class="flex w-96 flex-col gap-4">
    <LoadFailed text="This range could not be read." onretry={() => {}} />
    <LoadFailed size="quiet" text="3D view not loaded" onretry={() => {}} />
    <LoadFailed
      size="block"
      text="History could not be loaded"
      detail="Live values keep running; the range and view stay as they are."
      onretry={() => {}}
    />
  </div>
</Demo>
