<!-- Test harness: one of each surface and control, as they render in the app. -->
<script lang="ts">
  import "../../app.css";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import * as Card from "./ui/card/index.js";
  import { Input } from "./ui/input/index.js";
  import * as Item from "./ui/item/index.js";
  import { Kbd } from "./ui/kbd/index.js";
  import { Progress } from "./ui/progress/index.js";
  import { Skeleton } from "./ui/skeleton/index.js";
  import { Toggle } from "./ui/toggle/index.js";
</script>

<div data-testid="controls">
  <Button>Button</Button>
  <Card.Root>Card</Card.Root>
  <Input aria-label="Input" />
  <Badge>Badge</Badge>
  <Kbd>K</Kbd>
  <Progress value={40} aria-label="Progress" />
  <Skeleton class="h-4 w-8" />
  <Toggle aria-label="Toggle">T</Toggle>
  <Item.Root variant="outline">Item</Item.Root>
</div>

<div data-testid="glass">
  <div data-testid="ambient" class="glass-ambient">Ambient</div>
  <div class="glass">Overlay</div>
  <div class="glass-modal">Modal</div>
  <div class="glass-sidebar">Sidebar</div>
</div>

<div data-testid="primary" class="bg-primary"></div>
<div data-testid="brand" class="bg-brand"></div>
<div data-testid="blue-600" class="bg-blue-600"></div>
<div data-testid="blue-500" class="bg-blue-500"></div>
