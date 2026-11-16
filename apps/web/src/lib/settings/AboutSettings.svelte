<!-- Settings › About SunReye: credits whose licences ask to be shown, CC BY 4.0's title, author, source, licence and changes. The spot prices' credit also stays beside them (ADR 12), the imported surroundings' on the scene that draws them (ADR 20). -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import { MAP_CREDIT, TERRAIN_CREDITS } from "../scene/credits.ts";
  import SpotAttribution from "../SpotAttribution.svelte";
</script>

<section aria-labelledby="about-credits" class="flex flex-col">
  <h2 id="about-credits" class="px-4 pt-4 text-[15px] font-medium">{m.about_credits()}</h2>
  <div class="drill-card drill:mt-2">
    <Item.Group class="gap-0 divide-y divide-border/60">
      <Item.Root class="rounded-none border-0">
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.about_car()}</Item.Title>
          <Item.Description class="line-clamp-none [&_a]:underline [&_a]:underline-offset-2">
            <a href="https://sketchfab.com/3d-models/61ddcbdbd3854c239e0c95bf60b00022"
              >2024 Tesla Model 3 + Interior</a
            > {m.about_car_by()}
            <a href="https://sketchfab.com/tonielpro520">tonielpro520</a>,
            <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>; {m.about_car_changed()}.
          </Item.Description>
        </Item.Content>
      </Item.Root>
      <Item.Root class="rounded-none border-0">
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.about_surroundings()}</Item.Title>
          <Item.Description class="line-clamp-none [&_a]:underline [&_a]:underline-offset-2">
            {m.about_surroundings_map()}: <a href={MAP_CREDIT.href}>{MAP_CREDIT.text}</a>
          </Item.Description>
          <p id="about-terrain" class="text-sm text-muted-foreground">
            {m.about_surroundings_terrain()}
          </p>
          <ul
            aria-labelledby="about-terrain"
            class="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground"
          >
            {#each TERRAIN_CREDITS as credit (credit)}
              <li>{credit}</li>
            {/each}
          </ul>
        </Item.Content>
      </Item.Root>
      <Item.Root class="rounded-none border-0">
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.spot_title()}</Item.Title>
          <!-- The credit is its own paragraph, so it takes the description's look rather than nest in one. -->
          <SpotAttribution
            class="text-left text-sm leading-normal font-normal text-muted-foreground [&_a]:underline [&_a]:underline-offset-2"
          />
        </Item.Content>
      </Item.Root>
    </Item.Group>
  </div>
</section>
